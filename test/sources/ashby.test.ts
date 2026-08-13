import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ashbySource } from '../../src/sources/ashby.js';
import type { BoardRow } from '../../src/db/types.js';

const board: BoardRow = {
  id: 1, ats_platform: 'ashby', board_token: 'gamma', company_name: 'Gamma',
  discovered_via: 'manual', discovered_at: '2026-08-01T00:00:00.000Z',
  last_polled_at: null, active: 1,
};

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('ashbySource', () => {
  it('maps the board response into RawJobs', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/ashby-board.json', 'utf8')));
    const { jobs, ok } = await ashbySource.fetchJobs(board);
    expect(ok).toBe(true);
    expect(jobs[0]).toMatchObject({
      sourceJobId: 'job_01',
      url: 'https://jobs.ashbyhq.com/gamma/job_01',
      title: 'Data Engineer',
      location: 'Remote',
      atsPlatform: 'ashby',
    });
  });

  it('converts publishedAt to an ISO-8601 UTC string', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/ashby-board.json', 'utf8')));
    const { jobs } = await ashbySource.fetchJobs(board);
    expect(jobs[0].postedAt).toBe('2026-07-29T10:00:00.000Z');
  });

  it('reports failure without throwing on 404', async () => {
    mockFetch({}, 404);
    const result = await ashbySource.fetchJobs(board);
    expect(result.ok).toBe(false);
    expect(result.jobs).toEqual([]);
  });

  it('drops malformed entries (missing id or jobUrl) but keeps the good ones', async () => {
    mockFetch({
      jobs: [
        { id: 'job_01', title: 'Data Engineer', jobUrl: 'https://jobs.ashbyhq.com/gamma/job_01' },
        { title: 'Missing id', jobUrl: 'https://jobs.ashbyhq.com/gamma/job_99' },
        { id: 'job_02', title: 'Missing jobUrl' },
      ],
    });
    const result = await ashbySource.fetchJobs(board);
    expect(result.ok).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].sourceJobId).toBe('job_01');
  });

  it('returns an empty successful result when every entry is malformed', async () => {
    mockFetch({
      jobs: [
        { title: 'Missing id', jobUrl: 'https://jobs.ashbyhq.com/gamma/job_99' },
        { id: 'job_02', title: 'Missing jobUrl' },
        { id: null, title: 'Null id', jobUrl: '' },
      ],
    });
    const result = await ashbySource.fetchJobs(board);
    expect(result.ok).toBe(true);
    expect(result.jobs).toEqual([]);
  });
});
