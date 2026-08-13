import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { listActiveBoards } from '../../src/db/boards.js';
import { resolveCompany, resolveAll } from '../../src/resolve/resolver.js';
import type { AtsPlatform } from '../../src/config/schema.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

/** Probe that only "finds" the given ats+token pairs. */
function probeFor(known: [AtsPlatform, string][]) {
  const set = new Set(known.map(([a, t]) => `${a}:${t}`));
  return vi.fn(async (ats: AtsPlatform, token: string) => set.has(`${ats}:${token}`));
}

describe('resolveCompany', () => {
  it('returns the ats and token when a board is found', async () => {
    const probe = probeFor([['lever', 'acme']]);
    expect(await resolveCompany('Acme Corp', { probe })).toEqual({
      name: 'Acme Corp', ats: 'lever', token: 'acme',
    });
  });

  it('returns nulls when nothing is found', async () => {
    const probe = probeFor([]);
    expect(await resolveCompany('Nowhere Inc', { probe })).toEqual({
      name: 'Nowhere Inc', ats: null, token: null,
    });
  });

  it('stops probing as soon as a board is found', async () => {
    const probe = probeFor([['greenhouse', 'acmecorp']]);
    await resolveCompany('Acme Corp', { probe });
    const calls = probe.mock.calls.map(([a, t]) => `${a}:${t}`);
    expect(calls[calls.length - 1]).toBe('greenhouse:acmecorp');
  });

  it('tries every platform before giving up', async () => {
    const probe = probeFor([]);
    await resolveCompany('Acme', { probe });
    const platforms = new Set(probe.mock.calls.map(([a]) => a));
    expect(platforms).toEqual(new Set(['greenhouse', 'lever', 'ashby', 'workable']));
  });
});

describe('resolveAll', () => {
  it('registers resolved companies as boards', async () => {
    const probe = probeFor([['lever', 'acme']]);
    const result = await resolveAll(db, [{ name: 'Acme Corp', paused: false }], { probe });

    expect(result.unresolved).toEqual([]);
    const boards = listActiveBoards(db);
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ ats_platform: 'lever', board_token: 'acme', discovered_via: 'companies.yaml' });
  });

  it('honours a manual ats/token override without probing', async () => {
    const probe = probeFor([]);
    await resolveAll(db, [{ name: 'Gamma', paused: false, ats: 'ashby', token: 'gamma' }], { probe });

    expect(probe).not.toHaveBeenCalled();
    expect(listActiveBoards(db)[0].board_token).toBe('gamma');
  });

  it('skips paused companies entirely', async () => {
    const probe = probeFor([['lever', 'acme']]);
    await resolveAll(db, [{ name: 'Acme', paused: true }], { probe });

    expect(probe).not.toHaveBeenCalled();
    expect(listActiveBoards(db)).toHaveLength(0);
  });

  it('reports names it could not resolve', async () => {
    const probe = probeFor([]);
    const result = await resolveAll(db, [{ name: 'Ghost Ltd', paused: false }], { probe });
    expect(result.unresolved).toEqual(['Ghost Ltd']);
  });

  it('does not re-probe a company already registered', async () => {
    const probe = probeFor([['lever', 'acme']]);
    await resolveAll(db, [{ name: 'Acme Corp', paused: false }], { probe });
    probe.mockClear();
    await resolveAll(db, [{ name: 'Acme Corp', paused: false }], { probe });
    expect(probe).not.toHaveBeenCalled();
  });
});
