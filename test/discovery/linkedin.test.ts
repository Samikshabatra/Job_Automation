import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { linkedinSource } from '../../src/discovery/linkedin.js';
import type { Criteria } from '../../src/config/schema.js';

const criteria = { locations: { include: ['bengaluru'] } } as Criteria;

afterEach(() => vi.unstubAllGlobals());

function mockHtml(html: string, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html, {
    status, headers: { 'content-type': 'text/html' },
  })));
}

describe('linkedinSource', () => {
  // A single query so the inter-request delay never runs.
  it('extracts the posting link and company, with the tracking query stripped', async () => {
    mockHtml(readFileSync('test/fixtures/linkedin-guest.html', 'utf8'));
    const { hits, ok } = await linkedinSource.search(['data analyst'], criteria);

    expect(ok).toBe(true);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      applyUrl: 'https://in.linkedin.com/jobs/view/data-analyst-at-beta-inc-4012345',
      company: 'Beta Inc',
      via: 'linkedin-guest',
    });
  });

  it('returns an empty successful result when the markup matches nothing', async () => {
    mockHtml('<div>no cards here</div>');
    const result = await linkedinSource.search(['data analyst'], criteria);
    expect(result).toEqual({ hits: [], ok: true });
  });

  it('reports failure without throwing when LinkedIn rejects the request', async () => {
    mockHtml('', 999);
    const result = await linkedinSource.search(['data analyst'], criteria);
    expect(result.ok).toBe(false);
    expect(result.hits).toEqual([]);
  });
});
