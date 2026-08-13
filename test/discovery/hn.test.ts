import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { hnSource } from '../../src/discovery/hn.js';
import type { Criteria } from '../../src/config/schema.js';

const criteria = {} as Criteria;

afterEach(() => vi.unstubAllGlobals());

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

describe('hnSource', () => {
  it('extracts the ATS link and the leading company field from a comment', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/hn-algolia.json', 'utf8')));
    const { hits, ok } = await hnSource.search(['who is hiring'], criteria);

    expect(ok).toBe(true);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/999',
      company: 'Acme Corp',
      via: 'hn-whoishiring',
    });
  });

  it('ignores comments with no link', async () => {
    mockFetch({ hits: [{ objectID: '1', comment_text: 'No link here at all.' }] });
    const { hits, ok } = await hnSource.search(['who is hiring'], criteria);
    expect(ok).toBe(true);
    expect(hits).toEqual([]);
  });

  it('ignores links that are not ATS hosts', async () => {
    mockFetch({ hits: [{ objectID: '1', comment_text: 'Acme | See https://example.com/careers' }] });
    const { hits } = await hnSource.search(['who is hiring'], criteria);
    expect(hits).toEqual([]);
  });

  it('reports failure without throwing on a non-200', async () => {
    mockFetch({}, 503);
    const result = await hnSource.search(['who is hiring'], criteria);
    expect(result.ok).toBe(false);
    expect(result.hits).toEqual([]);
  });
});
