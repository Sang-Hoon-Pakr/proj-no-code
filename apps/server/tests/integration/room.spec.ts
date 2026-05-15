import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import {
  BlockedRelationError,
  GroupTooLargeError,
  NotAuthorizedError,
  RoomNotFoundError,
  RoomService,
  SelfRoomError,
} from '../../src/room/room.service';

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

async function seedBlock(pool: Pool, blockerId: string, blockedId: string): Promise<void> {
  await pool.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [
    blockerId,
    blockedId,
  ]);
}

describe('RoomService', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let service: RoomService;

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
    `);
    service = new RoomService(pool);
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE direct_room_keys, room_members, rooms, blocks, users CASCADE');
  });

  describe('createDirect — 1:1방 invariant', () => {
    it('creates a direct room with both users as members', async () => {
      const a = await seedUser(pool);
      const b = await seedUser(pool);
      const room = await service.createDirect({ userIdA: a, userIdB: b });

      expect(room.type).toBe('direct');
      expect(room.id).toMatch(/^[0-9a-f-]{36}$/);

      const { rows } = await pool.query<{ user_id: string }>(
        'SELECT user_id FROM room_members WHERE room_id = $1 ORDER BY user_id',
        [room.id],
      );
      const memberIds = rows.map((r) => r.user_id).sort();
      expect(memberIds).toEqual([a, b].sort());
    });

    it('same pair twice → same room (idempotent)', async () => {
      const a = await seedUser(pool);
      const b = await seedUser(pool);
      const r1 = await service.createDirect({ userIdA: a, userIdB: b });
      const r2 = await service.createDirect({ userIdA: a, userIdB: b });
      expect(r2.id).toBe(r1.id);
    });

    it('reversed args → same room (args order independent)', async () => {
      const a = await seedUser(pool);
      const b = await seedUser(pool);
      const r1 = await service.createDirect({ userIdA: a, userIdB: b });
      const r2 = await service.createDirect({ userIdA: b, userIdB: a });
      expect(r2.id).toBe(r1.id);
    });

    it('rejects when either side has blocked the other', async () => {
      const a = await seedUser(pool);
      const b = await seedUser(pool);
      await seedBlock(pool, a, b);
      await expect(service.createDirect({ userIdA: a, userIdB: b })).rejects.toBeInstanceOf(
        BlockedRelationError,
      );

      // Also from the other direction
      await expect(service.createDirect({ userIdA: b, userIdB: a })).rejects.toBeInstanceOf(
        BlockedRelationError,
      );
    });

    it('rejects self-direct room', async () => {
      const a = await seedUser(pool);
      await expect(service.createDirect({ userIdA: a, userIdB: a })).rejects.toBeInstanceOf(
        SelfRoomError,
      );
    });
  });

  describe('createGroup — 그룹방 invariant', () => {
    it('creates a group room with creator as admin and members joined', async () => {
      const creator = await seedUser(pool);
      const m1 = await seedUser(pool);
      const m2 = await seedUser(pool);
      const room = await service.createGroup({
        creatorId: creator,
        memberIds: [m1, m2],
        name: '점심팟',
      });

      expect(room.type).toBe('group');
      expect(room.name).toBe('점심팟');

      const { rows } = await pool.query<{ user_id: string; role: string }>(
        'SELECT user_id, role FROM room_members WHERE room_id = $1',
        [room.id],
      );
      const byUser = new Map(rows.map((r) => [r.user_id, r.role]));
      expect(byUser.get(creator)).toBe('admin');
      expect(byUser.get(m1)).toBe('member');
      expect(byUser.get(m2)).toBe('member');
      expect(rows.length).toBe(3);
    });

    it('rejects group with more than 500 total members', async () => {
      const creator = await seedUser(pool);
      const memberIds = await Promise.all(Array.from({ length: 500 }, () => seedUser(pool)));
      // creator + 500 members = 501 > 500
      await expect(
        service.createGroup({ creatorId: creator, memberIds, name: 'big' }),
      ).rejects.toBeInstanceOf(GroupTooLargeError);
    });
  });

  describe('addMember', () => {
    it('admin can add new member', async () => {
      const admin = await seedUser(pool);
      const initialMember = await seedUser(pool);
      const newcomer = await seedUser(pool);
      const room = await service.createGroup({
        creatorId: admin,
        memberIds: [initialMember],
        name: 'g',
      });

      await service.addMember({ roomId: room.id, userId: newcomer, addedBy: admin });
      expect(await service.isMember(room.id, newcomer)).toBe(true);
    });

    it('non-admin member cannot add', async () => {
      const admin = await seedUser(pool);
      const member = await seedUser(pool);
      const newcomer = await seedUser(pool);
      const room = await service.createGroup({
        creatorId: admin,
        memberIds: [member],
        name: 'g',
      });

      await expect(
        service.addMember({ roomId: room.id, userId: newcomer, addedBy: member }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });

    it('rejects when room does not exist', async () => {
      const admin = await seedUser(pool);
      const newcomer = await seedUser(pool);
      await expect(
        service.addMember({ roomId: uuidv7(), userId: newcomer, addedBy: admin }),
      ).rejects.toBeInstanceOf(RoomNotFoundError);
    });
  });

  describe('isMember / leave', () => {
    it('isMember returns true for joined user, false otherwise', async () => {
      const a = await seedUser(pool);
      const b = await seedUser(pool);
      const outsider = await seedUser(pool);
      const room = await service.createDirect({ userIdA: a, userIdB: b });

      expect(await service.isMember(room.id, a)).toBe(true);
      expect(await service.isMember(room.id, outsider)).toBe(false);
    });

    it('leave removes the user from room_members', async () => {
      const admin = await seedUser(pool);
      const m1 = await seedUser(pool);
      const room = await service.createGroup({
        creatorId: admin,
        memberIds: [m1],
        name: 'g',
      });

      await service.leave({ roomId: room.id, userId: m1 });
      expect(await service.isMember(room.id, m1)).toBe(false);
      expect(await service.isMember(room.id, admin)).toBe(true);
    });
  });
});
