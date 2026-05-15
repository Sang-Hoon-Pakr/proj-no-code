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
import {
  ProfileValidationError,
  UserNotFoundError,
  UserService,
} from '../../src/user/user.service';
import { setupTestDb } from '../setup/test-db';
import { startRedis } from '../setup/test-redis';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;

describe('UserService — profile', () => {
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

  describe('register → nickname default = email prefix', () => {
    it('new user gets nickname = email-prefix on registration', async () => {
      const u = await registerAndLogin('alice@example.com');
      const profile = await userService.getById(u.userId);
      expect(profile.nickname).toBe('alice');
      expect(profile.profileImageUrl).toBeNull();
      expect(profile.statusMessage).toBeNull();
    });
  });

  describe('UserService.getById', () => {
    it('returns profile fields', async () => {
      const u = await registerAndLogin('bob@example.com');
      const profile = await userService.getById(u.userId);
      expect(profile.id).toBe(u.userId);
      expect(profile.email).toBe('bob@example.com');
    });

    it('throws UserNotFoundError for unknown id', async () => {
      await expect(userService.getById(uuidv7())).rejects.toBeInstanceOf(UserNotFoundError);
    });
  });

  describe('UserService.updateProfile', () => {
    it('updates only provided fields (undefined preserves existing)', async () => {
      const u = await registerAndLogin('carol@example.com');

      const after1 = await userService.updateProfile(u.userId, {
        nickname: 'Carol Chen',
      });
      expect(after1.nickname).toBe('Carol Chen');
      expect(after1.profileImageUrl).toBeNull();

      const after2 = await userService.updateProfile(u.userId, {
        statusMessage: '안녕하세요!',
      });
      expect(after2.nickname).toBe('Carol Chen'); // preserved
      expect(after2.statusMessage).toBe('안녕하세요!');
    });

    it('explicit null clears the field', async () => {
      const u = await registerAndLogin('dan@example.com');
      await userService.updateProfile(u.userId, { statusMessage: 'temporary' });
      const cleared = await userService.updateProfile(u.userId, { statusMessage: null });
      expect(cleared.statusMessage).toBeNull();
    });

    it('rejects too-long nickname (>50)', async () => {
      const u = await registerAndLogin('eve@example.com');
      await expect(
        userService.updateProfile(u.userId, { nickname: 'a'.repeat(51) }),
      ).rejects.toBeInstanceOf(ProfileValidationError);
    });

    it('rejects whitespace-only nickname', async () => {
      const u = await registerAndLogin('fra@example.com');
      await expect(userService.updateProfile(u.userId, { nickname: '   ' })).rejects.toBeInstanceOf(
        ProfileValidationError,
      );
    });

    it('rejects non-URL profile image', async () => {
      const u = await registerAndLogin('gina@example.com');
      await expect(
        userService.updateProfile(u.userId, { profileImageUrl: 'not-a-url' }),
      ).rejects.toBeInstanceOf(ProfileValidationError);
    });
  });

  describe('HTTP /api/v1/users/me', () => {
    it('GET requires auth → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/users/me');
      expect(res.status).toBe(401);
    });

    it('GET returns own profile', async () => {
      const u = await registerAndLogin('hana@example.com');
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${u.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('hana@example.com');
      expect(res.body.data.nickname).toBe('hana');
    });

    it('PATCH updates nickname', async () => {
      const u = await registerAndLogin('iris@example.com');
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${u.accessToken}`)
        .send({ nickname: 'Iris Park', statusMessage: '코딩 중' });
      expect(res.status).toBe(200);
      expect(res.body.data.nickname).toBe('Iris Park');
      expect(res.body.data.statusMessage).toBe('코딩 중');
    });

    it('PATCH with invalid data → 422 with VALIDATION code', async () => {
      const u = await registerAndLogin('jay@example.com');
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${u.accessToken}`)
        .send({ nickname: '' });
      expect(res.status).toBe(422);
      expect(res.body.detail.code).toBe('VALIDATION');
    });
  });
});
