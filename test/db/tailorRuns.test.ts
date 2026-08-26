import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type Database } from '../../src/db/index.js';
import { recordTailorRun, summariseTailoring } from '../../src/db/tailorRuns.js';
import type { ExperienceEntry } from '../../src/tailor/resume.js';
import type { TailorResponse } from '../../src/tailor/llm.js';

const SOURCE: ExperienceEntry[] = [
  {
    id: 'e1', role: 'Data Analyst', org: 'Acme', start: '2023-01', end: 'Present',
    bullets: [
      { id: 'b1', text: 'Built reporting pipelines in Python and SQL for finance', skills: ['python', 'sql'] },
      { id: 'b2', text: 'Automated weekly reconciliation saving eight hours', skills: [] },
    ],
  },
];

const TAILORED: TailorResponse = {
  entries: [{
    id: 'e1',
    bullets: [
      { id: 'b1', text: 'Built Python and SQL reporting pipelines for the finance team' },
      { id: 'b2', text: 'Automated weekly reconciliation saving eight hours' },
    ],
  }],
  summary: 'Data analyst applying for Analytics Engineer',
};

function seedJob(db: Database): number {
  const info = db.prepare(
    `INSERT INTO jobs (fingerprint, source, url, company, title, norm_title, first_seen_at, created_at, status)
     VALUES ('fp1', 'greenhouse', 'http://x/1', 'Snowflake', 'Analytics Engineer',
             'analytics engineer', '2026-08-26T00:00:00Z', '2026-08-26T00:00:00Z', 'tailored')`,
  ).run();
  return Number(info.lastInsertRowid);
}

describe('recordTailorRun', () => {
  let db: Database;
  let jobId: number;
  beforeEach(() => { db = openDb(':memory:'); jobId = seedJob(db); });
  afterEach(() => { db.close(); });

  const row = () => db.prepare('SELECT * FROM tailor_runs ORDER BY id DESC LIMIT 1').get() as
    Record<string, unknown>;

  it('stores the before and after so the screen can diff them', () => {
    recordTailorRun(db, {
      jobId, runId: null, source: SOURCE, tailored: TAILORED,
      verdict: 'pass', offending: [], resumePath: '/out/resume.pdf',
    });

    const r = row();
    expect(JSON.parse(r.tailored_json as string).summary).toContain('Analytics Engineer');
    expect(JSON.parse(r.original_json as string).entries[0].bullets[0].text).toContain('reporting pipelines');
  });

  it('computes similarity from the bullets that were actually rewritten', () => {
    recordTailorRun(db, {
      jobId, runId: null, source: SOURCE, tailored: TAILORED,
      verdict: 'pass', offending: [], resumePath: null,
    });

    // b2 is unchanged (similarity 1.0), b1 is reworded but faithful. The mean
    // therefore sits high but below 1.
    const similarity = row().similarity as number;
    expect(similarity).toBeGreaterThan(0.5);
    expect(similarity).toBeLessThan(1);
  });

  it('records a failed fabrication check with what was offending', () => {
    recordTailorRun(db, {
      jobId, runId: null, source: SOURCE, tailored: TAILORED,
      verdict: 'fail', offending: ['bullet b1: invented "Kubernetes"'], resumePath: null,
    });

    const r = row();
    expect(r.verdict).toBe('fail');
    expect(r.tailored_json as string).toContain('Kubernetes');
  });

  it('ties the row to the run that produced it when there is one', () => {
    const runId = Number(db.prepare(
      "INSERT INTO runs (kind, started_at, dry_run) VALUES ('daily', '2026-08-26T00:00:00Z', 1)",
    ).run().lastInsertRowid);

    recordTailorRun(db, {
      jobId, runId, source: SOURCE, tailored: TAILORED,
      verdict: 'pass', offending: [], resumePath: null,
    });
    expect(row().run_id).toBe(runId);
  });

  it('keeps every pass rather than overwriting the previous one', () => {
    // A job can be re-tailored after a fabrication failure. The history of
    // what was tried is the point of the table.
    for (const verdict of ['fail', 'pass'] as const) {
      recordTailorRun(db, { jobId, runId: null, source: SOURCE, tailored: TAILORED, verdict, offending: [], resumePath: null });
    }
    const { n } = db.prepare('SELECT COUNT(*) n FROM tailor_runs WHERE job_id = ?').get(jobId) as { n: number };
    expect(n).toBe(2);
  });

  it('never lets a failed write break the run that was tailoring', () => {
    // The dashboard reads this table; the pipeline does not. Losing a row is
    // acceptable, losing the tailored resume is not.
    db.prepare('DROP TABLE tailor_runs').run();
    expect(() => recordTailorRun(db, {
      jobId, runId: null, source: SOURCE, tailored: TAILORED,
      verdict: 'pass', offending: [], resumePath: null,
    })).not.toThrow();
  });
});

describe('summariseTailoring', () => {
  let db: Database;
  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => { db.close(); });

  it('reports zero for a database that has never tailored', () => {
    expect(summariseTailoring(db)).toEqual({ total: 0, passed: 0, failed: 0 });
  });

  it('counts passes and failures separately', () => {
    const jobId = seedJob(db);
    for (const verdict of ['pass', 'pass', 'fail'] as const) {
      recordTailorRun(db, { jobId, runId: null, source: SOURCE, tailored: TAILORED, verdict, offending: [], resumePath: null });
    }
    expect(summariseTailoring(db)).toEqual({ total: 3, passed: 2, failed: 1 });
  });
});
