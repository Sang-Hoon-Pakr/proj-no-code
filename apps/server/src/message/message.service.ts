import type { Pool } from 'pg';
import type { RoomService } from '../room/room.service';

export interface CreateMessageInput {
  messageId: string;
  roomId: string;
  senderId: string;
  content: string;
}

export interface Message {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  seq: number;
  createdAt: Date;
}

export interface ListSinceInput {
  roomId: string;
  userId: string;
  sinceSeq: number;
  limit?: number;
}

export class NotInRoomError extends Error {
  constructor() {
    // security-rules.md: 404와 403 누설 방지 — non-member도 non-existent도 같은 에러로 통일.
    super('not a member of room');
    this.name = 'NotInRoomError';
  }
}

// api-conventions.md: 페이지 기본 30, max 100
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  seq: string; // BIGINT comes as string from pg
  created_at: Date;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    content: row.content,
    seq: Number(row.seq),
    createdAt: row.created_at,
  };
}

export class MessageService {
  constructor(
    private readonly pool: Pool,
    private readonly roomService: RoomService,
  ) {}

  async create(input: CreateMessageInput): Promise<Message> {
    // 게이트: sender가 방 멤버여야 INSERT 시도 자체가 가능.
    if (!(await this.roomService.isMember(input.roomId, input.senderId))) {
      throw new NotInRoomError();
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 방 단위 단조증가 seq 원자적 할당 (rooms.last_seq UPDATE + RETURNING).
      // 동시 INSERT는 rooms row lock으로 직렬화 — seq 충돌/중복 없음.
      const seqResult = await client.query<{ last_seq: string }>(
        `UPDATE rooms SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq`,
        [input.roomId],
      );
      if (seqResult.rows.length === 0) {
        // 방이 없는 경우 — 멤버십 검사 통과했지만 race로 사라졌을 가능성.
        await client.query('ROLLBACK');
        throw new NotInRoomError();
      }
      const newSeq = Number(seqResult.rows[0].last_seq);

      // ON CONFLICT DO NOTHING — 같은 messageId 재전송 시 row 안 만들고 빈 결과.
      const insertResult = await client.query<MessageRow>(
        `INSERT INTO messages (id, room_id, sender_id, content, seq)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING
         RETURNING id, room_id, sender_id, content, seq, created_at`,
        [input.messageId, input.roomId, input.senderId, input.content, newSeq],
      );

      if (insertResult.rows.length > 0) {
        await client.query('COMMIT');
        return rowToMessage(insertResult.rows[0]);
      }

      // 멱등 충돌 — last_seq 증가를 되돌리고 기존 메시지 반환.
      await client.query('ROLLBACK');
      const existing = await this.pool.query<MessageRow>(
        `SELECT id, room_id, sender_id, content, seq, created_at FROM messages WHERE id = $1`,
        [input.messageId],
      );
      return rowToMessage(existing.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async listSince(input: ListSinceInput): Promise<{ messages: Message[]; hasMore: boolean }> {
    if (!(await this.roomService.isMember(input.roomId, input.userId))) {
      throw new NotInRoomError();
    }

    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const { rows } = await this.pool.query<MessageRow>(
      `SELECT id, room_id, sender_id, content, seq, created_at
       FROM messages
       WHERE room_id = $1 AND seq > $2
       ORDER BY seq ASC
       LIMIT $3`,
      [input.roomId, input.sinceSeq, limit],
    );

    const messages = rows.map(rowToMessage);
    return { messages, hasMore: messages.length === limit };
  }

  // realtime-rules.md: lastReadSeq 단조증가만 허용 — 클라이언트가 잘못 작은 seq 보내도 무영향.
  async markRead(input: { roomId: string; userId: string; seq: number }): Promise<void> {
    if (!(await this.roomService.isMember(input.roomId, input.userId))) {
      throw new NotInRoomError();
    }
    await this.pool.query(
      `UPDATE room_members
       SET last_read_seq = GREATEST(last_read_seq, $3)
       WHERE room_id = $1 AND user_id = $2`,
      [input.roomId, input.userId, input.seq],
    );
  }

  async unreadCount(roomId: string, userId: string): Promise<number> {
    if (!(await this.roomService.isMember(roomId, userId))) {
      throw new NotInRoomError();
    }
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count
       FROM messages
       WHERE room_id = $1
         AND seq > COALESCE(
           (SELECT last_read_seq FROM room_members WHERE room_id = $1 AND user_id = $2),
           0
         )`,
      [roomId, userId],
    );
    return Number(rows[0].count);
  }
}
