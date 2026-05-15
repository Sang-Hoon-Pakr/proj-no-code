import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { MessageService, NotInRoomError } from '../../src/message/message.service';
import { RoomService } from '../../src/room/room.service';
import { setupTestDb } from '../setup/test-db';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;

async function seedUser(pool: Pool, id: string = uuidv7()): Promise<string> {
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`, [
    id,
    `${id}@example.com`,
    'argon2-placeholder',
  ]);
  return id;
}

describe('MessageService — idempotency invariant', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let roomService: RoomService;
  let messageService: MessageService;

  let roomId: string;
  let senderId: string;
  let otherMemberId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(PG_IMAGE).start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await setupTestDb(pool);
    roomService = new RoomService(pool);
    messageService = new MessageService(pool, roomService);
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE messages, direct_room_keys, room_members, rooms, blocks, users CASCADE',
    );
    senderId = await seedUser(pool);
    otherMemberId = await seedUser(pool);
    const room = await roomService.createDirect({
      userIdA: senderId,
      userIdB: otherMemberId,
    });
    roomId = room.id;
  });

  it('creates a message', async () => {
    const messageId = uuidv7();
    const msg = await messageService.create({
      messageId,
      roomId,
      senderId,
      content: 'hello',
    });
    expect(msg.id).toBe(messageId);
    expect(msg.content).toBe('hello');
  });

  it('same messageId twice → 1 row, same record returned', async () => {
    const input = { messageId: uuidv7(), roomId, senderId, content: 'hello' };
    const a = await messageService.create(input);
    const b = await messageService.create(input);

    expect(b.id).toBe(a.id);
    expect(b.createdAt.getTime()).toBe(a.createdAt.getTime());

    const { rowCount } = await pool.query('SELECT 1 FROM messages WHERE id = $1', [a.id]);
    expect(rowCount).toBe(1);
  });

  it('same messageId with different content → first write wins', async () => {
    const messageId = uuidv7();
    const a = await messageService.create({
      messageId,
      roomId,
      senderId,
      content: 'original',
    });
    const b = await messageService.create({
      messageId,
      roomId,
      senderId,
      content: 'OVERRIDE_ATTEMPT',
    });

    expect(b.content).toBe('original');
    expect(b.id).toBe(a.id);
  });

  it('different messageIds → separate rows', async () => {
    await messageService.create({
      messageId: uuidv7(),
      roomId,
      senderId,
      content: 'first',
    });
    await messageService.create({
      messageId: uuidv7(),
      roomId,
      senderId,
      content: 'second',
    });

    const { rowCount } = await pool.query('SELECT 1 FROM messages WHERE room_id = $1', [roomId]);
    expect(rowCount).toBe(2);
  });

  it('non-member sender → NotInRoomError', async () => {
    const outsiderId = await seedUser(pool);
    await expect(
      messageService.create({
        messageId: uuidv7(),
        roomId,
        senderId: outsiderId,
        content: 'unauthorized',
      }),
    ).rejects.toBeInstanceOf(NotInRoomError);

    // 메시지가 DB에 새로 들어가지 않았음을 확인 (게이트가 INSERT 전에 작동)
    const { rowCount } = await pool.query('SELECT 1 FROM messages WHERE room_id = $1', [roomId]);
    expect(rowCount).toBe(0);
  });

  it('non-existent room → NotInRoomError (existence 누설 방지)', async () => {
    await expect(
      messageService.create({
        messageId: uuidv7(),
        roomId: uuidv7(),
        senderId,
        content: 'into the void',
      }),
    ).rejects.toBeInstanceOf(NotInRoomError);
  });

  describe('seq monotonicity', () => {
    it('first message gets seq=1', async () => {
      const msg = await messageService.create({
        messageId: uuidv7(),
        roomId,
        senderId,
        content: 'first',
      });
      expect(msg.seq).toBe(1);
    });

    it('seq increases monotonically within a room (1, 2, 3, ...)', async () => {
      const seqs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const msg = await messageService.create({
          messageId: uuidv7(),
          roomId,
          senderId,
          content: `m${i}`,
        });
        seqs.push(msg.seq);
      }
      expect(seqs).toEqual([1, 2, 3, 4, 5]);
    });

    it('seq is per-room (independent counters)', async () => {
      // 또 다른 방 만들기
      const thirdUserId = await seedUser(pool);
      const otherRoom = await roomService.createDirect({
        userIdA: senderId,
        userIdB: thirdUserId,
      });

      const a = await messageService.create({
        messageId: uuidv7(),
        roomId,
        senderId,
        content: 'in room1',
      });
      const b = await messageService.create({
        messageId: uuidv7(),
        roomId: otherRoom.id,
        senderId,
        content: 'in room2',
      });

      expect(a.seq).toBe(1);
      expect(b.seq).toBe(1); // independent
    });

    it('idempotent re-send returns same seq (no increment)', async () => {
      const messageId = uuidv7();
      const a = await messageService.create({ messageId, roomId, senderId, content: 'a' });
      const b = await messageService.create({
        messageId,
        roomId,
        senderId,
        content: 'override-attempt',
      });

      expect(b.seq).toBe(a.seq);

      // 다음 메시지의 seq가 a.seq+1이어야 함 (idempotent 재호출이 카운터 증가 X)
      const c = await messageService.create({
        messageId: uuidv7(),
        roomId,
        senderId,
        content: 'next',
      });
      expect(c.seq).toBe(a.seq + 1);
    });
  });

  describe('listSince', () => {
    it('returns messages with seq > sinceSeq, ascending', async () => {
      for (let i = 0; i < 3; i++) {
        await messageService.create({
          messageId: uuidv7(),
          roomId,
          senderId,
          content: `m${i}`,
        });
      }

      const { messages, hasMore } = await messageService.listSince({
        roomId,
        userId: senderId,
        sinceSeq: 0,
      });

      expect(messages.map((m) => m.seq)).toEqual([1, 2, 3]);
      expect(messages.map((m) => m.content)).toEqual(['m0', 'm1', 'm2']);
      expect(hasMore).toBe(false);
    });

    it('respects sinceSeq cursor (only newer messages)', async () => {
      const ids: number[] = [];
      for (let i = 0; i < 4; i++) {
        const msg = await messageService.create({
          messageId: uuidv7(),
          roomId,
          senderId,
          content: `m${i}`,
        });
        ids.push(msg.seq);
      }

      const { messages } = await messageService.listSince({
        roomId,
        userId: senderId,
        sinceSeq: 2,
      });

      expect(messages.map((m) => m.seq)).toEqual([3, 4]);
    });

    it('respects limit and reports hasMore', async () => {
      for (let i = 0; i < 5; i++) {
        await messageService.create({
          messageId: uuidv7(),
          roomId,
          senderId,
          content: `m${i}`,
        });
      }

      const { messages, hasMore } = await messageService.listSince({
        roomId,
        userId: senderId,
        sinceSeq: 0,
        limit: 3,
      });

      expect(messages.length).toBe(3);
      expect(hasMore).toBe(true);
    });

    it('rejects non-member → NotInRoomError', async () => {
      const outsider = await seedUser(pool);
      await expect(
        messageService.listSince({ roomId, userId: outsider, sinceSeq: 0 }),
      ).rejects.toBeInstanceOf(NotInRoomError);
    });

    it('empty result when sinceSeq is at or beyond max', async () => {
      const msg = await messageService.create({
        messageId: uuidv7(),
        roomId,
        senderId,
        content: 'only',
      });

      const { messages } = await messageService.listSince({
        roomId,
        userId: senderId,
        sinceSeq: msg.seq,
      });

      expect(messages).toEqual([]);
    });
  });
});
