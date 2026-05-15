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
import { MessageService, NotInRoomError } from '../../src/message/message.service';
import { RoomService } from '../../src/room/room.service';
import { BlockService } from '../../src/block/block.service';
import { setupTestDb } from '../setup/test-db';
import { startRedis } from '../setup/test-redis';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;

describe('Message history — GET /api/v1/rooms/:id/messages', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let app: INestApplication;
  let roomService: RoomService;
  let messageService: MessageService;

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

    roomService = new RoomService(pool);
    messageService = new MessageService(pool, roomService, new BlockService(pool));
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
      'TRUNCATE messages, direct_room_keys, room_members, rooms, blocks, refresh_tokens, users CASCADE',
    );
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

  async function seedRoomWithMessages(messageCount: number): Promise<{
    alice: { userId: string; accessToken: string };
    bob: { userId: string; accessToken: string };
    roomId: string;
  }> {
    const alice = await registerAndLogin('alice@example.com');
    const bob = await registerAndLogin('bob@example.com');
    const room = await roomService.createDirect({
      userIdA: alice.userId,
      userIdB: bob.userId,
    });
    for (let i = 0; i < messageCount; i++) {
      await messageService.create({
        messageId: uuidv7(),
        roomId: room.id,
        senderId: alice.userId,
        content: `m${i}`,
      });
    }
    return { alice, bob, roomId: room.id };
  }

  describe('service-level: listInRoom', () => {
    it('returns messages in DESC order (newest first)', async () => {
      const { alice, roomId } = await seedRoomWithMessages(3);
      const result = await messageService.listInRoom({ roomId, userId: alice.userId });
      expect(result.messages.map((m) => m.seq)).toEqual([3, 2, 1]);
      expect(result.messages.map((m) => m.content)).toEqual(['m2', 'm1', 'm0']);
      expect(result.hasMore).toBe(false);
      expect(result.nextBefore).toBeNull();
    });

    it('respects before cursor (exclusive)', async () => {
      const { alice, roomId } = await seedRoomWithMessages(5);
      const result = await messageService.listInRoom({
        roomId,
        userId: alice.userId,
        before: 4,
      });
      expect(result.messages.map((m) => m.seq)).toEqual([3, 2, 1]);
    });

    it('respects limit and reports hasMore + nextBefore', async () => {
      const { alice, roomId } = await seedRoomWithMessages(5);
      const result = await messageService.listInRoom({
        roomId,
        userId: alice.userId,
        limit: 2,
      });
      expect(result.messages.map((m) => m.seq)).toEqual([5, 4]);
      expect(result.hasMore).toBe(true);
      expect(result.nextBefore).toBe(4);
    });

    it('non-member → NotInRoomError', async () => {
      const { roomId } = await seedRoomWithMessages(1);
      const charlie = await registerAndLogin('charlie@example.com');
      await expect(
        messageService.listInRoom({ roomId, userId: charlie.userId }),
      ).rejects.toBeInstanceOf(NotInRoomError);
    });

    it('empty room → empty array', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const room = await roomService.createDirect({
        userIdA: alice.userId,
        userIdB: bob.userId,
      });
      const result = await messageService.listInRoom({
        roomId: room.id,
        userId: alice.userId,
      });
      expect(result.messages).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('HTTP: GET /api/v1/rooms/:id/messages', () => {
    it('requires auth → 401', async () => {
      const { roomId } = await seedRoomWithMessages(1);
      const res = await request(app.getHttpServer()).get(`/api/v1/rooms/${roomId}/messages`);
      expect(res.status).toBe(401);
    });

    it('returns messages DESC + nextBefore for next page', async () => {
      const { alice, roomId } = await seedRoomWithMessages(5);

      const page1 = await request(app.getHttpServer())
        .get(`/api/v1/rooms/${roomId}/messages?limit=2`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(page1.status).toBe(200);
      expect(page1.body.messages.map((m: { seq: number }) => m.seq)).toEqual([5, 4]);
      expect(page1.body.hasMore).toBe(true);
      expect(page1.body.nextBefore).toBe(4);

      const page2 = await request(app.getHttpServer())
        .get(`/api/v1/rooms/${roomId}/messages?limit=2&before=${page1.body.nextBefore}`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(page2.body.messages.map((m: { seq: number }) => m.seq)).toEqual([3, 2]);

      const page3 = await request(app.getHttpServer())
        .get(`/api/v1/rooms/${roomId}/messages?limit=2&before=${page2.body.nextBefore}`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(page3.body.messages.map((m: { seq: number }) => m.seq)).toEqual([1]);
      expect(page3.body.hasMore).toBe(false);
      expect(page3.body.nextBefore).toBeNull();
    });

    it('non-member → 404 NOT_FOUND', async () => {
      const { roomId } = await seedRoomWithMessages(1);
      const charlie = await registerAndLogin('charlie@example.com');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${charlie.accessToken}`);
      expect(res.status).toBe(404);
      expect(res.body.detail.code).toBe('NOT_FOUND');
    });
  });
});
