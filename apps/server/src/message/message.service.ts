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
  createdAt: Date;
}

export class NotInRoomError extends Error {
  constructor() {
    // security-rules.md: 404와 403 누설 방지 — non-member도 non-existent도 같은 에러로 통일.
    super('not a member of room');
    this.name = 'NotInRoomError';
  }
}

interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  created_at: Date;
}

export class MessageService {
  constructor(
    private readonly pool: Pool,
    private readonly roomService: RoomService,
  ) {}

  async create(input: CreateMessageInput): Promise<Message> {
    // 게이트: sender가 방 멤버여야 INSERT 시도 자체가 가능.
    // 방이 없어도 isMember false 반환되므로 NotInRoomError로 통일.
    if (!(await this.roomService.isMember(input.roomId, input.senderId))) {
      throw new NotInRoomError();
    }

    const result = await this.pool.query<MessageRow>(
      `
        WITH inserted AS (
          INSERT INTO messages (id, room_id, sender_id, content)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO NOTHING
          RETURNING id, room_id, sender_id, content, created_at
        )
        SELECT id, room_id, sender_id, content, created_at FROM inserted
        UNION ALL
        SELECT id, room_id, sender_id, content, created_at
        FROM messages
        WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM inserted)
      `,
      [input.messageId, input.roomId, input.senderId, input.content],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      roomId: row.room_id,
      senderId: row.sender_id,
      content: row.content,
      createdAt: row.created_at,
    };
  }
}
