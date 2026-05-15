import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { MessageService } from '../../src/message/message.service';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;

const ROOM_ID = '00000000-0000-7000-8000-00000000aaaa';
const SENDER_ID = '00000000-0000-7000-8000-00000000bbbb';

describe('MessageService — idempotency invariant', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let service: MessageService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(PG_IMAGE).start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await pool.query(`
      CREATE TABLE messages (
        id          UUID PRIMARY KEY,
        room_id     UUID NOT NULL,
        sender_id   UUID NOT NULL,
        content     TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    service = new MessageService(pool);
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE messages');
  });

  it('creates a message', async () => {
    const msg = await service.create({
      messageId: '00000000-0000-7000-8000-000000000001',
      roomId: ROOM_ID,
      senderId: SENDER_ID,
      content: 'hello',
    });
    expect(msg.id).toBe('00000000-0000-7000-8000-000000000001');
    expect(msg.content).toBe('hello');
  });

  it('same messageId twice → 1 row, same record returned', async () => {
    const input = {
      messageId: '00000000-0000-7000-8000-000000000002',
      roomId: ROOM_ID,
      senderId: SENDER_ID,
      content: 'hello',
    };
    const a = await service.create(input);
    const b = await service.create(input);

    expect(b.id).toBe(a.id);
    expect(b.createdAt.getTime()).toBe(a.createdAt.getTime());

    const { rowCount } = await pool.query('SELECT 1 FROM messages WHERE id = $1', [
      input.messageId,
    ]);
    expect(rowCount).toBe(1);
  });

  it('same messageId with different content → first write wins, second returns original', async () => {
    const a = await service.create({
      messageId: '00000000-0000-7000-8000-000000000003',
      roomId: ROOM_ID,
      senderId: SENDER_ID,
      content: 'original',
    });
    const b = await service.create({
      messageId: '00000000-0000-7000-8000-000000000003',
      roomId: ROOM_ID,
      senderId: SENDER_ID,
      content: 'OVERRIDE_ATTEMPT',
    });

    expect(b.content).toBe('original');
    expect(b.id).toBe(a.id);
  });

  it('different messageIds → separate rows', async () => {
    await service.create({
      messageId: '00000000-0000-7000-8000-000000000004',
      roomId: ROOM_ID,
      senderId: SENDER_ID,
      content: 'first',
    });
    await service.create({
      messageId: '00000000-0000-7000-8000-000000000005',
      roomId: ROOM_ID,
      senderId: SENDER_ID,
      content: 'second',
    });

    const { rowCount } = await pool.query('SELECT 1 FROM messages WHERE room_id = $1', [ROOM_ID]);
    expect(rowCount).toBe(2);
  });
});
