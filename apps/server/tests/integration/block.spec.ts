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
import { BlockService, BlockSelfError } from '../../src/block/block.service';
import { setupTestDb } from '../setup/test-db';
import { startRedis } from '../setup/test-redis';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;

describe('Block service + HTTP + Message integration', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let app: INestApplication;
  let blockService: BlockService;

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

    blockService = new BlockService(pool);
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

  describe('BlockService', () => {
    it('create + list + remove (idempotent create)', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');

      await blockService.create(alice.userId, bob.userId);
      await blockService.create(alice.userId, bob.userId); // idempotent

      const list = await blockService.list(alice.userId);
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(bob.userId);
      expect(list[0].nickname).toBe('bob');

      await blockService.remove(alice.userId, bob.userId);
      expect((await blockService.list(alice.userId)).length).toBe(0);
    });

    it('rejects self-block → BlockSelfError', async () => {
      const alice = await registerAndLogin('alice@example.com');
      await expect(blockService.create(alice.userId, alice.userId)).rejects.toBeInstanceOf(
        BlockSelfError,
      );
    });

    it('isBlockedBetween → true for both directions', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');

      expect(await blockService.isBlockedBetween(alice.userId, bob.userId)).toBe(false);

      await blockService.create(alice.userId, bob.userId);
      expect(await blockService.isBlockedBetween(alice.userId, bob.userId)).toBe(true);
      expect(await blockService.isBlockedBetween(bob.userId, alice.userId)).toBe(true);
    });
  });

  describe('HTTP /api/v1/users/me/blocks', () => {
    it('POST + GET + DELETE happy path', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');

      const post = await request(app.getHttpServer())
        .post('/api/v1/users/me/blocks')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ userId: bob.userId });
      expect(post.status).toBe(204);

      const list = await request(app.getHttpServer())
        .get('/api/v1/users/me/blocks')
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBe(1);
      expect(list.body.data[0].id).toBe(bob.userId);

      const del = await request(app.getHttpServer())
        .delete(`/api/v1/users/me/blocks/${bob.userId}`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(del.status).toBe(204);
    });

    it('POST self-block → 422', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/blocks')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ userId: alice.userId });
      expect(res.status).toBe(422);
      expect(res.body.detail.code).toBe('BLOCK_SELF');
    });

    it('GET requires auth → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/users/me/blocks');
      expect(res.status).toBe(401);
    });
  });

  describe('Message integration — block enforcement', () => {
    it('1:1방에서 차단되면 메시지 전송 거부 (NotInRoomError 통일)', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');

      // 1:1방 생성 (차단 전이라 통과)
      const room = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ otherUserId: bob.userId });
      expect(room.status).toBe(200);

      // alice가 bob 차단
      await blockService.create(alice.userId, bob.userId);

      // alice는 메시지 보내려 함 → 차단 사실 노출 방지 위해 NotInRoomError 통일
      const { MessageService } = await import('../../src/message/message.service');
      const { RoomService } = await import('../../src/room/room.service');
      const msgService = new MessageService(pool, new RoomService(pool), blockService);
      await expect(
        msgService.create({
          messageId: uuidv7(),
          roomId: room.body.data.id,
          senderId: alice.userId,
          content: 'cant deliver',
        }),
      ).rejects.toThrow(); // NotInRoomError

      // 반대 방향도 차단됨 (양방향)
      await expect(
        msgService.create({
          messageId: uuidv7(),
          roomId: room.body.data.id,
          senderId: bob.userId,
          content: 'also blocked',
        }),
      ).rejects.toThrow();

      // 차단 풀면 다시 전송 가능
      await blockService.remove(alice.userId, bob.userId);
      const success = await msgService.create({
        messageId: uuidv7(),
        roomId: room.body.data.id,
        senderId: alice.userId,
        content: 'now ok',
      });
      expect(success.id).toBeTruthy();
    });

    it('그룹방은 block 영향 없음 (공개 broadcast 모델)', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const charlie = await registerAndLogin('charlie@example.com');

      const room = await request(app.getHttpServer())
        .post('/api/v1/rooms/group')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: 'team', memberIds: [bob.userId, charlie.userId] });

      await blockService.create(alice.userId, bob.userId);

      const { MessageService } = await import('../../src/message/message.service');
      const { RoomService } = await import('../../src/room/room.service');
      const msgService = new MessageService(pool, new RoomService(pool), blockService);

      // 그룹방에서는 alice가 bob 차단해도 alice의 메시지가 그룹에 전송됨
      const ok = await msgService.create({
        messageId: uuidv7(),
        roomId: room.body.data.id,
        senderId: alice.userId,
        content: 'group msg',
      });
      expect(ok.id).toBeTruthy();
    });
  });
});
