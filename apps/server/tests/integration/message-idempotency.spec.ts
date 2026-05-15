import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { MessageService, NotInRoomError } from '../../src/message/message.service';
import { RoomService } from '../../src/room/room.service';

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
    await pool.query(`
      CREATE TABLE users (
        id            UUID PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
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
});
