import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PG_POOL } from '../../src/config/database.module';
import { setupApp } from '../../src/setup-app';
import { setupTestDb } from '../setup/test-db';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;

describe('Auth HTTP', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: INestApplication;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(PG_IMAGE).start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await setupTestDb(pool);

    process.env.JWT_SECRET = 'test-secret-for-jwt-signing-do-not-use-in-prod';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PG_POOL)
      .useValue(pool)
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE refresh_tokens, users CASCADE');
  });

  describe('POST /api/v1/auth/register', () => {
    it('returns 201 + user on valid input', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.data.email).toBe('alice@example.com');
      expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns 409 with RFC 7807 problem on duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: 'password123' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: 'different456' });

      expect(res.status).toBe(409);
      expect(res.body.type).toBeTruthy();
      expect(res.body.title).toBeTruthy();
      expect(res.body.status).toBe(409);
      expect(res.body.detail).toBeTruthy();
      expect(res.body.detail.code).toBe('EMAIL_TAKEN');
    });

    it('returns 422 on invalid email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'password123' });

      expect(res.status).toBe(422);
      expect(res.body.detail.code).toBe('VALIDATION');
    });

    it('returns 422 on password too short', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: 'short' });

      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns 200 + tokens on valid credentials', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: 'password123' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeTruthy();
      expect(res.body.data.refreshToken).toBeTruthy();
    });

    it('returns 401 on wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: 'password123' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'WRONG' });

      expect(res.status).toBe(401);
      expect(res.body.detail.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 401 on unknown email (does not leak)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.detail.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    async function loginFresh(): Promise<{ accessToken: string; refreshToken: string }> {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: 'password123' });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'password123' });
      return res.body.data;
    }

    it('returns 200 + new pair, invalidates old refresh', async () => {
      const t1 = await loginFresh();

      const r = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: t1.refreshToken });

      expect(r.status).toBe(200);
      expect(r.body.data.refreshToken).not.toBe(t1.refreshToken);

      const reuse = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: t1.refreshToken });
      expect(reuse.status).toBe(401);
    });

    it('returns 401 on unknown refresh token', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'totally-fake' });

      expect(r.status).toBe(401);
      expect(r.body.detail.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });
});
