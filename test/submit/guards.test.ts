import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { insertJob, getJobByFingerprint } from '../../src/db/jobs.js';
import { insertApplication } from '../../src/db/applications.js';
import { runGuards, randomDelayMs } from '../../src/submit/guards.js';
import type { Criteria } from '../../src/config/schema.js';
import type { JobRow } from '../../src/db/types.js';

const criteria: Criteria = {
  titles: { include: ['data analyst'], exclude: [] },
  experience: { max_years_required: 0 },
  locations: { include: ['remote'] },
  freshness: { max_posted_age_days: 7, verify_open_before_submit: true },
  scoring: { threshold: 60 },
  limits: { daily_cap: 2, per_company_open_applications: 2, min_delay_seconds: 45, max_delay_seconds: 120 },
  submission: { dry_run: false },
};

let db: Database;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'guards-'));
});

function makeJob(overrides: Partial<Record<string, unknown>> = {}): JobRow {
  const fingerprint = String(overrides.fingerprint ?? 'fp1');
  insertJob(db, {
    fingerprint,
    // Distinct per job: a board gives every posting its own id, and
    // `idx_jobs_source_identity` now enforces that, so a shared literal here
    // would silently collapse fixtures meant to be separate jobs.
    boardId: null, source: 'greenhouse', sourceJobId: fingerprint,
    url: 'https://x/1', company: String(overrides.company ?? 'Acme'),
    title: String(overrides.title ?? 'Data Analyst'), normTitle: 'data analyst',
    location: 'Remote', normLocation: 'remote',
    postedAt: '2026-07-30T00:00:00.000Z', jdText: 'jd', atsPlatform: 'greenhouse',
  });
  return getJobByFingerprint(db, fingerprint)!;
}

const ctx = (over: Partial<Parameters<typeof runGuards>[0]> = {}) => ({
  db, criteria, blocklist: [], now: new Date('2026-08-01T00:00:00.000Z'),
  projectRoot: root, submittedThisRun: 0,
  isStillOpen: async () => true,
  job: makeJob(),
  ...over,
});

describe('runGuards — ordering and outcomes', () => {
  it('allows a clean job', async () => {
    expect(await runGuards(ctx())).toEqual({ allow: true });
  });

  it('blocks on dry-run before anything else', async () => {
    const result = await runGuards(ctx({
      criteria: { ...criteria, submission: { dry_run: true } },
    }));
    expect(result).toMatchObject({ allow: false, status: 'dry-run' });
  });

  it('blocks when the PAUSE file exists', async () => {
    writeFileSync(join(root, 'PAUSE'), '');
    const result = await runGuards(ctx());
    expect(result).toMatchObject({ allow: false, status: 'deferred' });
    expect(result).toHaveProperty('reason', expect.stringContaining('PAUSE'));
  });

  it('blocks a blocklisted company regardless of spelling', async () => {
    const result = await runGuards(ctx({
      blocklist: [{ name: 'ACME Corp Pvt Ltd', reason: 'current employer' }],
    }));
    expect(result).toMatchObject({ allow: false, status: 'skipped' });
    expect(result).toHaveProperty('reason', expect.stringContaining('blocklist'));
  });

  it('blocks a job that already has an application', async () => {
    const job = makeJob();
    insertApplication(db, { jobId: job.id, company: 'Acme', title: 'Data Analyst', method: 'api', emailUsed: null });
    const result = await runGuards(ctx({ job }));
    expect(result).toMatchObject({ allow: false, status: 'skipped' });
  });

  it('holds a near-duplicate title at the same company', async () => {
    const first = makeJob({ fingerprint: 'fp1', title: 'Data Analyst' });
    insertApplication(db, { jobId: first.id, company: 'Acme', title: 'Data Analyst', method: 'api', emailUsed: null });

    const second = makeJob({ fingerprint: 'fp2', title: 'Data Analyst II' });
    const result = await runGuards(ctx({ job: second }));
    expect(result).toMatchObject({ allow: false, status: 'held' });
  });

  it('allows a genuinely different role at the same company', async () => {
    const first = makeJob({ fingerprint: 'fp1', title: 'Data Analyst' });
    insertApplication(db, { jobId: first.id, company: 'Acme', title: 'Data Analyst', method: 'api', emailUsed: null });

    const second = makeJob({ fingerprint: 'fp2', title: 'Machine Learning Engineer' });
    expect(await runGuards(ctx({ job: second }))).toEqual({ allow: true });
  });

  it('defers when the per-company cap is reached', async () => {
    for (const [i, title] of ['Data Analyst', 'Data Engineer'].entries()) {
      const j = makeJob({ fingerprint: `seed${i}`, title });
      insertApplication(db, { jobId: j.id, company: 'Acme', title, method: 'api', emailUsed: null });
    }
    const result = await runGuards(ctx({ job: makeJob({ fingerprint: 'fp9', title: 'Business Analyst' }) }));
    expect(result).toMatchObject({ allow: false, status: 'deferred' });
    expect(result).toHaveProperty('reason', expect.stringContaining('per-company'));
  });

  it('defers when the daily cap is reached', async () => {
    const result = await runGuards(ctx({ submittedThisRun: 2 }));
    expect(result).toMatchObject({ allow: false, status: 'deferred' });
    expect(result).toHaveProperty('reason', expect.stringContaining('daily cap'));
  });

  it('closes a job that is no longer open', async () => {
    const result = await runGuards(ctx({ isStillOpen: async () => false }));
    expect(result).toMatchObject({ allow: false, status: 'closed' });
  });

  it('skips the liveness check when verify_open_before_submit is false', async () => {
    const isStillOpen = vi.fn(async () => false);
    const result = await runGuards(ctx({
      isStillOpen,
      criteria: { ...criteria, freshness: { ...criteria.freshness, verify_open_before_submit: false } },
    }));
    expect(isStillOpen).not.toHaveBeenCalled();
    expect(result).toEqual({ allow: true });
  });
});

describe('randomDelayMs', () => {
  it('stays within the configured bounds', () => {
    for (let i = 0; i < 50; i++) {
      const ms = randomDelayMs(criteria);
      expect(ms).toBeGreaterThanOrEqual(45_000);
      expect(ms).toBeLessThanOrEqual(120_000);
    }
  });
});
