import type { Database } from '../../src/db/index.js';

export interface ReviewCard {
  id: number;
  company: string;
  title: string;
  url: string;
  ats_platform: string | null;
  match_score: number | null;
  location: string | null;
  resume_path: string | null;
  status: string;
  /** Guard verdict, recomputed now rather than when the job was queued. */
  blocked: string | null;
}

/**
 * The Tier C queue, as the Python reviewer would see it.
 *
 * The status filter is copied from `apply_agent.db.queued_jobs` deliberately:
 * two definitions of "queued" that drift apart would show a person a job the
 * reviewer will not open, or hide one it will.
 */
const QUEUE_STATUSES = ['tailored', 'deferred'];

export interface GuardSettings {
  browserEnabled: boolean;
  dailyCap: number;
  perCompanyCap: number;
}

const OPEN_OUTCOMES = ['awaiting', 'acknowledged', 'screening', 'interview'];

/**
 * Re-runs the guards that would block this job, in the same order as
 * `apply_agent.guards.preflight`.
 *
 * This is a read-only preview, not a second gate: the Python preflight still
 * runs when the job is actually opened, and it -- not this -- is what decides.
 * Showing the verdict up front just stops a person spending attention on a job
 * that will be refused the moment they act on it.
 */
export function guardVerdict(db: Database, job: { id: number; company: string }, s: GuardSettings): string | null {
  if (!s.browserEnabled) return 'browser submission disabled in settings';

  const today = new Date().toISOString().slice(0, 10);
  const { n: todayCount } = db.prepare(
    'SELECT COUNT(*) n FROM applications WHERE applied_at LIKE ?',
  ).get(`${today}%`) as { n: number };
  if (todayCount >= s.dailyCap) return `daily cap of ${s.dailyCap} reached`;

  const marks = OPEN_OUTCOMES.map(() => '?').join(', ');
  const { n: openForCompany } = db.prepare(
    `SELECT COUNT(*) n FROM applications WHERE company = ? AND outcome IN (${marks})`,
  ).get(job.company, ...OPEN_OUTCOMES) as { n: number };
  if (openForCompany >= s.perCompanyCap) return `already ${openForCompany} open applications at ${job.company}`;

  const { n: applied } = db.prepare(
    `SELECT COUNT(*) n FROM applications a
      WHERE a.job_id = ?
         OR a.job_id IN (SELECT j2.id FROM jobs j1 JOIN jobs j2 ON j2.fingerprint = j1.fingerprint
                          WHERE j1.id = ?)`,
  ).get(job.id, job.id) as { n: number };
  if (applied > 0) return 'already applied to this job';

  return null;
}

export function getReviewQueue(db: Database, s: GuardSettings): ReviewCard[] {
  const marks = QUEUE_STATUSES.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT id, company, title, url, ats_platform, match_score, location, resume_path, status
       FROM jobs WHERE status IN (${marks}) ORDER BY match_score DESC NULLS LAST, id`,
  ).all(...QUEUE_STATUSES) as Omit<ReviewCard, 'blocked'>[];

  return rows.map((r) => ({ ...r, blocked: guardVerdict(db, r, s) }));
}

/** The fields the agent would pre-fill, so the review screen can preview them. */
export interface ProfilePreview {
  full_name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  years_experience?: number | string;
}
