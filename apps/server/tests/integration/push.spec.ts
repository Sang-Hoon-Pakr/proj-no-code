import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { uuidv7 } from 'uuidv7';
import type Redis from 'ioredis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { AppModule } from '../../src/app.module';
import { PG_POOL } from '../../src/config/database.module';
import { REDIS_CLIENT } from '../../src/config/redis.module';
import { setupApp } from '../../src/setup-app';
import { InMemoryPushProvider, PUSH_PROVIDER } from '../../src/push/push.provider';
import { setupTestDb } from '../setup/test-db';
import { startRedis } from '../setup/test-redis';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;
const EVENT_TIMEOUT_MS = 3000;

interface Ack {
  ok: boolean;
}

describe('Push notifications', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let app: INestApplication;
  let port: number;
  let pushProvider: InMemoryPushProvider;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer(PG_IMAGE).start();
    pool = new Pool({ connectionString: pgContainer.getConnectionUri() });
    await setupTestDb(pool);
    const r = await startRedis();
    redisContainer = r.container;
    redis = r.client;

    process.env.JWT_SECRET = 'test-secret-for-jwt-signing-do-not-use-in-prod';

    pushProvider = new InMemoryPushProvider();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PG_POOL)
      .useValue(pool)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .overrideProvider(PUSH_PROVIDER)
      .useValue(pushProvider)
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    const addr = app.getHttpServer().address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
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
      'TRUNCATE user_devices, messages, direct_room_keys, room_members, rooms, blocks, refresh_tokens, users CASCADE',
    );
    await redis.flushall();
    pushProvider.reset();
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

  async function registerDevice(
    accessToken: string,
    deviceId: string,
    pushToken: string,
    platform = 'ios' as const,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post('/api/v1/users/me/devices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ deviceId, platform, pushToken });
  }

  async function connectSocket(token: string): Promise<ClientSocket> {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (e: Error) => reject(e));
    });
    return socket;
  }

  function emitWithAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
    return new Promise<T>((resolve) => {
      socket.emit(event, payload, (ack: T) => resolve(ack));
    });
  }

  async function waitForPush(timeoutMs = EVENT_TIMEOUT_MS): Promise<void> {
    const start = Date.now();
    while (pushProvider.sent.length === 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  describe('HTTP /api/v1/users/me/devices', () => {
    it('POST registers device (upsert by deviceId)', async () => {
      const u = await registerAndLogin('alice@example.com');

      const r1 = await request(app.getHttpServer())
        .post('/api/v1/users/me/devices')
        .set('Authorization', `Bearer ${u.accessToken}`)
        .send({ deviceId: 'dev-1', platform: 'ios', pushToken: 'token-A' });
      expect(r1.status).toBe(200);
      expect(r1.body.data.deviceId).toBe('dev-1');
      expect(r1.body.data.pushToken).toBe('token-A');

      // 같은 deviceId 다시 → upsert (token 갱신)
      const r2 = await request(app.getHttpServer())
        .post('/api/v1/users/me/devices')
        .set('Authorization', `Bearer ${u.accessToken}`)
        .send({ deviceId: 'dev-1', platform: 'ios', pushToken: 'token-B' });
      expect(r2.status).toBe(200);
      expect(r2.body.data.id).toBe(r1.body.data.id); // 같은 row
      expect(r2.body.data.pushToken).toBe('token-B');
    });

    it('rejects invalid platform → 422', async () => {
      const u = await registerAndLogin('alice@example.com');
      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/devices')
        .set('Authorization', `Bearer ${u.accessToken}`)
        .send({ deviceId: 'dev-1', platform: 'windows', pushToken: 'x' });
      expect(res.status).toBe(422);
    });

    it('GET list + DELETE', async () => {
      const u = await registerAndLogin('alice@example.com');
      await registerDevice(u.accessToken, 'dev-1', 'tok-1');
      await registerDevice(u.accessToken, 'dev-2', 'tok-2');

      const list = await request(app.getHttpServer())
        .get('/api/v1/users/me/devices')
        .set('Authorization', `Bearer ${u.accessToken}`);
      expect(list.body.data.length).toBe(2);

      const del = await request(app.getHttpServer())
        .delete('/api/v1/users/me/devices/dev-1')
        .set('Authorization', `Bearer ${u.accessToken}`);
      expect(del.status).toBe(204);

      const list2 = await request(app.getHttpServer())
        .get('/api/v1/users/me/devices')
        .set('Authorization', `Bearer ${u.accessToken}`);
      expect(list2.body.data.length).toBe(1);
    });

    it('requires auth → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/devices')
        .send({ deviceId: 'd', platform: 'ios' });
      expect(res.status).toBe(401);
    });
  });

  describe('Gateway integration — offline 멤버에게만 push', () => {
    it('수신자가 오프라인이면 push 발송 (payload는 본문 없음)', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      // bob 디바이스 2개 등록 (multi-device 시나리오)
      await registerDevice(bob.accessToken, 'bob-phone', 'bob-token-1');
      await registerDevice(bob.accessToken, 'bob-tablet', 'bob-token-2');

      // direct room 생성
      const room = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ otherUserId: bob.userId });
      const roomId = room.body.data.id;

      // alice만 접속, bob은 오프라인
      const aliceSocket = await connectSocket(alice.accessToken);
      const messageId = uuidv7();
      await emitWithAck<Ack>(aliceSocket, 'message:send', {
        messageId,
        roomId,
        content: 'hello bob',
      });

      await waitForPush();

      // bob의 두 디바이스 모두에 push 전송됨
      expect(pushProvider.sent.length).toBe(2);
      const tokens = pushProvider.sent.map((s) => s.token).sort();
      expect(tokens).toEqual(['bob-token-1', 'bob-token-2']);

      // security-rules.md: 페이로드에 본문 없음
      for (const sent of pushProvider.sent) {
        expect(sent.payload.notification.body).not.toContain('hello');
        expect(sent.payload.data.messageId).toBe(messageId);
        expect(sent.payload.data.senderId).toBe(alice.userId);
        expect(sent.payload.data.roomId).toBe(roomId);
        expect(sent.payload.data).not.toHaveProperty('content');
      }

      aliceSocket.close();
    });

    it('수신자가 온라인이면 push 발송 X', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      await registerDevice(bob.accessToken, 'bob-phone', 'bob-token-1');

      const room = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ otherUserId: bob.userId });

      const aliceSocket = await connectSocket(alice.accessToken);
      const bobSocket = await connectSocket(bob.accessToken);

      await emitWithAck<Ack>(aliceSocket, 'message:send', {
        messageId: uuidv7(),
        roomId: room.body.data.id,
        content: 'live message',
      });

      // 짧게 대기하여 push 누수 여부 확인
      await new Promise((r) => setTimeout(r, 300));
      expect(pushProvider.sent.length).toBe(0);

      aliceSocket.close();
      bobSocket.close();
    });

    it('sender 본인에게는 push 안 감 (echo 방지)', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      // alice도 자기 디바이스 등록
      await registerDevice(alice.accessToken, 'alice-phone', 'alice-token');
      await registerDevice(bob.accessToken, 'bob-phone', 'bob-token');

      const room = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ otherUserId: bob.userId });

      const aliceSocket = await connectSocket(alice.accessToken);
      await emitWithAck<Ack>(aliceSocket, 'message:send', {
        messageId: uuidv7(),
        roomId: room.body.data.id,
        content: 'm',
      });

      await waitForPush();

      // bob만 받고, alice 자신은 받지 않음
      expect(pushProvider.sent.length).toBe(1);
      expect(pushProvider.sent[0].token).toBe('bob-token');

      aliceSocket.close();
    });

    it('수신자가 디바이스 등록 없으면 push 발송 0건 (silent)', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      // bob 디바이스 등록 안 함

      const room = await request(app.getHttpServer())
        .post('/api/v1/rooms/direct')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ otherUserId: bob.userId });

      const aliceSocket = await connectSocket(alice.accessToken);
      await emitWithAck<Ack>(aliceSocket, 'message:send', {
        messageId: uuidv7(),
        roomId: room.body.data.id,
        content: 'm',
      });

      await new Promise((r) => setTimeout(r, 300));
      expect(pushProvider.sent.length).toBe(0);

      aliceSocket.close();
    });
  });
});
