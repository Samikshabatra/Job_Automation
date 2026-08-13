import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { workableSource } from '../../src/sources/workable.js';
import type { BoardRow } from '../../src/db/types.js';

const board: BoardRow = {
  id: 1, ats_platform: 'workable', board_token: 'delta', company_name: 'Delta',
  discovered_via: 'manual', discovered_at: '2026-08-01T00:00:00.000Z',
  last_polled_at: null, active: 1,
};

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('workableSource', () => {
  it('maps the board response into RawJobs', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/workable-board.json', 'utf8')));
    const { jobs, ok } = await workableSource.fetchJobs(board);
    expect(ok).toBe(true);
    expect(jobs[0]).toMatchObject({
      sourceJobId: 'ABC123',
      url: 'https://delta.workable.com/j/ABC123',
      title: 'Data Analyst',
      location: 'Gurgaon, India',
      atsPlatform: 'workable',
    });
  });

  it('converts the date-only published_on to an ISO-8601 UTC string', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/workable-board.json', 'utf8')));
    const { jobs } = await workableSource.fetchJobs(board);
    expect(jobs[0].postedAt).toBe('2026-07-31T00:00:00.000Z');
  });

  it('strips HTML out of the description', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/workable-board.json', 'utf8')));
    const { jobs } = await workableSource.fetchJobs(board);
    expect(jobs[0].jdText).toContain('0-1 years');
    expect(jobs[0].jdText).not.toContain('<p>');
  });

  it('reports failure without throwing on 404', async () => {
    mockFetch({}, 404);
    const result = await workableSource.fetchJobs(board);
    expect(result.ok).toBe(false);
    expect(result.jobs).toEqual([]);
  });

  it('drops malformed entries (missing shortcode or url) but keeps the good ones', async () => {
    mockFetch({
      results: [
        { shortcode: 'ABC123', title: 'Data Analyst', url: 'https://delta.workable.com/j/ABC123' },
        { title: 'Missing shortcode', url: 'https://delta.workable.com/j/ZZZ' },
        { shortcode: 'DEF456', title: 'Missing url' },
      ],
    });
    const result = await workableSource.fetchJobs(board);
    expect(result.ok).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].sourceJobId).toBe('ABC123');
  });

  it('returns an empty successful result when every entry is malformed', async () => {
    mockFetch({
      results: [
        { title: 'Missing shortcode', url: 'https://delta.workable.com/j/ZZZ' },
        { shortcode: 'DEF456', title: 'Missing url' },
        { shortcode: null, title: 'Null shortcode', url: '' },
      ],
    });
    const result = await workableSource.fetchJobs(board);
    expect(result.ok).toBe(true);
    expect(result.jobs).toEqual([]);
  });
});
