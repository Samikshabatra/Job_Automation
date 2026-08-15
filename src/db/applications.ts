import type { Database } from 'better-sqlite3';
import type { NewApplication } from './types.js';

const OPEN_OUTCOMES = ['awaiting', 'acknowledged', 'screening', 'interview'];

/** One flat row per submitted application, with its job's columns joined in. */
export interface TrackerApplication {
  applied_at: string;
  company: string;
  title: string;
  method: string;
  outcome: string;
  last_email_at: string | null;
  location: string | null;
  source: string;
  match_score: number | null;
  url: string;
  resume_path: string | null;
}

export function listApplicationsWithJob(db: Database): TrackerApplication[] {
  return db
    .prepare(
      `SELECT a.applied_at, a.company, a.title, a.method, a.outcome, a.last_email_at,
              j.location, j.source, j.match_score, j.url, j.resume_path
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
        ORDER BY a.applied_at DESC, a.id DESC`,
    )
    .all() as TrackerApplication[];
}

export function insertApplication(db: Database, a: NewApplication): number {
  const info = db
    .prepare(
      `INSERT INTO applications (job_id, company, title, applied_at, method, email_used)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(a.jobId, a.company, a.title, new Date().toISOString(), a.method, a.emailUsed);
  return Number(info.lastInsertRowid);
}

export function hasApplicationForJob(db: Database, jobId: number): boolean {
  return !!db.prepare('SELECT 1 FROM applications WHERE job_id = ?').get(jobId);
}

export function countOpenApplicationsByCompany(db: Database, company: string): number {
  const placeholders = OPEN_OUTCOMES.map(() => '?').join(',');
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM applications WHERE company = ? AND outcome IN (${placeholders})`)
    .get(company, ...OPEN_OUTCOMES) as { n: number };
  return row.n;
}

export function countApplicationsSince(db: Database, iso: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM applications WHERE applied_at >= ?')
    .get(iso) as { n: number };
  return row.n;
}

export function listApplicationTitlesByCompany(db: Database, company: string): string[] {
  const rows = db.prepare('SELECT title FROM applications WHERE company = ?')
    .all(company) as { title: string }[];
  return rows.map((r) => r.title);
}
