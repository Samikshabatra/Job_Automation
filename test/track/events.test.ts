import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Database } from '../../src/db/index.js';
import { recordEmailEvent, applyOutcome, latestSubjectFor, OUTCOME_RANK } from '../../src/track/events.js';

let db: Database;

function seedApplication(company = 'PhonePe'): number {
  db.prepare(
    `INSERT INTO jobs (id, fingerprint, source, source_job_id, url, company, title,
       norm_title, first_seen_at, created_at, status)
     VALUES (1,'fp1','greenhouse','sj1','https://x/1',?, 'DA','da',
       '2026-08-01T00:00:00Z','2026-08-01T00:00:00Z','submitted')`).run(company);
  const info = db.prepare(
    `INSERT INTO applications (job_id, company, title, applied_at, method)
     VALUES (1, ?, 'DA', '2026-08-01T00:00:00Z', 'agent')`).run(company);
  return Number(info.lastInsertRowid);
}

const evt = (over: Partial<Parameters<typeof recordEmailEvent>[1]> = {}) => ({
  gmailMsgId: 'm1', threadId: 't1', receivedAt: '2026-08-05T09:00:00Z',
  fromAddress: 'careers@phonepe.com', subject: 'Update',
  applicationId: null as number | null, classifiedAs: null as string | null,
  confidence: 0, ...over,
});

beforeEach(() => { db = openDb(':memory:'); });

describe('recordEmailEvent', () => {
  it('stores the event and derives the sender domain', () => {
    recordEmailEvent(db, evt());
    const row = db.prepare('SELECT from_domain, subject FROM email_events').get() as any;
    expect(row.from_domain).toBe('phonepe.com');
  });

  it('is idempotent on gmail_msg_id, so a re-poll cannot duplicate', () => {
    expect(recordEmailEvent(db, evt())).not.toBeNull();
    expect(recordEmailEvent(db, evt())).toBeNull();
    expect((db.prepare('SELECT COUNT(*) n FROM email_events').get() as any).n).toBe(1);
  });
});

describe('applyOutcome', () => {
  it('advances the application outcome and stamps last contact', () => {
    const id = seedApplication();
    applyOutcome(db, id, 'interview', '2026-08-05T09:00:00Z');
    const row = db.prepare('SELECT outcome, last_email_at FROM applications WHERE id=?').get(id) as any;
    expect(row.outcome).toBe('interview');
    expect(row.last_email_at).toBe('2026-08-05T09:00:00Z');
  });

  it('never regresses a further-along outcome', () => {
    // An automated "we received your application" often arrives AFTER a real
    // interview invite. Letting it overwrite would erase the good news.
    const id = seedApplication();
    applyOutcome(db, id, 'interview', '2026-08-05T09:00:00Z');
    applyOutcome(db, id, 'acknowledged', '2026-08-06T09:00:00Z');
    const row = db.prepare('SELECT outcome, last_email_at FROM applications WHERE id=?').get(id) as any;
    expect(row.outcome).toBe('interview');
    // Contact time still advances -- the mail did arrive.
    expect(row.last_email_at).toBe('2026-08-06T09:00:00Z');
  });

  it('always lets a rejection land, even after an interview', () => {
    const id = seedApplication();
    applyOutcome(db, id, 'interview', '2026-08-05T09:00:00Z');
    applyOutcome(db, id, 'rejected', '2026-08-07T09:00:00Z');
    expect((db.prepare('SELECT outcome FROM applications WHERE id=?').get(id) as any).outcome)
      .toBe('rejected');
  });

  it('ranks outcomes so the ordering is explicit, not incidental', () => {
    expect(OUTCOME_RANK.interview).toBeGreaterThan(OUTCOME_RANK.acknowledged);
    expect(OUTCOME_RANK.offer).toBeGreaterThan(OUTCOME_RANK.interview);
  });
});

describe('latestSubjectFor', () => {
  it('returns the most recent subject for an application', () => {
    const id = seedApplication();
    recordEmailEvent(db, evt({ gmailMsgId: 'a', receivedAt: '2026-08-01T00:00:00Z', subject: 'Older', applicationId: id }));
    recordEmailEvent(db, evt({ gmailMsgId: 'b', receivedAt: '2026-08-09T00:00:00Z', subject: 'Newer', applicationId: id }));
    expect(latestSubjectFor(db, id)).toBe('Newer');
  });

  it('returns null when there are no events', () => {
    expect(latestSubjectFor(db, seedApplication())).toBeNull();
  });
});
