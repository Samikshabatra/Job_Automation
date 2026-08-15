import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return db;
}

export type { Database } from 'better-sqlite3';
