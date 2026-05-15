import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import type Redis from 'ioredis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import {
  AuthService,
  EmailTakenError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RefreshTokenReuseError,
  ValidationError,
} from '../../src/auth/auth.service';
import { RedisBruteForceProtector } from '../../src/auth/brute-force';
import { setupTestDb } from '../setup/test-db';
import { startRedis } from '../setup/test-redis';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;
const JWT_SECRET = 'test-secret-for-jwt-signing-do-not-use-in-prod';

describe('AuthService', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let service: AuthService;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer(PG_IMAGE).start();
    pool = new Pool({ connectionString: pgContainer.getConnectionUri() });
    await setupTestDb(pool);
    const r = await startRedis();
    redisContainer = r.container;
    redis = r.client;
    service = new AuthService(pool, JWT_SECRET, new RedisBruteForceProtector(redis));
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.end();
    await pgContainer?.stop();
    await redis?.quit();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE refresh_tokens, users CASCADE');
    await redis.flushall();
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

  describe('brute-force lockout (security-rules: 5회 실패 → 15분 잠금)', () => {
    it('after 5 failed attempts, even valid password is rejected', async () => {
      await service.register({ email: 'alice@example.com', password: 'password123' });

      // 5번 잘못된 비밀번호 시도
      for (let i = 0; i < 5; i++) {
        await expect(
          service.login({ email: 'alice@example.com', password: 'WRONG' }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);
      }

      // 6번째에 진짜 비밀번호여도 잠금 → InvalidCredentialsError (정보 누설 X)
      await expect(
        service.login({ email: 'alice@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      // 잠금 카운터가 Redis에 있는지 확인 + TTL은 15분 근처
      const count = await redis.get('auth:fail:alice@example.com');
      expect(Number(count)).toBeGreaterThanOrEqual(5);
      const ttl = await redis.ttl('auth:fail:alice@example.com');
      expect(ttl).toBeGreaterThan(14 * 60);
      expect(ttl).toBeLessThanOrEqual(15 * 60);
    });

    it('successful login resets the counter', async () => {
      await service.register({ email: 'alice@example.com', password: 'password123' });

      // 4번 실패 (잠금 직전)
      for (let i = 0; i < 4; i++) {
        await expect(
          service.login({ email: 'alice@example.com', password: 'WRONG' }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);
      }

      // 정상 로그인 → 카운터 리셋
      await service.login({ email: 'alice@example.com', password: 'password123' });

      // Redis 키가 없어야 함
      const count = await redis.get('auth:fail:alice@example.com');
      expect(count).toBeNull();
    });

    it('counter is per-email (different emails do not affect each other)', async () => {
      await service.register({ email: 'alice@example.com', password: 'password123' });
      await service.register({ email: 'bob@example.com', password: 'password123' });

      for (let i = 0; i < 5; i++) {
        await expect(
          service.login({ email: 'alice@example.com', password: 'WRONG' }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);
      }

      // Bob은 영향 없음
      const tokens = await service.login({ email: 'bob@example.com', password: 'password123' });
      expect(tokens.accessToken.length).toBeGreaterThan(0);
    });

    it('unknown email also increments counter (no enumeration via lockout timing)', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          service.login({ email: 'nobody@example.com', password: 'password123' }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);
      }

      const count = await redis.get('auth:fail:nobody@example.com');
      expect(Number(count)).toBe(3);
    });
  });
});
