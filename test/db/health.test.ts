import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { recordSourceOutcome, listUnhealthySources } from '../../src/db/health.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

describe('recordSourceOutcome', () => {
  it('counts consecutive failures', () => {
    for (let i = 0; i < 3; i++) recordSourceOutcome(db, 'adzuna', false);
    expect(listUnhealthySources(db, 3)[0].consecutive_failures).toBe(3);
  });

  it('resets the counter on a success', () => {
    recordSourceOutcome(db, 'adzuna', false);
    recordSourceOutcome(db, 'adzuna', false);
    recordSourceOutcome(db, 'adzuna', true);
    expect(listUnhealthySources(db, 1)).toEqual([]);
  });

  it('tracks sources independently', () => {
    for (let i = 0; i < 3; i++) recordSourceOutcome(db, 'adzuna', false);
    recordSourceOutcome(db, 'remotive', true);
    const unhealthy = listUnhealthySources(db, 3);
    expect(unhealthy).toHaveLength(1);
    expect(unhealthy[0].source).toBe('adzuna');
  });

  it('records timestamps for the last success and last failure', () => {
    recordSourceOutcome(db, 'hn', true);
    recordSourceOutcome(db, 'hn', false);
    const row = db.prepare('SELECT * FROM source_health WHERE source = ?').get('hn') as Record<string, string>;
    expect(row.last_ok_at).toMatch(/^\d{4}-/);
    expect(row.last_error_at).toMatch(/^\d{4}-/);
  });

  it('keeps the last success timestamp when a later run fails', () => {
    recordSourceOutcome(db, 'hn', true);
    const ok = (db.prepare('SELECT last_ok_at AS t FROM source_health WHERE source = ?').get('hn') as { t: string }).t;
    recordSourceOutcome(db, 'hn', false);
    const after = db.prepare('SELECT last_ok_at AS t FROM source_health WHERE source = ?').get('hn') as { t: string };
    expect(after.t).toBe(ok);
  });

  it('starts a fresh failure streak after a recovery', () => {
    for (let i = 0; i < 3; i++) recordSourceOutcome(db, 'adzuna', false);
    recordSourceOutcome(db, 'adzuna', true);
    recordSourceOutcome(db, 'adzuna', false);
    expect(listUnhealthySources(db, 1)[0].consecutive_failures).toBe(1);
  });
});

describe('listUnhealthySources', () => {
  it('returns nothing below the threshold', () => {
    recordSourceOutcome(db, 'adzuna', false);
    recordSourceOutcome(db, 'adzuna', false);
    expect(listUnhealthySources(db, 3)).toEqual([]);
  });

  it('orders the worst offenders first', () => {
    for (let i = 0; i < 5; i++) recordSourceOutcome(db, 'adzuna', false);
    for (let i = 0; i < 3; i++) recordSourceOutcome(db, 'hn', false);
    expect(listUnhealthySources(db, 3).map((r) => r.source)).toEqual(['adzuna', 'hn']);
  });
});
