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
import { MessageService } from '../../src/message/message.service';
import { RoomService } from '../../src/room/room.service';
import { BlockService } from '../../src/block/block.service';
import { setupTestDb } from '../setup/test-db';
import { startRedis } from '../setup/test-redis';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;

describe('Room list — GET /api/v1/rooms/me', () => {
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

  it('GET /api/v1/rooms/me requires auth → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/rooms/me');
    expect(res.status).toBe(401);
  });

  it('returns empty list for user with no rooms', async () => {
    const alice = await registerAndLogin('alice@example.com');
    const res = await request(app.getHttpServer())
      .get('/api/v1/rooms/me')
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rooms).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.hasMore).toBe(false);
  });

  it('returns rooms sorted by last activity DESC (with no messages → room.createdAt)', async () => {
    const alice = await registerAndLogin('alice@example.com');
    const bob = await registerAndLogin('bob@example.com');
    const carol = await registerAndLogin('carol@example.com');

    // 방 3개 생성 (시간 순)
    const r1 = await roomService.createDirect({ userIdA: alice.userId, userIdB: bob.userId });
    await new Promise((r) => setTimeout(r, 10)); // 순서 확보
    const r2 = await roomService.createDirect({ userIdA: alice.userId, userIdB: carol.userId });
    await new Promise((r) => setTimeout(r, 10));
    const r3 = await roomService.createGroup({
      creatorId: alice.userId,
      memberIds: [bob.userId, carol.userId],
      name: 'team',
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/rooms/me')
      .set('Authorization', `Bearer ${alice.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rooms.map((r: { id: string }) => r.id)).toEqual([r3.id, r2.id, r1.id]);
    expect(res.body.rooms.every((r: { lastMessage: unknown }) => r.lastMessage === null)).toBe(
      true,
    );
  });

  it('includes lastMessage = highest seq message in room', async () => {
    const alice = await registerAndLogin('alice@example.com');
    const bob = await registerAndLogin('bob@example.com');
    const room = await roomService.createDirect({
      userIdA: alice.userId,
      userIdB: bob.userId,
    });

    await messageService.create({
      messageId: uuidv7(),
      roomId: room.id,
      senderId: alice.userId,
      content: 'first',
    });
    await messageService.create({
      messageId: uuidv7(),
      roomId: room.id,
      senderId: alice.userId,
      content: 'second',
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/rooms/me')
      .set('Authorization', `Bearer ${alice.accessToken}`);

    expect(res.body.rooms[0].lastMessage.content).toBe('second');
    expect(res.body.rooms[0].lastMessage.seq).toBe(2);
  });

  it('unreadCount accurate per user', async () => {
    const alice = await registerAndLogin('alice@example.com');
    const bob = await registerAndLogin('bob@example.com');
    const room = await roomService.createDirect({
      userIdA: alice.userId,
      userIdB: bob.userId,
    });
    // 3건 메시지
    for (let i = 0; i < 3; i++) {
      await messageService.create({
        messageId: uuidv7(),
        roomId: room.id,
        senderId: bob.userId,
        content: `m${i}`,
      });
    }
    // alice가 seq 2까지 읽음
    await messageService.markRead({ roomId: room.id, userId: alice.userId, seq: 2 });

    const res = await request(app.getHttpServer())
      .get('/api/v1/rooms/me')
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(res.body.rooms[0].unreadCount).toBe(1); // seq 3
  });

  it('direct room includes otherUser, group has null', async () => {
    const alice = await registerAndLogin('alice@example.com');
    const bob = await registerAndLogin('bob@example.com');
    await roomService.createDirect({ userIdA: alice.userId, userIdB: bob.userId });
    await new Promise((r) => setTimeout(r, 10));
    await roomService.createGroup({
      creatorId: alice.userId,
      memberIds: [bob.userId],
      name: 'team',
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/rooms/me')
      .set('Authorization', `Bearer ${alice.accessToken}`);

    // 최신 = group (otherUser null), 그 다음 direct (otherUser=bob)
    const [grp, dir] = res.body.rooms;
    expect(grp.type).toBe('group');
    expect(grp.otherUser).toBeNull();
    expect(dir.type).toBe('direct');
    expect(dir.otherUser.id).toBe(bob.userId);
    expect(dir.otherUser.nickname).toBe('bob');
  });

  it('only returns rooms the user is a member of (other user has different list)', async () => {
    const alice = await registerAndLogin('alice@example.com');
    const bob = await registerAndLogin('bob@example.com');
    const carol = await registerAndLogin('carol@example.com');
    await roomService.createDirect({ userIdA: alice.userId, userIdB: bob.userId });
    await roomService.createDirect({ userIdA: bob.userId, userIdB: carol.userId });

    const aliceList = await request(app.getHttpServer())
      .get('/api/v1/rooms/me')
      .set('Authorization', `Bearer ${alice.accessToken}`);
    const carolList = await request(app.getHttpServer())
      .get('/api/v1/rooms/me')
      .set('Authorization', `Bearer ${carol.accessToken}`);

    expect(aliceList.body.rooms.length).toBe(1);
    expect(carolList.body.rooms.length).toBe(1);
    // 다른 사람의 방이 아님
    expect(aliceList.body.rooms[0].id).not.toBe(carolList.body.rooms[0].id);
  });

  it('pagination: cursor returns next page', async () => {
    const alice = await registerAndLogin('alice@example.com');
    // 5개 그룹방 만들기
    for (let i = 0; i < 5; i++) {
      await roomService.createGroup({
        creatorId: alice.userId,
        memberIds: [],
        name: `room${i}`,
      });
      await new Promise((r) => setTimeout(r, 5));
    }

    const page1 = await request(app.getHttpServer())
      .get('/api/v1/rooms/me?limit=2')
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(page1.body.rooms.length).toBe(2);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app.getHttpServer())
      .get(`/api/v1/rooms/me?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(page2.body.rooms.length).toBe(2);
    // page1과 안 겹침
    const page1Ids = page1.body.rooms.map((r: { id: string }) => r.id);
    const page2Ids = page2.body.rooms.map((r: { id: string }) => r.id);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);

    const page3 = await request(app.getHttpServer())
      .get(`/api/v1/rooms/me?limit=2&cursor=${encodeURIComponent(page2.body.nextCursor)}`)
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(page3.body.rooms.length).toBe(1);
    expect(page3.body.hasMore).toBe(false);
    expect(page3.body.nextCursor).toBeNull();
  });
});
