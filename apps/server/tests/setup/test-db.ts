import * as path from 'node:path';
import type { Pool } from 'pg';
import { runMigrations } from '../../src/db/migrate';

// 모든 통합테스트는 인라인 CREATE TABLE 대신 이 헬퍼를 호출.
// 프로덕션과 같은 마이그레이션 경로를 검증.
const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

export async function setupTestDb(pool: Pool): Promise<void> {
  await runMigrations(pool, MIGRATIONS_DIR);
}

// 모든 FK를 거치는 단일 TRUNCATE.
export const TRUNCATE_ALL = `
  TRUNCATE messages, direct_room_keys, room_members, rooms, blocks, refresh_tokens, users CASCADE
`;
