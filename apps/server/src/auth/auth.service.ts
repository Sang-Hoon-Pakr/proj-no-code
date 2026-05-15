import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';

// security-rules.md: 15분 access TTL, 14일 refresh TTL.
const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 14 * 24 * 60 * 60;

// security-rules.md: argon2id memoryCost=64MB, timeCost=3, parallelism=4.
const ARGON2_OPTS = {
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
} as const;

const RegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
export class EmailTakenError extends Error {
  constructor() {
    super('email taken');
    this.name = 'EmailTakenError';
  }
}
export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}
export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('invalid refresh token');
    this.name = 'InvalidRefreshTokenError';
  }
}
export class RefreshTokenReuseError extends Error {
  constructor() {
    super('refresh token reuse detected');
    this.name = 'RefreshTokenReuseError';
  }
}

export interface User {
  id: string;
  email: string;
  createdAt: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

interface RefreshRow {
  id: string;
  user_id: string;
  family_id: string;
  used_at: Date | null;
  replaced_by: string | null;
  expires_at: Date;
}

const PG_UNIQUE_VIOLATION = '23505';

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly jwtSecret: string,
  ) {}

  async register(input: { email: string; password: string }): Promise<User> {
    const parsed = RegisterSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(parsed.error.message);

    const id = uuidv7();
    const passwordHash = await hash(parsed.data.password, ARGON2_OPTS);

    try {
      const { rows } = await this.pool.query<UserRow>(
        `INSERT INTO users (id, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, password_hash, created_at`,
        [id, parsed.data.email, passwordHash],
      );
      return { id: rows[0].id, email: rows[0].email, createdAt: rows[0].created_at };
    } catch (e) {
      if (isPgUniqueViolation(e)) throw new EmailTakenError();
      throw e;
    }
  }

  async login(input: { email: string; password: string }): Promise<TokenPair> {
    const parsed = LoginSchema.safeParse(input);
    if (!parsed.success) throw new InvalidCredentialsError();

    const { rows } = await this.pool.query<UserRow>(
      `SELECT id, email, password_hash, created_at FROM users WHERE email = $1`,
      [parsed.data.email],
    );

    if (rows.length === 0) {
      // 타이밍 오라클 방지: 미존재 사용자도 hash 한 번 수행.
      await hash(parsed.data.password, ARGON2_OPTS);
      throw new InvalidCredentialsError();
    }

    const valid = await verify(rows[0].password_hash, parsed.data.password);
    if (!valid) throw new InvalidCredentialsError();

    return this.issueInitialPair(rows[0].id);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    // 컨트롤러에서 unknown 타입으로 들어올 수 있어 런타임 가드 — 빈 값/비문자열은 invalid로 통일.
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw new InvalidRefreshTokenError();
    }
    const tokenHash = sha256Hex(refreshToken);
    const { rows } = await this.pool.query<RefreshRow>(
      `SELECT id, user_id, family_id, used_at, replaced_by, expires_at
       FROM refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );

    if (rows.length === 0) throw new InvalidRefreshTokenError();
    const row = rows[0];

    if (row.expires_at <= new Date()) throw new InvalidRefreshTokenError();

    if (row.used_at !== null) {
      // 이미 소비된 토큰.
      // - replaced_by 있음: 정상 rotation으로 소비됨 → 재사용 = 공격 → family 무효화.
      // - replaced_by 없음: collateral 무효화로 소비됨 → 그냥 invalid.
      if (row.replaced_by !== null) {
        await this.pool.query(
          `UPDATE refresh_tokens SET used_at = NOW() WHERE family_id = $1 AND used_at IS NULL`,
          [row.family_id],
        );
        throw new RefreshTokenReuseError();
      }
      throw new InvalidRefreshTokenError();
    }

    return this.rotatePair(row.user_id, row.family_id, row.id);
  }

  private async issueInitialPair(userId: string): Promise<TokenPair> {
    const refreshToken = generateOpaqueToken();
    const refreshId = uuidv7();
    const familyId = uuidv7();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000);

    await this.pool.query(
      `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [refreshId, userId, familyId, sha256Hex(refreshToken), expiresAt],
    );

    return { accessToken: this.signAccessToken(userId), refreshToken };
  }

  private async rotatePair(userId: string, familyId: string, oldId: string): Promise<TokenPair> {
    const refreshToken = generateOpaqueToken();
    const newId = uuidv7();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // INSERT 먼저: replaced_by self-ref FK가 즉시 검증되므로 참조 대상이 먼저 존재해야 함.
      await client.query(
        `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [newId, userId, familyId, sha256Hex(refreshToken), expiresAt],
      );
      await client.query(
        `UPDATE refresh_tokens SET used_at = NOW(), replaced_by = $1 WHERE id = $2`,
        [newId, oldId],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return { accessToken: this.signAccessToken(userId), refreshToken };
  }

  private signAccessToken(userId: string): string {
    // jti는 같은 초에 발급되는 토큰 충돌 방지 + 향후 revocation 추적 기반.
    return jwt.sign({ sub: userId }, this.jwtSecret, {
      expiresIn: ACCESS_TTL_SEC,
      jwtid: uuidv7(),
    });
  }
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isPgUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
