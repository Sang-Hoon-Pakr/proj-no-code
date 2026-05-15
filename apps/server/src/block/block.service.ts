import type { Pool } from 'pg';

export interface BlockedUser {
  id: string;
  email: string;
  nickname: string;
  blockedAt: Date;
}

export class BlockSelfError extends Error {
  constructor() {
    super('cannot block self');
    this.name = 'BlockSelfError';
  }
}

interface BlockedRow {
  id: string;
  email: string;
  nickname: string;
  created_at: Date;
}

export class BlockService {
  constructor(private readonly pool: Pool) {}

  async create(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) throw new BlockSelfError();
    // ON CONFLICT — 멱등 (security-rules.md: "차단은 양방향 즉시 적용", 중복 시도 OK).
    await this.pool.query(
      `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [blockerId, blockedId],
    );
  }

  async remove(blockerId: string, blockedId: string): Promise<void> {
    await this.pool.query(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [
      blockerId,
      blockedId,
    ]);
  }

  async list(blockerId: string): Promise<BlockedUser[]> {
    const { rows } = await this.pool.query<BlockedRow>(
      `SELECT u.id, u.email, u.nickname, b.created_at
       FROM blocks b
       JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = $1
       ORDER BY b.created_at DESC`,
      [blockerId],
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      nickname: r.nickname,
      blockedAt: r.created_at,
    }));
  }

  // 양방향 검사 — A↔B 어느 방향이든 block 관계면 true.
  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)
       LIMIT 1`,
      [a, b],
    );
    return (rowCount ?? 0) > 0;
  }
}
