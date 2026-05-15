import type { Pool } from 'pg';

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

interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  created_at: Date;
}

export class MessageService {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateMessageInput): Promise<Message> {
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
