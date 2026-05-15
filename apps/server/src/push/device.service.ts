import type { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';

const PlatformSchema = z.enum(['ios', 'android', 'web']);
const RegisterDeviceSchema = z.object({
  deviceId: z.string().min(1).max(100),
  platform: PlatformSchema,
  pushToken: z.string().min(1).max(2048).nullable().optional(),
});

export type DevicePlatform = z.infer<typeof PlatformSchema>;
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceSchema>;

export class DeviceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceValidationError';
  }
}

export interface DeviceRecord {
  id: string;
  userId: string;
  deviceId: string;
  platform: DevicePlatform;
  pushToken: string | null;
  lastSeenAt: Date;
}

interface DeviceRow {
  id: string;
  user_id: string;
  device_id: string;
  platform: DevicePlatform;
  push_token: string | null;
  last_seen_at: Date;
}

function rowToDevice(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    platform: row.platform,
    pushToken: row.push_token,
    lastSeenAt: row.last_seen_at,
  };
}

export class DeviceService {
  constructor(private readonly pool: Pool) {}

  // Upsert: 같은 (userId, deviceId)는 push_token 갱신만.
  async register(userId: string, input: unknown): Promise<DeviceRecord> {
    const parsed = RegisterDeviceSchema.safeParse(input);
    if (!parsed.success) throw new DeviceValidationError(parsed.error.message);

    const id = uuidv7();
    const { rows } = await this.pool.query<DeviceRow>(
      `INSERT INTO user_devices (id, user_id, device_id, platform, push_token)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, device_id) DO UPDATE SET
         platform = EXCLUDED.platform,
         push_token = EXCLUDED.push_token,
         last_seen_at = NOW()
       RETURNING id, user_id, device_id, platform, push_token, last_seen_at`,
      [id, userId, parsed.data.deviceId, parsed.data.platform, parsed.data.pushToken ?? null],
    );
    return rowToDevice(rows[0]);
  }

  async remove(userId: string, deviceId: string): Promise<void> {
    await this.pool.query(`DELETE FROM user_devices WHERE user_id = $1 AND device_id = $2`, [
      userId,
      deviceId,
    ]);
  }

  // 푸시 가능한 활성 디바이스만 (push_token NOT NULL).
  async listActiveForUser(userId: string): Promise<DeviceRecord[]> {
    const { rows } = await this.pool.query<DeviceRow>(
      `SELECT id, user_id, device_id, platform, push_token, last_seen_at
       FROM user_devices
       WHERE user_id = $1 AND push_token IS NOT NULL`,
      [userId],
    );
    return rows.map(rowToDevice);
  }

  async listForUser(userId: string): Promise<DeviceRecord[]> {
    const { rows } = await this.pool.query<DeviceRow>(
      `SELECT id, user_id, device_id, platform, push_token, last_seen_at
       FROM user_devices WHERE user_id = $1
       ORDER BY last_seen_at DESC`,
      [userId],
    );
    return rows.map(rowToDevice);
  }
}
