import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { greenhouseSource } from '../../src/sources/greenhouse.js';
import type { BoardRow } from '../../src/db/types.js';

const board: BoardRow = {
  id: 1, ats_platform: 'greenhouse', board_token: 'acme', company_name: 'Acme',
  discovered_via: 'manual', discovered_at: '2026-08-01T00:00:00.000Z',
  last_polled_at: null, active: 1,
};

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('greenhouseSource', () => {
  it('maps the board response into RawJobs', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/greenhouse-board.json', 'utf8')));
    const result = await greenhouseSource.fetchJobs(board);

    expect(result.ok).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({
      sourceJobId: '4012345',
      url: 'https://boards.greenhouse.io/acme/jobs/4012345',
      company: 'Acme',
      title: 'Data Analyst (Bengaluru)',
      location: 'Bangalore, India',
      atsPlatform: 'greenhouse',
    });
  });

  it('converts updated_at to an ISO-8601 UTC string', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/greenhouse-board.json', 'utf8')));
    const { jobs } = await greenhouseSource.fetchJobs(board);
    expect(jobs[0].postedAt).toBe('2026-07-30T13:15:00.000Z');
  });

  it('strips HTML from the JD content', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/greenhouse-board.json', 'utf8')));
    const { jobs } = await greenhouseSource.fetchJobs(board);
    expect(jobs[0].jdText).toContain('0-2 years of experience');
    expect(jobs[0].jdText).not.toContain('<p>');
  });

  it('reports failure without throwing when the board 404s', async () => {
    mockFetch({ error: 'not found' }, 404);
    const result = await greenhouseSource.fetchJobs(board);
    expect(result.ok).toBe(false);
    expect(result.jobs).toEqual([]);
    expect(result.error).toContain('404');
  });

  it('returns an empty successful result for a board with no jobs', async () => {
    mockFetch({ jobs: [] });
    const result = await greenhouseSource.fetchJobs(board);
    expect(result.ok).toBe(true);
    expect(result.jobs).toEqual([]);
  });
});
