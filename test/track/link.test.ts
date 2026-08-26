import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Database } from '../../src/db/index.js';
import { linkEmailToApplication, companyTokens } from '../../src/track/link.js';

let db: Database;

function seed(company: string, jobId = 1): number {
  db.prepare(
    `INSERT INTO jobs (id, fingerprint, source, source_job_id, url, company, title,
       norm_title, first_seen_at, created_at, status)
     VALUES (?, 'fp' || ?, 'greenhouse', 'sj' || ?, 'https://x/1', ?, 'Data Analyst',
       'data analyst', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'submitted')`,
  ).run(jobId, jobId, jobId, company);
  const info = db.prepare(
    `INSERT INTO applications (job_id, company, title, applied_at, method)
     VALUES (?, ?, 'Data Analyst', '2026-08-01T00:00:00Z', 'agent')`,
  ).run(jobId, company);
  return Number(info.lastInsertRowid);
}

beforeEach(() => { db = openDb(':memory:'); });

describe('companyTokens', () => {
  it('drops suffixes and punctuation so a domain can be compared', () => {
    expect(companyTokens('PhonePe Pvt. Ltd.')).toContain('phonepe');
    expect(companyTokens('MongoDB, Inc.')).toEqual(['mongodb']);
  });

  it('drops two-letter tokens, which match noise in domains', () => {
    // "db", "hr", "it", "ai" appear inside countless hostnames. Keeping them
    // would link a company to any sender whose domain merely contains them.
    expect(companyTokens('Mongo DB, Inc.')).toEqual(['mongo']);
  });

  it('ignores tokens too short to identify anyone', () => {
    expect(companyTokens('X Corp')).not.toContain('x');
  });
});

describe('linkEmailToApplication', () => {
  it('links on the sender domain matching the company name', () => {
    const id = seed('PhonePe');
    expect(linkEmailToApplication(db, 'careers@phonepe.com', 'Update')).toBe(id);
  });

  it('links through a subdomain', () => {
    const id = seed('HackerRank');
    expect(linkEmailToApplication(db, 'no-reply@mail.hackerrank.com', 'Hi')).toBe(id);
  });

  it('falls back to the company name appearing in the subject', () => {
    const id = seed('InMobi');
    // Greenhouse and Lever send from their own domains, not the employer's.
    expect(linkEmailToApplication(db, 'no-reply@greenhouse.io', 'Your InMobi application')).toBe(id);
  });

  it('returns null when nothing matches, rather than guessing', () => {
    seed('PhonePe');
    expect(linkEmailToApplication(db, 'newsletter@medium.com', 'Weekly digest')).toBeNull();
  });

  it('never links an ATS sender to an arbitrary application', () => {
    // The dangerous case: every Greenhouse mail would otherwise attach to
    // whichever Greenhouse application happens to be first.
    seed('PhonePe', 1);
    seed('InMobi', 2);
    expect(linkEmailToApplication(db, 'no-reply@greenhouse.io', 'An update')).toBeNull();
  });

  it('prefers the subject match when the domain is a generic ATS host', () => {
    seed('PhonePe', 1);
    const inmobi = seed('InMobi', 2);
    expect(linkEmailToApplication(db, 'no-reply@greenhouse.io', 'InMobi - next steps')).toBe(inmobi);
  });
});
