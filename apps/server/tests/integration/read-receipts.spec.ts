import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { MessageService, NotInRoomError } from '../../src/message/message.service';
import { RoomService } from '../../src/room/room.service';
import { BlockService } from '../../src/block/block.service';
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

describe('MessageService — read receipts', () => {
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
    messageService = new MessageService(pool, roomService, new BlockService(pool));
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE messages, direct_room_keys, room_members, rooms, blocks, refresh_tokens, users CASCADE',
    );
    senderId = await seedUser(pool);
    otherMemberId = await seedUser(pool);
    const room = await roomService.createDirect({
      userIdA: senderId,
      userIdB: otherMemberId,
    });
    roomId = room.id;
  });

  async function sendN(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await messageService.create({
        messageId: uuidv7(),
        roomId,
        senderId,
        content: `m${i}`,
      });
    }
  }

  describe('markRead', () => {
    it('updates last_read_seq for the member', async () => {
      await sendN(3);
      await messageService.markRead({ roomId, userId: otherMemberId, seq: 2 });

      const { rows } = await pool.query<{ last_read_seq: string }>(
        'SELECT last_read_seq FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, otherMemberId],
      );
      expect(Number(rows[0].last_read_seq)).toBe(2);
    });

    it('is monotonic — smaller seq is ignored (GREATEST behavior)', async () => {
      await sendN(5);
      await messageService.markRead({ roomId, userId: otherMemberId, seq: 4 });
      // 작은 값으로 다시 호출 → 4 유지
      await messageService.markRead({ roomId, userId: otherMemberId, seq: 2 });

      const { rows } = await pool.query<{ last_read_seq: string }>(
        'SELECT last_read_seq FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, otherMemberId],
      );
      expect(Number(rows[0].last_read_seq)).toBe(4);
    });

    it('rejects non-member → NotInRoomError', async () => {
      const outsider = await seedUser(pool);
      await expect(
        messageService.markRead({ roomId, userId: outsider, seq: 1 }),
      ).rejects.toBeInstanceOf(NotInRoomError);
    });

    it('rejects non-existent room', async () => {
      await expect(
        messageService.markRead({ roomId: uuidv7(), userId: senderId, seq: 1 }),
      ).rejects.toBeInstanceOf(NotInRoomError);
    });
  });

  describe('unreadCount', () => {
    it('returns total count when nothing read yet', async () => {
      await sendN(3);
      const count = await messageService.unreadCount(roomId, otherMemberId);
      expect(count).toBe(3);
    });

    it('returns 0 when caught up to latest', async () => {
      await sendN(3);
      await messageService.markRead({ roomId, userId: otherMemberId, seq: 3 });
      const count = await messageService.unreadCount(roomId, otherMemberId);
      expect(count).toBe(0);
    });

    it('counts only messages with seq > lastReadSeq', async () => {
      await sendN(5);
      await messageService.markRead({ roomId, userId: otherMemberId, seq: 2 });
      const count = await messageService.unreadCount(roomId, otherMemberId);
      expect(count).toBe(3); // seq 3, 4, 5
    });

    it('per-member — sender and receiver have independent counts', async () => {
      await sendN(3);
      // sender는 본인 메시지를 읽은 것으로 자동 마킹 안 됨 (단순 카운트라서)
      // 명시적으로 sender 본인 markRead 호출해서 0으로 만들어야 함
      await messageService.markRead({ roomId, userId: senderId, seq: 3 });

      expect(await messageService.unreadCount(roomId, senderId)).toBe(0);
      expect(await messageService.unreadCount(roomId, otherMemberId)).toBe(3);
    });

    it('rejects non-member', async () => {
      const outsider = await seedUser(pool);
      await expect(messageService.unreadCount(roomId, outsider)).rejects.toBeInstanceOf(
        NotInRoomError,
      );
    });
  });
});
