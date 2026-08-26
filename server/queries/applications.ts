import type { Database } from '../../src/db/index.js';
import type { Page } from './jobs.js';

export interface ApplicationRow {
  id: number;
  job_id: number;
  company: string;
  title: string;
  applied_at: string;
  method: string;
  outcome: string;
  last_email_at: string | null;
  latest_subject: string | null;
  url: string | null;
}

export interface ApplicationFilters {
  q?: string;
  outcome?: string;
  company?: string;
  limit?: number;
  offset?: number;
}

/**
 * The latest email subject is pulled with a correlated subquery rather than a
 * join, because an application with three emails must still produce exactly
 * one row -- a join would silently triple it.
 */
const LATEST_SUBJECT = `(
  SELECT e.subject FROM email_events e
   WHERE e.application_id = a.id
   ORDER BY e.received_at DESC, e.id DESC LIMIT 1
)`;

function buildWhere(f: ApplicationFilters): { sql: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (f.q) {
    clauses.push('(a.company LIKE @q COLLATE NOCASE OR a.title LIKE @q COLLATE NOCASE)');
    params.q = `%${f.q}%`;
  }
  if (f.outcome) { clauses.push('a.outcome = @outcome'); params.outcome = f.outcome; }
  if (f.company) { clauses.push('a.company = @company'); params.company = f.company; }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function listApplications(db: Database, f: ApplicationFilters): Page<ApplicationRow> {
  const { sql: where, params } = buildWhere(f);
  const limit = Math.min(f.limit ?? 50, 200);
  const offset = f.offset ?? 0;

  const rows = db.prepare(
    `SELECT a.id, a.job_id, a.company, a.title, a.applied_at, a.method, a.outcome,
            a.last_email_at, ${LATEST_SUBJECT} AS latest_subject, j.url
       FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
       ${where}
      ORDER BY a.applied_at DESC, a.id DESC LIMIT @limit OFFSET @offset`,
  ).all({ ...params, limit, offset }) as ApplicationRow[];

  const { n } = db.prepare(`SELECT COUNT(*) n FROM applications a ${where}`)
    .get(params) as { n: number };

  return { rows, total: n };
}

export function getApplicationCompanies(db: Database): string[] {
  return (db.prepare(
    'SELECT DISTINCT company v FROM applications ORDER BY v COLLATE NOCASE',
  ).all() as { v: string }[]).map((r) => r.v);
}
