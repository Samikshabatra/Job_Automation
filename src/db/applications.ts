import type { Database } from 'better-sqlite3';
import type { NewApplication } from './types.js';

const OPEN_OUTCOMES = ['awaiting', 'acknowledged', 'screening', 'interview'];

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
