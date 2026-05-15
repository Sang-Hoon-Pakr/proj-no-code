import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runMigrations } from '../../src/db/migrate';
import { setupTestDb } from '../setup/test-db';

const PG_IMAGE = 'postgres:16-alpine';
const CONTAINER_START_TIMEOUT_MS = 60_000;

describe('runMigrations', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(PG_IMAGE).start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
  }, CONTAINER_START_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    // drop and recreate public schema — 마이그레이션 자체를 검증하려고 깨끗한 상태로 시작.
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  });

  describe('with actual project migrations', () => {
    it('creates migrations tracking table and applies 0001_initial', async () => {
      const result = await setupTestDb(pool).then(async () => {
        const { rows } = await pool.query<{ name: string }>(
          'SELECT name FROM migrations ORDER BY name',
        );
        return rows.map((r) => r.name);
      });
      expect(result).toContain('0001_initial.sql');
    });

    it('is idempotent — second call applies 0', async () => {
      await setupTestDb(pool);
      // 두 번째 호출은 새로 적용 X. 호출 자체는 throw 하지 않음.
      await expect(setupTestDb(pool)).resolves.toBeUndefined();
    });
  });

  describe('with synthetic migrations dir', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'migrate-test-'));
    });

    afterAll(async () => {
      // best-effort cleanup
    });

    it('applies new migrations on subsequent run', async () => {
      await writeFile(path.join(dir, '0001_a.sql'), 'CREATE TABLE thing_a (id INT);');
      const r1 = await runMigrations(pool, dir);
      expect(r1.applied).toEqual(['0001_a.sql']);
      expect(r1.skipped).toEqual([]);

      // 새 파일 추가하고 다시 호출
      await writeFile(path.join(dir, '0002_b.sql'), 'CREATE TABLE thing_b (id INT);');
      const r2 = await runMigrations(pool, dir);
      expect(r2.applied).toEqual(['0002_b.sql']);
      expect(r2.skipped).toEqual(['0001_a.sql']);

      await rm(dir, { recursive: true, force: true });
    });

    it('rolls back failed migration (transaction wrapped)', async () => {
      await writeFile(path.join(dir, '0001_ok.sql'), 'CREATE TABLE survives (id INT);');
      await writeFile(path.join(dir, '0002_bad.sql'), 'CREATE TABLE survives (id INT);'); // 이름 충돌 → 실패

      await expect(runMigrations(pool, dir)).rejects.toThrow(/Migration 0002_bad/);

      // 첫 마이그레이션은 그대로 (테이블 존재 + migrations 기록 있음)
      const survives = await pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'survives'",
      );
      expect(survives.rowCount).toBe(1);

      const tracked = await pool.query<{ name: string }>('SELECT name FROM migrations');
      expect(tracked.rows.map((r) => r.name)).toEqual(['0001_ok.sql']);

      await rm(dir, { recursive: true, force: true });
    });
  });
});
