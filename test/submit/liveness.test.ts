import { describe, it, expect, vi, afterEach } from 'vitest';
import { isStillOpen } from '../../src/submit/liveness.js';
import type { JobRow } from '../../src/db/types.js';

const job = {
  url: 'https://boards.greenhouse.io/acme/jobs/4012345',
  source_job_id: '4012345',
  ats_platform: 'greenhouse',
} as JobRow;

// Board entries must carry `absolute_url`: greenhouseSource drops entries
// missing it, so an id-only stub would make BOTH the present and the absent
// case return false — the "still listed" test would fail and the "delisted"
// test would pass for the wrong reason.
const listing = (id: number) => ({
  jobs: [{ id, title: 'Data Analyst', absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}` }],
});

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}
afterEach(() => vi.unstubAllGlobals());

describe('isStillOpen', () => {
  it('returns true when the posting is present on the board', async () => {
    mockFetch(listing(4012345));
    expect(await isStillOpen(job)).toBe(true);
  });

  it('returns false when the posting is gone from the board', async () => {
    mockFetch(listing(9999999));
    expect(await isStillOpen(job)).toBe(false);
  });

  it('returns false when the board 404s', async () => {
    mockFetch({}, 404);
    expect(await isStillOpen(job)).toBe(false);
  });

  it('returns false on a network error rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    expect(await isStillOpen(job)).toBe(false);
  });

  it('returns false when the ats platform is unsupported', async () => {
    expect(await isStillOpen({ ...job, ats_platform: null } as JobRow)).toBe(false);
  });

  it('returns false when the job url cannot be parsed into a board token', async () => {
    mockFetch(listing(4012345));
    expect(await isStillOpen({ ...job, url: 'not-a-url' } as JobRow)).toBe(false);
  });
});
