#!/usr/bin/env node
import 'reflect-metadata';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrate';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  try {
    const { applied, skipped } = await runMigrations(pool);
    if (applied.length === 0) {
      process.stdout.write(`No new migrations (${skipped.length} already applied)\n`);
    } else {
      process.stdout.write(`Applied ${applied.length} migration(s):\n`);
      for (const file of applied) process.stdout.write(`  + ${file}\n`);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
