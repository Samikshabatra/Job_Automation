import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { leverSource } from '../../src/sources/lever.js';
import type { BoardRow } from '../../src/db/types.js';

const board: BoardRow = {
  id: 1, ats_platform: 'lever', board_token: 'beta', company_name: 'Beta',
  discovered_via: 'manual', discovered_at: '2026-08-01T00:00:00.000Z',
  last_polled_at: null, active: 1,
};

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('leverSource', () => {
  it('maps the array response into RawJobs', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/lever-board.json', 'utf8')));
    const { jobs, ok } = await leverSource.fetchJobs(board);
    expect(ok).toBe(true);
    expect(jobs[0]).toMatchObject({
      sourceJobId: 'abc-123',
      url: 'https://jobs.lever.co/beta/abc-123',
      title: 'Machine Learning Engineer',
      location: 'Bengaluru, India',
      atsPlatform: 'lever',
    });
  });

  it('converts the epoch-millisecond createdAt to ISO', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/lever-board.json', 'utf8')));
    const { jobs } = await leverSource.fetchJobs(board);
    expect(jobs[0].postedAt).toBe(new Date(1753900000000).toISOString());
  });

  it('reports failure without throwing on 404', async () => {
    mockFetch([], 404);
    const result = await leverSource.fetchJobs(board);
    expect(result.ok).toBe(false);
    expect(result.jobs).toEqual([]);
  });

  it('drops malformed entries (missing id or hostedUrl) but keeps the good ones', async () => {
    mockFetch([
      {
        id: 'abc-123',
        text: 'Machine Learning Engineer',
        hostedUrl: 'https://jobs.lever.co/beta/abc-123',
        createdAt: 1753900000000,
      },
      { text: 'Missing id', hostedUrl: 'https://jobs.lever.co/beta/zzz' },
      { id: 'def-456', text: 'Missing hostedUrl' },
    ]);
    const result = await leverSource.fetchJobs(board);
    expect(result.ok).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].sourceJobId).toBe('abc-123');
  });

  it('returns an empty successful result when every entry is malformed', async () => {
    mockFetch([
      { text: 'Missing id', hostedUrl: 'https://jobs.lever.co/beta/zzz' },
      { id: 'def-456', text: 'Missing hostedUrl' },
      { id: null, text: 'Null id', hostedUrl: '' },
    ]);
    const result = await leverSource.fetchJobs(board);
    expect(result.ok).toBe(true);
    expect(result.jobs).toEqual([]);
  });

  it('leaves postedAt null when createdAt is not a usable timestamp', async () => {
    mockFetch([
      { id: 'abc-123', text: 'ML Engineer', hostedUrl: 'https://jobs.lever.co/beta/abc-123', createdAt: 'not-a-number' },
    ]);
    const { jobs, ok } = await leverSource.fetchJobs(board);
    expect(ok).toBe(true);
    expect(jobs[0].postedAt).toBeNull();
  });
});
