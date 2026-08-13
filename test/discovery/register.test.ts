import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { listActiveBoards } from '../../src/db/boards.js';
import { registerDiscovered } from '../../src/discovery/register.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

describe('registerDiscovered', () => {
  it('registers a board from a parseable apply url', () => {
    const r = registerDiscovered(db, [
      { applyUrl: 'https://jobs.lever.co/beta/abc-123', company: 'Beta', via: 'adzuna' },
    ]);
    expect(r.registered).toBe(1);
    expect(listActiveBoards(db)[0]).toMatchObject({
      ats_platform: 'lever', board_token: 'beta', company_name: 'Beta', discovered_via: 'adzuna',
    });
  });

  it('skips urls it cannot parse', () => {
    const r = registerDiscovered(db, [
      { applyUrl: 'https://example.com/careers', company: 'Example', via: 'adzuna' },
    ]);
    expect(r).toEqual({ registered: 0, skipped: 1 });
    expect(listActiveBoards(db)).toHaveLength(0);
  });

  it('does not double-register the same board', () => {
    const hit = { applyUrl: 'https://jobs.lever.co/beta/abc-123', company: 'Beta', via: 'adzuna' };
    registerDiscovered(db, [hit]);
    const second = registerDiscovered(db, [hit]);
    expect(second.registered).toBe(0);
    expect(listActiveBoards(db)).toHaveLength(1);
  });

  it('registers several distinct boards in one call', () => {
    const r = registerDiscovered(db, [
      { applyUrl: 'https://jobs.lever.co/beta/1', company: 'Beta', via: 'hn' },
      { applyUrl: 'https://boards.greenhouse.io/acme/jobs/2', company: 'Acme', via: 'hn' },
    ]);
    expect(r.registered).toBe(2);
    expect(listActiveBoards(db)).toHaveLength(2);
  });

  it('does not register the same board twice within a single call', () => {
    const r = registerDiscovered(db, [
      { applyUrl: 'https://jobs.lever.co/beta/1', company: 'Beta', via: 'hn' },
      { applyUrl: 'https://jobs.lever.co/beta/2', company: 'Beta', via: 'hn' },
    ]);
    expect(r.registered).toBe(1);
    expect(listActiveBoards(db)).toHaveLength(1);
  });
});
