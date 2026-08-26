import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Database } from '../../src/db/index.js';
import { syncInbox, type InboxEmail } from '../../src/track/inbox.js';

let db: Database;

function seedApplication(company: string, jobId: number): number {
  db.prepare(
    `INSERT INTO jobs (id, fingerprint, source, source_job_id, url, company, title,
       norm_title, first_seen_at, created_at, status)
     VALUES (?, 'fp'||?, 'greenhouse', 'sj'||?, 'https://x/1', ?, 'DA','da',
       '2026-08-01T00:00:00Z','2026-08-01T00:00:00Z','submitted')`).run(jobId, jobId, jobId, company);
  const info = db.prepare(
    `INSERT INTO applications (job_id, company, title, applied_at, method)
     VALUES (?, ?, 'DA', '2026-08-01T00:00:00Z', 'agent')`).run(jobId, company);
  return Number(info.lastInsertRowid);
}

const email = (over: Partial<InboxEmail> = {}): InboxEmail => ({
  id: 'm1', threadId: 't1', receivedAt: '2026-08-05T09:00:00Z',
  from: 'careers@phonepe.com', subject: 'Update', body: '', ...over,
});

const NOW = new Date('2026-08-10T00:00:00Z');

beforeEach(() => { db = openDb(':memory:'); });

describe('syncInbox', () => {
  it('links, classifies and advances the application', async () => {
    const id = seedApplication('PhonePe', 1);
    const s = await syncInbox(db, {
      fetchEmails: async () => [email({ subject: 'Interview invitation' })],
      now: NOW,
    });
    expect(s.linked).toBe(1);
    expect(s.classifiedByRule).toBe(1);
    expect((db.prepare('SELECT outcome FROM applications WHERE id=?').get(id) as any).outcome)
      .toBe('interview');
  });

  it('records an unlinked email without touching any application', async () => {
    seedApplication('PhonePe', 1);
    const s = await syncInbox(db, {
      fetchEmails: async () => [email({ from: 'news@medium.com', subject: 'Digest' })],
      now: NOW,
    });
    expect(s.unlinked).toBe(1);
    expect((db.prepare('SELECT outcome FROM applications').get() as any).outcome).toBe('awaiting');
    expect((db.prepare('SELECT COUNT(*) n FROM email_events').get() as any).n).toBe(1);
  });

  it('is idempotent across overlapping polls', async () => {
    seedApplication('PhonePe', 1);
    const deps = { fetchEmails: async () => [email({ subject: 'Interview invitation' })], now: NOW };
    await syncInbox(db, deps);
    const second = await syncInbox(db, deps);
    expect(second.skippedAlreadySeen).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM email_events').get() as any).n).toBe(1);
  });

  it('spends an LLM call only when the rules abstain', async () => {
    seedApplication('PhonePe', 1);
    const calls: string[] = [];
    const s = await syncInbox(db, {
      fetchEmails: async () => [
        email({ id: 'a', subject: 'We regret to inform you' }),
        email({ id: 'b', subject: 'Quick question about your background' }),
      ],
      classifyWithLlm: async (e) => { calls.push(e.id); return 'screening'; },
      now: NOW,
    });
    expect(calls).toEqual(['b']);          // the rule-matched email cost nothing
    expect(s.classifiedByRule).toBe(1);
    expect(s.classifiedByLlm).toBe(1);
  });

  it('survives an LLM failure by leaving the email unclassified', async () => {
    seedApplication('PhonePe', 1);
    const s = await syncInbox(db, {
      fetchEmails: async () => [email({ subject: 'Quick question' })],
      classifyWithLlm: async () => { throw new Error('429 quota'); },
      now: NOW,
    });
    expect(s.unclassified).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM email_events').get() as any).n).toBe(1);
  });

  it('marks a silent application ghosted after the threshold', async () => {
    const id = seedApplication('PhonePe', 1);
    // Applied 2026-08-01, no contact, and "now" is 30 days later.
    const s = await syncInbox(db, {
      fetchEmails: async () => [],
      now: new Date('2026-08-31T00:00:00Z'),
    });
    expect(s.ghosted).toBe(1);
    expect((db.prepare('SELECT outcome FROM applications WHERE id=?').get(id) as any).outcome)
      .toBe('ghosted');
  });

  it('never ghosts an application that already has a real outcome', async () => {
    const id = seedApplication('PhonePe', 1);
    db.prepare("UPDATE applications SET outcome='interview' WHERE id=?").run(id);
    const s = await syncInbox(db, { fetchEmails: async () => [], now: new Date('2026-09-30T00:00:00Z') });
    expect(s.ghosted).toBe(0);
    expect((db.prepare('SELECT outcome FROM applications WHERE id=?').get(id) as any).outcome)
      .toBe('interview');
  });
});
