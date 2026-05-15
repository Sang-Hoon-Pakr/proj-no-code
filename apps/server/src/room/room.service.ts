import type { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';

// realtime-rules.md: 방 인원 ≤ 500. 초과 시 "오픈채팅" 모델로 분기 (별도 설계).
const MAX_GROUP_SIZE = 500;
const PG_UNIQUE_VIOLATION = '23505';

export type RoomType = 'direct' | 'group';

export interface Room {
  id: string;
  type: RoomType;
  name: string | null;
  createdAt: Date;
}

export interface CreateDirectInput {
  userIdA: string;
  userIdB: string;
}

export interface CreateGroupInput {
  creatorId: string;
  memberIds: string[];
  name: string;
}

export interface AddMemberInput {
  roomId: string;
  userId: string;
  addedBy: string;
}

export interface LeaveInput {
  roomId: string;
  userId: string;
}

export class SelfRoomError extends Error {
  constructor() {
    super('cannot create direct room with self');
    this.name = 'SelfRoomError';
  }
}
export class BlockedRelationError extends Error {
  constructor() {
    super('blocked relation');
    this.name = 'BlockedRelationError';
  }
}
export class GroupTooLargeError extends Error {
  constructor() {
    super(`group exceeds ${MAX_GROUP_SIZE} members`);
    this.name = 'GroupTooLargeError';
  }
}
export class NotAuthorizedError extends Error {
  constructor() {
    super('not authorized');
    this.name = 'NotAuthorizedError';
  }
}
export class RoomNotFoundError extends Error {
  constructor() {
    super('room not found');
    this.name = 'RoomNotFoundError';
  }
}

interface RoomRow {
  id: string;
  type: RoomType;
  name: string | null;
  created_at: Date;
}

export class RoomService {
  constructor(private readonly pool: Pool) {}

  async createDirect(input: CreateDirectInput): Promise<Room> {
    if (input.userIdA === input.userIdB) throw new SelfRoomError();
    const [a, b] = lexSort(input.userIdA, input.userIdB);

    // Block check — 양방향 모두 검사 (security-rules.md: 차단은 양방향 즉시 적용).
    const blocks = await this.pool.query(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)
       LIMIT 1`,
      [a, b],
    );
    if ((blocks.rowCount ?? 0) > 0) throw new BlockedRelationError();

    // 빠른 경로: 이미 존재하는 1:1방.
    const existing = await this.pool.query<{ room_id: string }>(
      `SELECT room_id FROM direct_room_keys WHERE user_a_id = $1 AND user_b_id = $2`,
      [a, b],
    );
    if (existing.rows.length > 0) return this.fetchRoom(existing.rows[0].room_id);

    // 새로 생성 — 트랜잭션 안에서 rooms + key + members 한 묶음으로.
    const roomId = uuidv7();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO rooms (id, type, name, created_by) VALUES ($1, 'direct', NULL, $2)`,
        [roomId, input.userIdA],
      );
      await client.query(
        `INSERT INTO direct_room_keys (user_a_id, user_b_id, room_id) VALUES ($1, $2, $3)`,
        [a, b, roomId],
      );
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
        [roomId, a, b],
      );
      await client.query('COMMIT');
      return this.fetchRoom(roomId);
    } catch (e) {
      await client.query('ROLLBACK');
      // 동시 생성 경쟁: UNIQUE 위반이면 상대가 먼저 만든 방을 반환.
      if (isPgUniqueViolation(e)) {
        const { rows } = await this.pool.query<{ room_id: string }>(
          `SELECT room_id FROM direct_room_keys WHERE user_a_id = $1 AND user_b_id = $2`,
          [a, b],
        );
        if (rows.length > 0) return this.fetchRoom(rows[0].room_id);
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async createGroup(input: CreateGroupInput): Promise<Room> {
    const totalSize = 1 + input.memberIds.length;
    if (totalSize > MAX_GROUP_SIZE) throw new GroupTooLargeError();

    const roomId = uuidv7();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO rooms (id, type, name, created_by) VALUES ($1, 'group', $2, $3)`,
        [roomId, input.name, input.creatorId],
      );
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'admin')`,
        [roomId, input.creatorId],
      );
      if (input.memberIds.length > 0) {
        const placeholders = input.memberIds.map((_, i) => `($1, $${i + 2}, 'member')`).join(', ');
        await client.query(
          `INSERT INTO room_members (room_id, user_id, role) VALUES ${placeholders}
           ON CONFLICT DO NOTHING`,
          [roomId, ...input.memberIds],
        );
      }
      await client.query('COMMIT');
      return this.fetchRoom(roomId);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async addMember(input: AddMemberInput): Promise<void> {
    const roomExists = await this.pool.query(`SELECT 1 FROM rooms WHERE id = $1 LIMIT 1`, [
      input.roomId,
    ]);
    if ((roomExists.rowCount ?? 0) === 0) throw new RoomNotFoundError();

    const adminCheck = await this.pool.query(
      `SELECT 1 FROM room_members
       WHERE room_id = $1 AND user_id = $2 AND role = 'admin' LIMIT 1`,
      [input.roomId, input.addedBy],
    );
    if ((adminCheck.rowCount ?? 0) === 0) throw new NotAuthorizedError();

    await this.pool.query(
      `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [input.roomId, input.userId],
    );
  }

  async isMember(roomId: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [roomId, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  async listRoomsForUser(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ room_id: string }>(
      `SELECT room_id FROM room_members WHERE user_id = $1`,
      [userId],
    );
    return rows.map((r) => r.room_id);
  }

  async leave(input: LeaveInput): Promise<void> {
    await this.pool.query(`DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, [
      input.roomId,
      input.userId,
    ]);
  }

  private async fetchRoom(roomId: string): Promise<Room> {
    const { rows } = await this.pool.query<RoomRow>(
      `SELECT id, type, name, created_at FROM rooms WHERE id = $1`,
      [roomId],
    );
    if (rows.length === 0) throw new RoomNotFoundError();
    return {
      id: rows[0].id,
      type: rows[0].type,
      name: rows[0].name,
      createdAt: rows[0].created_at,
    };
  }
}

function lexSort(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function isPgUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
