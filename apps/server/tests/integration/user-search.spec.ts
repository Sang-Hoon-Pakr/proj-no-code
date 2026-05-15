import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type Redis from 'ioredis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { uuidv7 } from 'uuidv7';
import { AppModule } from '../../src/app.module';
import { PG_POOL } from '../../src/config/database.module';
import { REDIS_CLIENT } from '../../src/config/redis.module';
import { setupApp } from '../../src/setup-app';
import { UserService } from '../../src/user/user.service';
import { setupTestDb } from '../setup/test-db';
import { startRedis } from '../setup/test-redis';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;

describe('User search + getById', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let app: INestApplication;
  let userService: UserService;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer(PG_IMAGE).start();
    pool = new Pool({ connectionString: pgContainer.getConnectionUri() });
    await setupTestDb(pool);
    const r = await startRedis();
    redisContainer = r.container;
    redis = r.client;

    process.env.JWT_SECRET = 'test-secret-for-jwt-signing-do-not-use-in-prod';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PG_POOL)
      .useValue(pool)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();

    userService = new UserService(pool);
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await pgContainer?.stop();
    await redis?.quit();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE refresh_tokens, users CASCADE');
    await redis.flushall();
  });

  async function registerAndLogin(email: string): Promise<{ userId: string; accessToken: string }> {
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' });
    return { userId: reg.body.data.id, accessToken: login.body.data.accessToken };
  }

  describe('UserService.findByEmail', () => {
    it('returns profile for matching email', async () => {
      const u = await registerAndLogin('alice@example.com');
      const found = await userService.findByEmail('alice@example.com');
      expect(found?.id).toBe(u.userId);
      expect(found?.nickname).toBe('alice');
    });

    it('case-insensitive', async () => {
      await registerAndLogin('alice@example.com');
      const found = await userService.findByEmail('ALICE@EXAMPLE.COM');
      expect(found?.email).toBe('alice@example.com');
    });

    it('returns null for unknown email', async () => {
      const found = await userService.findByEmail('nobody@example.com');
      expect(found).toBeNull();
    });
  });

  describe('HTTP GET /api/v1/users/search', () => {
    it('requires auth → 401', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/users/search?email=alice@example.com',
      );
      expect(res.status).toBe(401);
    });

    it('returns profile on email match', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/search?email=alice@example.com')
        .set('Authorization', `Bearer ${bob.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(alice.userId);
      expect(res.body.data.nickname).toBe('alice');
    });

    it('returns 404 when email not found', async () => {
      const u = await registerAndLogin('alice@example.com');
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/search?email=nobody@example.com')
        .set('Authorization', `Bearer ${u.accessToken}`);
      expect(res.status).toBe(404);
      expect(res.body.detail.code).toBe('NOT_FOUND');
    });

    it('returns 422 when email param missing', async () => {
      const u = await registerAndLogin('alice@example.com');
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/search')
        .set('Authorization', `Bearer ${u.accessToken}`);
      expect(res.status).toBe(422);
    });

    it('self-search works (returns own profile)', async () => {
      const u = await registerAndLogin('alice@example.com');
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/search?email=alice@example.com')
        .set('Authorization', `Bearer ${u.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(u.userId);
    });
  });

  describe('HTTP GET /api/v1/users/:id', () => {
    it('returns profile by id', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${alice.userId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.nickname).toBe('alice');
    });

    it('returns 404 for unknown id', async () => {
      const u = await registerAndLogin('alice@example.com');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${uuidv7()}`)
        .set('Authorization', `Bearer ${u.accessToken}`);
      expect(res.status).toBe(404);
    });

    it('static routes (me, search) take precedence over :id', async () => {
      // 라우트 순서 회귀 가드: /users/me는 :id로 매칭되면 안 됨
      const u = await registerAndLogin('alice@example.com');
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${u.accessToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.id).toBe(u.userId);
    });
  });
});
