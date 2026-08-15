import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/index.js';

describe('openDb', () => {
  // The default path is `data/pipeline.db`, and `data/` is gitignored — so on
  // a fresh clone the directory never exists and better-sqlite3 throws
  // "Cannot open database because the directory does not exist" before the
  // pipeline can do anything at all.
  it('creates the parent directory when it does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'opendb-'));
    const path = join(root, 'data', 'pipeline.db');
    expect(existsSync(join(root, 'data'))).toBe(false);

    const db = openDb(path);
    expect(existsSync(path)).toBe(true);
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('still opens an in-memory database without creating a ":memory:" folder', () => {
    const db = openDb(':memory:');
    expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 0 });
    expect(existsSync(':memory:')).toBe(false);
    db.close();
  });
});
