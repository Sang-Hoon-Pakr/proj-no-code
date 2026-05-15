import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Pool } from 'pg';

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

const DEFAULT_MIGRATIONS_DIR = path.resolve(process.cwd(), 'db/migrations');

// 단순한 파일 순서 기반 마이그레이션 러너.
// - migrations 테이블에 적용된 파일명 기록
// - 각 파일은 단일 트랜잭션 (성공 시 COMMIT, 실패 시 ROLLBACK + throw)
// - 멱등 호출 가능 (이미 적용된 건 skip)
export async function runMigrations(
  pool: Pool,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrateResult> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const allFiles = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of allFiles) {
    const { rowCount } = await pool.query('SELECT 1 FROM migrations WHERE name = $1', [file]);
    if ((rowCount ?? 0) > 0) {
      skipped.push(file);
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (e) {
      await client.query('ROLLBACK');
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(`Migration ${file} failed: ${reason}`);
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}
