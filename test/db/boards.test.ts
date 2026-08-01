import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { upsertBoard, listActiveBoards, deactivateBoard, boardExists } from '../../src/db/boards.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

const acme = {
  atsPlatform: 'greenhouse' as const, boardToken: 'acme',
  companyName: 'Acme', discoveredVia: 'manual',
};

it('upsert is idempotent on (ats, token)', () => {
  const first = upsertBoard(db, acme);
  const second = upsertBoard(db, { ...acme, companyName: 'Acme Corp' });
  expect(second).toBe(first);
  expect(listActiveBoards(db)).toHaveLength(1);
  expect(listActiveBoards(db)[0].company_name).toBe('Acme Corp');
});

it('treats the same token on different platforms as distinct boards', () => {
  upsertBoard(db, acme);
  upsertBoard(db, { ...acme, atsPlatform: 'lever' });
  expect(listActiveBoards(db)).toHaveLength(2);
});

it('excludes deactivated boards', () => {
  const id = upsertBoard(db, acme);
  deactivateBoard(db, id);
  expect(listActiveBoards(db)).toHaveLength(0);
  expect(boardExists(db, 'greenhouse', 'acme')).toBe(true);
});

it('reactivates a deactivated board on re-upsert', () => {
  const id = upsertBoard(db, acme);
  deactivateBoard(db, id);
  expect(listActiveBoards(db)).toHaveLength(0);

  const second = upsertBoard(db, acme);
  expect(second).toBe(id);
  expect(listActiveBoards(db)).toHaveLength(1);
});
