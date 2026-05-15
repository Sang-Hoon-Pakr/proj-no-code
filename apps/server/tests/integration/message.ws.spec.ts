import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { uuidv7 } from 'uuidv7';
import { AppModule } from '../../src/app.module';
import { PG_POOL } from '../../src/config/database.module';
import { setupApp } from '../../src/setup-app';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;
const EVENT_TIMEOUT_MS = 3000;

interface AuthedUser {
  userId: string;
  accessToken: string;
}

interface AckOk {
  ok: true;
  data: { messageId: string; seq: number; createdAt: string };
}
interface AckError {
  ok: false;
  error: { code: string; message: string };
}
type Ack = AckOk | AckError;

interface MessageDto {
  messageId: string;
  roomId: string;
  senderId: string;
  content: string;
  seq: number;
  createdAt: string;
}

interface SinceAckOk {
  ok: true;
  data: { messages: MessageDto[]; hasMore: boolean };
}
type SinceAck = SinceAckOk | AckError;

describe('Message WS Gateway', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: INestApplication;
  let port: number;

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
      CREATE TABLE blocks (
        blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (blocker_id, blocked_id)
      );
      CREATE TABLE rooms (
        id          UUID PRIMARY KEY,
        type        TEXT NOT NULL CHECK (type IN ('direct', 'group')),
        name        TEXT,
        created_by  UUID NOT NULL REFERENCES users(id),
        last_seq    BIGINT NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE room_members (
        room_id        UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id        UUID NOT NULL REFERENCES users(id),
        role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
        joined_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_read_seq  BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (room_id, user_id)
      );
      CREATE TABLE direct_room_keys (
        user_a_id  UUID NOT NULL,
        user_b_id  UUID NOT NULL,
        room_id    UUID NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
        PRIMARY KEY (user_a_id, user_b_id),
        CHECK (user_a_id < user_b_id)
      );
      CREATE TABLE messages (
        id          UUID PRIMARY KEY,
        room_id     UUID NOT NULL REFERENCES rooms(id),
        sender_id   UUID NOT NULL REFERENCES users(id),
        content     TEXT NOT NULL,
        seq         BIGINT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (room_id, seq)
      );
    `);

    process.env.JWT_SECRET = 'test-secret-for-jwt-signing-do-not-use-in-prod';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PG_POOL)
      .useValue(pool)
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0); // any port
    const address = app.getHttpServer().address();
    port = typeof address === 'object' && address ? address.port : 0;
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE messages, direct_room_keys, room_members, rooms, blocks, refresh_tokens, users CASCADE',
    );
  });

  async function registerAndLogin(email: string): Promise<AuthedUser> {
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' });
    return { userId: reg.body.data.id, accessToken: login.body.data.accessToken };
  }

  async function createDirectRoom(a: AuthedUser, b: AuthedUser): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/rooms/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ otherUserId: b.userId });
    return res.body.data.id;
  }

  async function connectSocket(token?: string): Promise<ClientSocket> {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: token ? { token } : undefined,
    });
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (e: Error) => {
        cleanup();
        reject(e);
      };
      const cleanup = () => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
    });
    return socket;
  }

  function emitWithAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
    return new Promise<T>((resolve) => {
      socket.emit(event, payload, (ack: T) => resolve(ack));
    });
  }

  function nextEvent<T>(socket: ClientSocket, event: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for ${event}`)),
        EVENT_TIMEOUT_MS,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  describe('connection auth', () => {
    it('rejects connection without token', async () => {
      await expect(connectSocket()).rejects.toBeInstanceOf(Error);
    });

    it('rejects connection with invalid token', async () => {
      await expect(connectSocket('totally-fake-token')).rejects.toBeInstanceOf(Error);
    });

    it('accepts connection with valid token', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const socket = await connectSocket(alice.accessToken);
      expect(socket.connected).toBe(true);
      socket.close();
    });
  });

  describe('message:send', () => {
    it('persists + acks with messageId/createdAt', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const roomId = await createDirectRoom(alice, bob);

      const socket = await connectSocket(alice.accessToken);
      const messageId = uuidv7();
      const ack = await emitWithAck<Ack>(socket, 'message:send', {
        messageId,
        roomId,
        content: 'hello',
      });

      expect(ack.ok).toBe(true);
      if (ack.ok) {
        expect(ack.data.messageId).toBe(messageId);
        expect(ack.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }

      const { rowCount } = await pool.query('SELECT 1 FROM messages WHERE id = $1', [messageId]);
      expect(rowCount).toBe(1);
      socket.close();
    });

    it('non-member sender → error ack with NOT_FOUND', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const charlie = await registerAndLogin('charlie@example.com');
      const roomId = await createDirectRoom(alice, bob);

      const socket = await connectSocket(charlie.accessToken);
      const ack = await emitWithAck<Ack>(socket, 'message:send', {
        messageId: uuidv7(),
        roomId,
        content: 'unauthorized',
      });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error.code).toBe('NOT_FOUND');
      socket.close();
    });

    it('same messageId twice → 1 row, both acks succeed (idempotent)', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const roomId = await createDirectRoom(alice, bob);

      const socket = await connectSocket(alice.accessToken);
      const messageId = uuidv7();
      const ack1 = await emitWithAck<Ack>(socket, 'message:send', {
        messageId,
        roomId,
        content: 'hello',
      });
      const ack2 = await emitWithAck<Ack>(socket, 'message:send', {
        messageId,
        roomId,
        content: 'hello again',
      });

      expect(ack1.ok && ack2.ok).toBe(true);
      const { rowCount } = await pool.query('SELECT 1 FROM messages WHERE id = $1', [messageId]);
      expect(rowCount).toBe(1);
      socket.close();
    });
  });

  describe('fan-out: message:new broadcast', () => {
    it('other room members receive message:new', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const roomId = await createDirectRoom(alice, bob);

      const aliceSocket = await connectSocket(alice.accessToken);
      const bobSocket = await connectSocket(bob.accessToken);

      const messagePromise = nextEvent<MessageDto>(bobSocket, 'message:new');
      const messageId = uuidv7();
      await emitWithAck<Ack>(aliceSocket, 'message:send', {
        messageId,
        roomId,
        content: 'hi bob',
      });

      const received = await messagePromise;
      expect(received.messageId).toBe(messageId);
      expect(received.senderId).toBe(alice.userId);
      expect(received.content).toBe('hi bob');
      expect(received.roomId).toBe(roomId);

      aliceSocket.close();
      bobSocket.close();
    });

    it('outsider (non-member of room) does not receive message:new', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const charlie = await registerAndLogin('charlie@example.com');
      const roomId = await createDirectRoom(alice, bob);

      const aliceSocket = await connectSocket(alice.accessToken);
      const charlieSocket = await connectSocket(charlie.accessToken);

      let charlieGotIt = false;
      charlieSocket.on('message:new', () => {
        charlieGotIt = true;
      });

      await emitWithAck<Ack>(aliceSocket, 'message:send', {
        messageId: uuidv7(),
        roomId,
        content: 'private',
      });

      // 짧게 대기하여 fan-out 누수 여부 확인. 폴링이 아닌 한도 대기.
      await new Promise((r) => setTimeout(r, 200));
      expect(charlieGotIt).toBe(false);

      aliceSocket.close();
      charlieSocket.close();
    });
  });

  describe('messages:since (재연결 동기화)', () => {
    it('returns messages with seq > sinceSeq in ascending order', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const roomId = await createDirectRoom(alice, bob);

      const aliceSocket = await connectSocket(alice.accessToken);
      // 3개 메시지 보냄 (seq 1, 2, 3)
      for (let i = 0; i < 3; i++) {
        await emitWithAck<Ack>(aliceSocket, 'message:send', {
          messageId: uuidv7(),
          roomId,
          content: `m${i}`,
        });
      }

      const bobSocket = await connectSocket(bob.accessToken);
      const ack = await emitWithAck<SinceAck>(bobSocket, 'messages:since', {
        roomId,
        sinceSeq: 0,
      });

      expect(ack.ok).toBe(true);
      if (ack.ok) {
        expect(ack.data.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
        expect(ack.data.messages.map((m) => m.content)).toEqual(['m0', 'm1', 'm2']);
        expect(ack.data.hasMore).toBe(false);
      }

      aliceSocket.close();
      bobSocket.close();
    });

    it('respects sinceSeq cursor — only newer than cursor', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const roomId = await createDirectRoom(alice, bob);

      const aliceSocket = await connectSocket(alice.accessToken);
      for (let i = 0; i < 4; i++) {
        await emitWithAck<Ack>(aliceSocket, 'message:send', {
          messageId: uuidv7(),
          roomId,
          content: `m${i}`,
        });
      }

      const bobSocket = await connectSocket(bob.accessToken);
      const ack = await emitWithAck<SinceAck>(bobSocket, 'messages:since', {
        roomId,
        sinceSeq: 2,
      });

      expect(ack.ok).toBe(true);
      if (ack.ok) {
        expect(ack.data.messages.map((m) => m.seq)).toEqual([3, 4]);
      }

      aliceSocket.close();
      bobSocket.close();
    });

    it('non-member → NOT_FOUND error', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const charlie = await registerAndLogin('charlie@example.com');
      const roomId = await createDirectRoom(alice, bob);

      const charlieSocket = await connectSocket(charlie.accessToken);
      const ack = await emitWithAck<SinceAck>(charlieSocket, 'messages:since', {
        roomId,
        sinceSeq: 0,
      });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error.code).toBe('NOT_FOUND');

      charlieSocket.close();
    });

    it('hasMore=true when limit is hit', async () => {
      const alice = await registerAndLogin('alice@example.com');
      const bob = await registerAndLogin('bob@example.com');
      const roomId = await createDirectRoom(alice, bob);

      const aliceSocket = await connectSocket(alice.accessToken);
      for (let i = 0; i < 5; i++) {
        await emitWithAck<Ack>(aliceSocket, 'message:send', {
          messageId: uuidv7(),
          roomId,
          content: `m${i}`,
        });
      }

      const bobSocket = await connectSocket(bob.accessToken);
      const ack = await emitWithAck<SinceAck>(bobSocket, 'messages:since', {
        roomId,
        sinceSeq: 0,
        limit: 3,
      });

      expect(ack.ok).toBe(true);
      if (ack.ok) {
        expect(ack.data.messages.length).toBe(3);
        expect(ack.data.hasMore).toBe(true);
      }

      aliceSocket.close();
      bobSocket.close();
    });
  });
});
