import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import {
  AuthService,
  EmailTakenError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RefreshTokenReuseError,
  ValidationError,
} from '../../src/auth/auth.service';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;
const JWT_SECRET = 'test-secret-for-jwt-signing-do-not-use-in-prod';

describe('AuthService', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let service: AuthService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(PG_IMAGE).start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await pool.query(`
      CREATE TABLE users (
        id            UUID PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE refresh_tokens (
        id          UUID PRIMARY KEY,
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        family_id   UUID NOT NULL,
        token_hash  TEXT NOT NULL UNIQUE,
        expires_at  TIMESTAMPTZ NOT NULL,
        used_at     TIMESTAMPTZ,
        replaced_by UUID REFERENCES refresh_tokens(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id);
    `);
    service = new AuthService(pool, JWT_SECRET);
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE refresh_tokens, users CASCADE');
  });

  describe('register', () => {
    it('creates a user with argon2id-hashed password', async () => {
      const user = await service.register({
        email: 'alice@example.com',
        password: 'password123',
      });
      expect(user.email).toBe('alice@example.com');
      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);

      const { rows } = await pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [user.id],
      );
      expect(rows[0].password_hash).not.toBe('password123');
      expect(rows[0].password_hash.startsWith('$argon2id$')).toBe(true);
    });

    it('rejects duplicate email', async () => {
      await service.register({ email: 'alice@example.com', password: 'password123' });
      await expect(
        service.register({ email: 'alice@example.com', password: 'different456' }),
      ).rejects.toBeInstanceOf(EmailTakenError);
    });

    it('rejects invalid email format', async () => {
      await expect(
        service.register({ email: 'not-an-email', password: 'password123' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects password shorter than 8 chars', async () => {
      await expect(
        service.register({ email: 'alice@example.com', password: 'short1' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('login', () => {
    it('returns access + refresh tokens for valid credentials', async () => {
      const user = await service.register({
        email: 'alice@example.com',
        password: 'password123',
      });
      const tokens = await service.login({
        email: 'alice@example.com',
        password: 'password123',
      });

      expect(tokens.accessToken.length).toBeGreaterThan(0);
      expect(tokens.refreshToken.length).toBeGreaterThan(0);

      const decoded = jwt.verify(tokens.accessToken, JWT_SECRET) as { sub: string };
      expect(decoded.sub).toBe(user.id);
    });

    it('rejects wrong password', async () => {
      await service.register({ email: 'alice@example.com', password: 'password123' });
      await expect(
        service.login({ email: 'alice@example.com', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('rejects unknown email (does not leak existence)', async () => {
      await expect(
        service.login({ email: 'nobody@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });
  });

  describe('refresh — rotation invariant', () => {
    it('issues new pair and invalidates the used refresh token', async () => {
      await service.register({ email: 'alice@example.com', password: 'password123' });
      const t1 = await service.login({
        email: 'alice@example.com',
        password: 'password123',
      });

      const t2 = await service.refresh(t1.refreshToken);
      expect(t2.refreshToken).not.toBe(t1.refreshToken);
      expect(t2.accessToken).not.toBe(t1.accessToken);

      // t1 was consumed → re-using it is a reuse attack
      await expect(service.refresh(t1.refreshToken)).rejects.toBeInstanceOf(RefreshTokenReuseError);
    });

    it('reuse of consumed token → entire family invalidated', async () => {
      await service.register({ email: 'alice@example.com', password: 'password123' });
      const t1 = await service.login({
        email: 'alice@example.com',
        password: 'password123',
      });
      const t2 = await service.refresh(t1.refreshToken);
      const t3 = await service.refresh(t2.refreshToken);

      // Attacker re-uses t1 → reuse error, family invalidated
      await expect(service.refresh(t1.refreshToken)).rejects.toBeInstanceOf(RefreshTokenReuseError);

      // Legit current token t3 is now collateral-invalidated (not reuse error — just invalid)
      await expect(service.refresh(t3.refreshToken)).rejects.toBeInstanceOf(
        InvalidRefreshTokenError,
      );
    });

    it('unknown refresh token → InvalidRefreshTokenError', async () => {
      await expect(service.refresh('totally-fake-token-not-in-db')).rejects.toBeInstanceOf(
        InvalidRefreshTokenError,
      );
    });

    it('each login starts a new family (independent rotation chains)', async () => {
      await service.register({ email: 'alice@example.com', password: 'password123' });
      const sessionA = await service.login({
        email: 'alice@example.com',
        password: 'password123',
      });
      const sessionB = await service.login({
        email: 'alice@example.com',
        password: 'password123',
      });

      // Rotating A does not invalidate B
      await service.refresh(sessionA.refreshToken);
      const stillValid = await service.refresh(sessionB.refreshToken);
      expect(stillValid.accessToken.length).toBeGreaterThan(0);
    });
  });
});
