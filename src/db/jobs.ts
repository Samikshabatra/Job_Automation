import type { Database } from 'better-sqlite3';
import type { JobRow, JobStatus, NewJob } from './types.js';

const TERMINAL: JobStatus[] = ['submitted', 'closed'];

export function insertJob(db: Database, job: NewJob): number | null {
  const now = new Date().toISOString();
  try {
    const info = db
      .prepare(
        `INSERT INTO jobs (fingerprint, board_id, source, source_job_id, url, company,
           title, norm_title, location, norm_location, posted_at, first_seen_at,
           jd_text, ats_platform, status, created_at)
         VALUES (@fingerprint, @boardId, @source, @sourceJobId, @url, @company,
           @title, @normTitle, @location, @normLocation, @postedAt, @firstSeenAt,
           @jdText, @atsPlatform, 'new', @createdAt)`,
      )
      .run({ ...job, firstSeenAt: now, createdAt: now });
    return Number(info.lastInsertRowid);
  } catch (err) {
    const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' && err instanceof Error && err.message.includes('jobs.fingerprint')) {
      return null;
    }
    throw err;
  }
}

export function getJobByFingerprint(db: Database, fp: string): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE fingerprint = ?').get(fp) as JobRow | undefined;
}

export function getJobById(db: Database, id: number): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
}

export function updateJobStatus(db: Database, id: number, status: JobStatus, reason?: string): void {
  db.prepare('UPDATE jobs SET status = ?, status_reason = ? WHERE id = ?').run(status, reason ?? null, id);
}

export function setJobScore(db: Database, id: number, minYears: number, score: number): void {
  db.prepare('UPDATE jobs SET min_years = ?, match_score = ?, status = ? WHERE id = ?')
    .run(minYears, score, 'scored', id);
}

export function setJobResume(db: Database, id: number, path: string): void {
  db.prepare("UPDATE jobs SET resume_path = ?, status = 'tailored' WHERE id = ?").run(path, id);
}

export function markSubmitted(db: Database, id: number): void {
  db.prepare("UPDATE jobs SET status = 'submitted', submitted_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function listJobsByStatus(db: Database, status: JobStatus): JobRow[] {
  return db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY match_score DESC, id ASC')
    .all(status) as JobRow[];
}

export function markMissingJobsClosed(db: Database, boardId: number, seenSourceIds: string[]): number {
  const placeholders = seenSourceIds.map(() => '?').join(',') || "''";
  const terminals = TERMINAL.map(() => '?').join(',');
  const info = db
    .prepare(
      `UPDATE jobs SET status = 'closed', status_reason = 'no longer listed on board'
       WHERE board_id = ? AND status NOT IN (${terminals})
         AND (source_job_id IS NULL OR source_job_id NOT IN (${placeholders}))`,
    )
    .run(boardId, ...TERMINAL, ...seenSourceIds);
  return info.changes;
}
