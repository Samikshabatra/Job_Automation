import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { upsertBoard } from '../../src/db/boards.js';
import { insertJob, listJobsByStatus } from '../../src/db/jobs.js';
import { insertApplication } from '../../src/db/applications.js';
import { runDaily, type RunDeps } from '../../src/run/daily.js';
import type { Criteria } from '../../src/config/schema.js';
import type { ExperienceEntry, Profile } from '../../src/tailor/resume.js';

const criteria: Criteria = {
  titles: { include: ['data analyst'], exclude: ['senior'] },
  experience: { max_years_required: 0 },
  locations: { include: ['bengaluru', 'remote'] },
  freshness: { max_posted_age_days: 7, verify_open_before_submit: true },
  scoring: { threshold: 40 },
  limits: { daily_cap: 30, per_company_open_applications: 3, min_delay_seconds: 0, max_delay_seconds: 0 },
  submission: { dry_run: true },
};

const profile: Profile = {
  name: 'Example Candidate', email: 'e@example.com', phone: '+91 90000 00000',
  location: 'Bengaluru', links: {},
};

const experience: ExperienceEntry[] = [{
  id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
  start: '2025-06', end: '2025-12',
  bullets: [{ id: 'a1', text: 'Built SQL pipelines', skills: ['sql'] }],
}];

let db: Database;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'daily-'));
  upsertBoard(db, { atsPlatform: 'greenhouse', boardToken: 'acme', companyName: 'Acme', discoveredVia: 'manual' });
});

function deps(over: Partial<RunDeps> = {}) {
  return {
    db, criteria, blocklist: [], companies: [], projectRoot: root,
    resume: { profile, experience, education: [], skills: { sql: ['sql'], python: ['python'] } },
    now: new Date('2026-08-01T00:00:00.000Z'),
    fetchBoard: async () => ({
      ok: true,
      jobs: [{
        sourceJobId: '1', url: 'https://boards.greenhouse.io/acme/jobs/1',
        company: 'Acme', title: 'Data Analyst', location: 'Bengaluru',
        postedAt: '2026-07-31T00:00:00.000Z',
        jdText: 'Fresher role. SQL required. 0-2 years.', atsPlatform: 'greenhouse' as const,
      }],
    }),
    runDiscovery: async () => ({ hits: [], failures: [] }),
    resolveCompanies: async () => ({ resolved: [], unresolved: [] }),
    callLlm: async () => JSON.stringify({
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL pipelines' }] }],
      summary: 'Analyst.',
    }),
    render: vi.fn(async () => undefined),
    submit: vi.fn(async () => undefined),
    isStillOpen: async () => true,
    ...over,
  } satisfies RunDeps;
}

describe('runDaily', () => {
  it('runs the full funnel and reports each stage', async () => {
    const report = await runDaily(deps());
    expect(report.boardsPolled).toBe(1);
    expect(report.fetched).toBe(1);
    expect(report.tailored).toBe(1);
  });

  it('does not submit when dry_run is enabled', async () => {
    const d = deps();
    const report = await runDaily(d);
    expect(d.submit).not.toHaveBeenCalled();
    expect(report.outcomes['dry-run']).toBe(1);
    expect(report.submitted).toBe(0);
  });

  it('submits when dry_run is disabled', async () => {
    const d = deps({ criteria: { ...criteria, submission: { dry_run: false } } });
    const report = await runDaily(d);
    expect(d.submit).toHaveBeenCalledOnce();
    expect(report.submitted).toBe(1);
  });

  it('filters out a job requiring too many years before tailoring', async () => {
    const callLlm = vi.fn(async () => '');
    const d = deps({
      fetchBoard: async () => ({
        ok: true,
        jobs: [{
          sourceJobId: '2', url: 'https://boards.greenhouse.io/acme/jobs/2',
          company: 'Acme', title: 'Data Analyst', location: 'Bengaluru',
          postedAt: '2026-07-31T00:00:00.000Z',
          jdText: 'Requires 3+ years of experience.', atsPlatform: 'greenhouse' as const,
        }],
      }),
      callLlm,
    });
    const report = await runDaily(d);
    expect(report.tailored).toBe(0);
    expect(callLlm).not.toHaveBeenCalled();
    expect(listJobsByStatus(db, 'skipped')).toHaveLength(1);
  });

  it('does not re-insert a job seen on a previous run', async () => {
    await runDaily(deps());
    const second = await runDaily(deps());
    expect(second.deduped).toBe(1);
  });

  it('records source failures without aborting the run', async () => {
    const report = await runDaily(deps({
      runDiscovery: async () => ({ hits: [], failures: [{ source: 'adzuna', error: 'HTTP 429' }] }),
    }));
    expect(report.sourceFailures).toHaveLength(1);
    expect(report.fetched).toBe(1);
  });

  it('marks a job closed when it disappears from the board', async () => {
    await runDaily(deps());
    await runDaily(deps({ fetchBoard: async () => ({ ok: true, jobs: [] }) }));
    expect(listJobsByStatus(db, 'closed')).toHaveLength(1);
  });

  it('fails the job rather than rendering when the LLM fabricates', async () => {
    const d = deps({
      callLlm: async () => JSON.stringify({
        entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Led a team of 40 at Google for six years' }] }],
        summary: 'x',
      }),
    });
    await runDaily(d);
    expect(d.render).not.toHaveBeenCalled();
    expect(listJobsByStatus(db, 'failed')).toHaveLength(1);
  });

  // Spec §5.5: "`deferred` jobs are automatically reconsidered on the next run".
  // A submit loop that only reads status 'tailored' strands them permanently —
  // every job that ever hits the daily or per-company cap is silently lost.
  it('reconsiders a deferred job on the next run', async () => {
    // Occupy the single per-company slot with an unrelated prior application,
    // so the job under test is deferred by the cap rather than held as a
    // near-duplicate.
    const seedId = insertJob(db, {
      fingerprint: 'seed', boardId: null, source: 'greenhouse', sourceJobId: 'seed',
      url: 'https://boards.greenhouse.io/acme/jobs/seed', company: 'Acme',
      title: 'Backend Engineer', normTitle: 'backend engineer',
      location: 'Remote', normLocation: 'remote', postedAt: null,
      jdText: null, atsPlatform: 'greenhouse',
    })!;
    insertApplication(db, {
      jobId: seedId, company: 'Acme', title: 'Backend Engineer', method: 'api', emailUsed: null,
    });

    const capped = { ...criteria, submission: { dry_run: false }, limits: { ...criteria.limits, per_company_open_applications: 1 } };
    const first = await runDaily(deps({ criteria: capped }));
    expect(first.outcomes.deferred).toBe(1);
    expect(first.submitted).toBe(0);
    expect(listJobsByStatus(db, 'deferred')).toHaveLength(1);

    const roomy = { ...criteria, submission: { dry_run: false } };
    const d = deps({ criteria: roomy });
    const second = await runDaily(d);
    expect(second.submitted).toBe(1);
    expect(d.submit).toHaveBeenCalledOnce();
  });

  it('does not reconsider a held job', async () => {
    const seedId = insertJob(db, {
      fingerprint: 'seed', boardId: null, source: 'greenhouse', sourceJobId: 'seed',
      url: 'https://boards.greenhouse.io/acme/jobs/seed', company: 'Acme',
      title: 'Data Analyst', normTitle: 'data analyst',
      location: 'Remote', normLocation: 'remote', postedAt: null,
      jdText: null, atsPlatform: 'greenhouse',
    })!;
    insertApplication(db, {
      jobId: seedId, company: 'Acme', title: 'Data Analyst', method: 'api', emailUsed: null,
    });

    const live = { ...criteria, submission: { dry_run: false } };
    const first = await runDaily(deps({ criteria: live }));
    expect(first.outcomes.held).toBe(1);

    const d = deps({ criteria: live });
    await runDaily(d);
    expect(d.submit).not.toHaveBeenCalled();
    expect(listJobsByStatus(db, 'held')).toHaveLength(1);
  });
});
