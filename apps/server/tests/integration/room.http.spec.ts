import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type Redis from 'ioredis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { AppModule } from '../../src/app.module';
import { PG_POOL } from '../../src/config/database.module';
import { REDIS_CLIENT } from '../../src/config/redis.module';
import { setupApp } from '../../src/setup-app';
import { setupTestDb } from '../setup/test-db';
import { startRedis } from '../setup/test-redis';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;

interface AuthedUser {
  userId: string;
  accessToken: string;
  email: string;
}

describe('Room HTTP', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let app: INestApplication;

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
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await pgContainer?.stop();
    await redis?.quit();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE direct_room_keys, room_members, rooms, blocks, refresh_tokens, users CASCADE',
    );
    await redis.flushall();
  });

  async function registerAndLogin(email: string): Promise<AuthedUser> {
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' });
    return {
      userId: reg.body.data.id,
      accessToken: login.body.data.accessToken,
      email,
    };
  }

  describe('POST /api/v1/rooms/direct (auth required)', () => {
    it('returns 401 without Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .send({ otherUserId: '00000000-0000-7000-8000-000000000001' });
      expect(res.status).toBe(401);
    });

    it('returns 401 with malformed token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .set('Authorization', 'Bearer not-a-real-token')
        .send({ otherUserId: '00000000-0000-7000-8000-000000000001' });
      expect(res.status).toBe(401);
    });

    it('creates direct room with current user + otherUserId', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');

      const res = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ otherUserId: bob.userId });

      expect(res.status).toBe(200);
      expect(res.body.data.type).toBe('direct');
      expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('same pair twice → same room', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');

      const r1 = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ otherUserId: bob.userId });
      const r2 = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ otherUserId: bob.userId });

      expect(r2.body.data.id).toBe(r1.body.data.id);
    });

    it('self → 422', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const res = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ otherUserId: alice.userId });
      expect(res.status).toBe(422);
      expect(res.body.detail.code).toBe('SELF_ROOM');
    });
  });

  describe('POST /api/v1/rooms/group', () => {
    it('returns 200 + room with creator as admin', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');

      const res = await request(app.getHttpServer())
        .post('/api/v1/rooms/group')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: '점심팟', memberIds: [bob.userId] });

      expect(res.status).toBe(200);
      expect(res.body.data.type).toBe('group');
      expect(res.body.data.name).toBe('점심팟');
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rooms/group')
        .send({ name: 'x', memberIds: [] });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/rooms/:id/members', () => {
    it('admin can add member → 204', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const charlie = await registerAndLogin('charlie@example.com');

      const create = await request(app.getHttpServer())
        .post('/api/v1/rooms/group')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: 'g', memberIds: [bob.userId] });
      const roomId = create.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/rooms/${roomId}/members`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ userId: charlie.userId });

      expect(res.status).toBe(204);
    });

    it('non-admin → 403', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const charlie = await registerAndLogin('charlie@example.com');

      const create = await request(app.getHttpServer())
        .post('/api/v1/rooms/group')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: 'g', memberIds: [bob.userId] });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/rooms/${create.body.data.id}/members`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ userId: charlie.userId });

      expect(res.status).toBe(403);
      expect(res.body.detail.code).toBe('NOT_AUTHORIZED');
    });

    it('non-existent room → 404', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const charlie = await registerAndLogin('charlie@example.com');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/rooms/00000000-0000-7000-8000-000000000999/members`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ userId: charlie.userId });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/rooms/:id/leave', () => {
    it('removes the user from room → 204', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');

      const create = await request(app.getHttpServer())
        .post('/api/v1/rooms/group')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: 'g', memberIds: [bob.userId] });
      const roomId = create.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/rooms/${roomId}/leave`)
        .set('Authorization', `Bearer ${bob.accessToken}`);

      expect(res.status).toBe(204);

      const { rowCount } = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, bob.userId],
      );
      expect(rowCount).toBe(0);
    });
  });
});
