import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { insertJob } from '../../src/db/jobs.js';
import { insertApplication, listApplicationsWithJob } from '../../src/db/applications.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

const baseJob = {
  source: 'greenhouse', sourceJobId: '1', url: 'https://acme/apply/1',
  company: 'Acme', title: 'Data Analyst', normTitle: 'data analyst',
  location: 'Bengaluru', normLocation: 'bengaluru',
  postedAt: '2026-08-01T00:00:00.000Z', jdText: 'jd',
  atsPlatform: 'greenhouse' as const, boardId: null,
};

describe('listApplicationsWithJob', () => {
  it('joins each application to its job so the tracker has one flat row', () => {
    const jobId = insertJob(db, { ...baseJob, fingerprint: 'fp1' })!;
    db.prepare('UPDATE jobs SET match_score = 82, resume_path = ? WHERE id = ?')
      .run('/resumes/acme.pdf', jobId);
    insertApplication(db, {
      jobId, company: 'Acme', title: 'Data Analyst', method: 'api',
      emailUsed: 'me@x.com',
    });

    const rows = listApplicationsWithJob(db);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.company).toBe('Acme');
    expect(r.method).toBe('api');
    expect(r.outcome).toBe('awaiting');
    // job-derived columns
    expect(r.location).toBe('Bengaluru');
    expect(r.source).toBe('greenhouse');
    expect(r.match_score).toBe(82);
    expect(r.url).toBe('https://acme/apply/1');
    expect(r.resume_path).toBe('/resumes/acme.pdf');
  });

  it('returns an empty array when nothing has been submitted', () => {
    expect(listApplicationsWithJob(db)).toEqual([]);
  });
});
