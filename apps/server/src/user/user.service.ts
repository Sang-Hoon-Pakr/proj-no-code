import type { Pool } from 'pg';
import { z } from 'zod';

const UpdateProfileSchema = z.object({
  nickname: z.string().trim().min(1).max(50).optional(),
  profileImageUrl: z.string().url().max(2048).nullable().optional(),
  statusMessage: z.string().max(200).nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export interface UserProfile {
  id: string;
  email: string;
  nickname: string;
  profileImageUrl: string | null;
  statusMessage: string | null;
  createdAt: Date;
}

export class UserNotFoundError extends Error {
  constructor() {
    super('user not found');
    this.name = 'UserNotFoundError';
  }
}

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileValidationError';
  }
}

interface UserProfileRow {
  id: string;
  email: string;
  nickname: string;
  profile_image_url: string | null;
  status_message: string | null;
  created_at: Date;
}

function rowToProfile(row: UserProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    profileImageUrl: row.profile_image_url,
    statusMessage: row.status_message,
    createdAt: row.created_at,
  };
}

export class UserService {
  constructor(private readonly pool: Pool) {}

  async getById(userId: string): Promise<UserProfile> {
    const { rows } = await this.pool.query<UserProfileRow>(
      `SELECT id, email, nickname, profile_image_url, status_message, created_at
       FROM users WHERE id = $1`,
      [userId],
    );
    if (rows.length === 0) throw new UserNotFoundError();
    return rowToProfile(rows[0]);
  }

  async updateProfile(userId: string, input: unknown): Promise<UserProfile> {
    const parsed = UpdateProfileSchema.safeParse(input);
    if (!parsed.success) throw new ProfileValidationError(parsed.error.message);

    // 동적 UPDATE — undefined인 필드는 변경 안 함, null은 명시적으로 NULL 설정.
    const sets: string[] = [];
    const values: unknown[] = [userId];
    if (parsed.data.nickname !== undefined) {
      values.push(parsed.data.nickname);
      sets.push(`nickname = $${values.length}`);
    }
    if (parsed.data.profileImageUrl !== undefined) {
      values.push(parsed.data.profileImageUrl);
      sets.push(`profile_image_url = $${values.length}`);
    }
    if (parsed.data.statusMessage !== undefined) {
      values.push(parsed.data.statusMessage);
      sets.push(`status_message = $${values.length}`);
    }

    if (sets.length === 0) return this.getById(userId);

    const { rows } = await this.pool.query<UserProfileRow>(
      `UPDATE users SET ${sets.join(', ')}
       WHERE id = $1
       RETURNING id, email, nickname, profile_image_url, status_message, created_at`,
      values,
    );
    if (rows.length === 0) throw new UserNotFoundError();
    return rowToProfile(rows[0]);
  }
}
