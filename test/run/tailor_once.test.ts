import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { insertJob } from '../../src/db/jobs.js';
import { tailorOnce } from '../../src/run/tailor_once.js';
import type { Resume } from '../../src/tailor/resume.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

const resume: Resume = {
  profile: { name: 'Samiksha Batra', email: 'me@x.com', phone: '999', links: {} },
  experience: [{
    id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
    start: '2025-06', end: '2025-12',
    bullets: [{ id: 'a1', text: 'Built SQL pipelines aggregating 12M rows', skills: ['sql'] }],
  }],
  education: [],
  skills: { sql: [], python: [] },
};

function seedJob(): number {
  return insertJob(db, {
    fingerprint: 'fp1', boardId: null, source: 'greenhouse', sourceJobId: '1',
    url: 'https://x/1', company: 'Acme', title: 'Data Analyst', normTitle: 'data analyst',
    location: 'Bengaluru', normLocation: 'bengaluru', postedAt: null,
    jdText: 'We need SQL and Python skills', atsPlatform: 'greenhouse',
  })!;
}

const faithful = JSON.stringify({
  entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL data pipelines aggregating 12M rows' }] }],
  summary: 'Analyst with SQL pipelines experience.',
});

const fabricated = JSON.stringify({
  entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL pipelines at Google aggregating 12M rows' }] }],
  summary: '',
});

describe('tailorOnce', () => {
  it('renders and returns ok with a resume path when the pass survives the gate', async () => {
    const jobId = seedJob();
    const render = vi.fn(async () => {});
    const result = await tailorOnce({
      db, jobId, resume, now: new Date('2026-08-18T00:00:00Z'), archiveDir: '/out',
      callLlm: async () => faithful, render,
    });
    expect(result.ok).toBe(true);
    expect(result.resumePath).toContain('Acme_Data_Analyst_20260818.pdf');
    expect(result.offending).toEqual([]);
    expect(render).toHaveBeenCalledOnce();
  });

  it('returns ok=false with the offending bullets and does NOT render on a fabrication failure', async () => {
    const jobId = seedJob();
    const render = vi.fn(async () => {});
    const result = await tailorOnce({
      db, jobId, resume, now: new Date('2026-08-18T00:00:00Z'), archiveDir: '/out',
      callLlm: async () => fabricated, render,
    });
    expect(result.ok).toBe(false);
    expect(result.resumePath).toBeUndefined();
    expect(result.offending.join(' ')).toContain('Google');
    expect(render).not.toHaveBeenCalled();
  });

  it('passes the repair hint through to the tailor prompt', async () => {
    const jobId = seedJob();
    const call = vi.fn(async () => faithful);
    await tailorOnce({
      db, jobId, resume, now: new Date('2026-08-18T00:00:00Z'), archiveDir: '/out',
      callLlm: call, render: async () => {}, repairHint: 'Remove terms not in the resume: Google',
    });
    expect(call.mock.calls[0][0]).toContain('Remove terms not in the resume: Google');
  });
});
