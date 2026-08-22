import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedupeBySourceId } from './dedupe.js';

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(path = 'data/pipeline.db'): Database.Database {
  // The default lives in `data/`, which is gitignored and therefore absent on
  // a fresh clone. better-sqlite3 does not create it and throws "Cannot open
  // database because the directory does not exist", killing the very first
  // run before anything else can happen.
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

  // Order is load-bearing. A database created before the source-identity index
  // existed already holds the duplicate rows that index forbids, so creating it
  // first would throw and make the database unopenable. Collapse the duplicates,
  // then add the constraint that stops them coming back. Both steps are no-ops
  // once they have run, so this stays cheap on every subsequent open.
  dedupeBySourceId(db);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_identity
       ON jobs(source, source_job_id) WHERE source_job_id IS NOT NULL`,
  );
  return db;
}

export type { Database } from 'better-sqlite3';
