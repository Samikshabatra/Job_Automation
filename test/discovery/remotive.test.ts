import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { remotiveSource } from '../../src/discovery/remotive.js';
import { parseApplyUrl } from '../../src/discovery/urlparse.js';
import type { Criteria } from '../../src/config/schema.js';

const criteria = {} as Criteria;

afterEach(() => vi.unstubAllGlobals());

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

describe('remotiveSource', () => {
  it('maps jobs into discovery hits', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/remotive-search.json', 'utf8')));
    const { hits, ok } = await remotiveSource.search(['data engineer'], criteria);

    expect(ok).toBe(true);
    expect(hits).toEqual([{
      applyUrl: 'https://jobs.ashbyhq.com/gamma/job_01',
      company: 'Gamma',
      via: 'remotive',
    }]);
  });

  it('returns an empty successful result when the response has no jobs', async () => {
    mockFetch({});
    const result = await remotiveSource.search(['data engineer'], criteria);
    expect(result).toEqual({ hits: [], ok: true });
  });

  it('reports failure without throwing on a non-200', async () => {
    mockFetch({}, 500);
    const result = await remotiveSource.search(['data engineer'], criteria);
    expect(result.ok).toBe(false);
    expect(result.hits).toEqual([]);
  });

  // Documents a real limitation found by calling the live API: Remotive's
  // `url` is its own listing page, never the employer's ATS. Every hit is
  // therefore dropped by registerDiscovered, so this source contributes no
  // board tokens as currently specified. The fixture above uses an Ashby URL
  // that the real API does not return.
  it('passes through the remotive listing url, which parseApplyUrl cannot use', async () => {
    mockFetch({
      jobs: [{
        id: 2090989,
        title: 'Assistant Account Payable',
        company_name: 'Some Co',
        url: 'https://remotive.com/remote-jobs/medical/assistant-account-payable-2090989',
      }],
    });
    const { hits } = await remotiveSource.search(['data'], criteria);
    expect(hits[0].applyUrl).toContain('remotive.com');
    expect(parseApplyUrl(hits[0].applyUrl)).toBeNull();
  });
});
