import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { adzunaSource } from '../../src/discovery/adzuna.js';
import type { Criteria } from '../../src/config/schema.js';

const criteria = {
  titles: { include: ['data analyst'], exclude: [] },
  experience: { max_years_required: 0 },
  locations: { include: ['bengaluru', 'remote'] },
  freshness: { max_posted_age_days: 7, verify_open_before_submit: true },
  scoring: { threshold: 60 },
  limits: { daily_cap: 30, per_company_open_applications: 3, min_delay_seconds: 45, max_delay_seconds: 120 },
  submission: { dry_run: true },
} as Criteria;

beforeEach(() => {
  process.env.ADZUNA_APP_ID = 'appid-9f3c';
  process.env.ADZUNA_APP_KEY = 'supersecretkey-4b71';
});
afterEach(() => vi.unstubAllGlobals());

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

describe('adzunaSource', () => {
  it('returns a hit for every result, including unparseable urls', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/adzuna-search.json', 'utf8')));
    const { hits, ok } = await adzunaSource.search(['data analyst'], criteria);
    expect(ok).toBe(true);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      applyUrl: 'https://jobs.lever.co/beta/abc-123', company: 'Beta Inc', via: 'adzuna',
    });
  });

  it('reports failure without throwing on a non-200', async () => {
    mockFetch({}, 429);
    const result = await adzunaSource.search(['data analyst'], criteria);
    expect(result.ok).toBe(false);
    expect(result.hits).toEqual([]);
  });

  it('fails cleanly when credentials are missing', async () => {
    delete process.env.ADZUNA_APP_ID;
    const result = await adzunaSource.search(['data analyst'], criteria);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ADZUNA');
  });

  it('issues one request per query', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/adzuna-search.json', 'utf8')));
    await adzunaSource.search(['data analyst', 'ml engineer'], criteria);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  // Discovery errors are written verbatim into the run report on disk, and
  // Adzuna takes its credentials as query parameters, so a failing request
  // must not carry them into the message.
  it('keeps the credentials out of the reported error on a non-200', async () => {
    mockFetch({}, 429);
    const result = await adzunaSource.search(['data analyst'], criteria);
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('supersecretkey-4b71');
    expect(result.error).not.toContain('appid-9f3c');
    expect(result.error).toContain('429');
  });
});
