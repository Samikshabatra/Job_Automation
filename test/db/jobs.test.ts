import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import {
  insertJob, getJobByFingerprint, updateJobStatus,
  listJobsByStatus, markMissingJobsClosed,
} from '../../src/db/jobs.js';
import { upsertBoard } from '../../src/db/boards.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

const base = {
  source: 'greenhouse', sourceJobId: '1', url: 'https://x/1',
  company: 'Acme', title: 'Data Analyst', normTitle: 'data analyst',
  location: 'Bengaluru', normLocation: 'bengaluru',
  postedAt: '2026-08-01T00:00:00.000Z', jdText: 'jd',
  atsPlatform: 'greenhouse' as const, boardId: null,
};

describe('insertJob', () => {
  it('inserts a job and returns its id', () => {
    const id = insertJob(db, { ...base, fingerprint: 'fp1' });
    expect(id).toBeGreaterThan(0);
    expect(getJobByFingerprint(db, 'fp1')?.company).toBe('Acme');
  });

  it('returns null for a duplicate fingerprint instead of throwing', () => {
    insertJob(db, { ...base, fingerprint: 'fp1' });
    expect(insertJob(db, { ...base, fingerprint: 'fp1', url: 'https://y/2' })).toBeNull();
  });

  it('defaults status to new and records first_seen_at', () => {
    insertJob(db, { ...base, fingerprint: 'fp2' });
    const row = getJobByFingerprint(db, 'fp2')!;
    expect(row.status).toBe('new');
    expect(row.first_seen_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('updateJobStatus', () => {
  it('records the status and its reason', () => {
    const id = insertJob(db, { ...base, fingerprint: 'fp3' })!;
    updateJobStatus(db, id, 'skipped', 'below threshold');
    const row = getJobByFingerprint(db, 'fp3')!;
    expect(row.status).toBe('skipped');
    expect(row.status_reason).toBe('below threshold');
  });
});

describe('listJobsByStatus', () => {
  it('returns only jobs in the requested status', () => {
    const a = insertJob(db, { ...base, fingerprint: 'a' })!;
    insertJob(db, { ...base, fingerprint: 'b' });
    updateJobStatus(db, a, 'tailored');
    expect(listJobsByStatus(db, 'tailored').map((r) => r.fingerprint)).toEqual(['a']);
  });
});

describe('markMissingJobsClosed', () => {
  it('closes jobs no longer present on their board', () => {
    const boardId = upsertBoard(db, {
      atsPlatform: 'greenhouse', boardToken: 'acme',
      companyName: 'Acme', discoveredVia: 'manual',
    });
    insertJob(db, { ...base, fingerprint: 'keep', sourceJobId: '1', boardId });
    insertJob(db, { ...base, fingerprint: 'gone', sourceJobId: '2', boardId });

    expect(markMissingJobsClosed(db, boardId, ['1'])).toBe(1);
    expect(getJobByFingerprint(db, 'gone')!.status).toBe('closed');
    expect(getJobByFingerprint(db, 'keep')!.status).toBe('new');
  });

  it('never re-closes an already submitted job', () => {
    const boardId = upsertBoard(db, {
      atsPlatform: 'lever', boardToken: 'beta',
      companyName: 'Beta', discoveredVia: 'manual',
    });
    const id = insertJob(db, { ...base, fingerprint: 'sub', sourceJobId: '9', boardId })!;
    updateJobStatus(db, id, 'submitted');
    expect(markMissingJobsClosed(db, boardId, [])).toBe(0);
    expect(getJobByFingerprint(db, 'sub')!.status).toBe('submitted');
  });
});
