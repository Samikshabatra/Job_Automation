import type { Database } from 'better-sqlite3';

export interface SourceHealthRow {
  source: string;
  consecutive_failures: number;
  last_ok_at: string | null;
  last_error_at: string | null;
}

export function recordSourceOutcome(db: Database, source: string, ok: boolean): void {
  const now = new Date().toISOString();
  if (ok) {
    db.prepare(
      `INSERT INTO source_health (source, consecutive_failures, last_ok_at)
       VALUES (?, 0, ?)
       ON CONFLICT(source) DO UPDATE SET consecutive_failures = 0, last_ok_at = excluded.last_ok_at`,
    ).run(source, now);
    return;
  }
  db.prepare(
    `INSERT INTO source_health (source, consecutive_failures, last_error_at)
     VALUES (?, 1, ?)
     ON CONFLICT(source) DO UPDATE SET
       consecutive_failures = source_health.consecutive_failures + 1,
       last_error_at = excluded.last_error_at`,
  ).run(source, now);
}

export function listUnhealthySources(db: Database, threshold: number): SourceHealthRow[] {
  return db
    .prepare(
      `SELECT * FROM source_health WHERE consecutive_failures >= ?
       ORDER BY consecutive_failures DESC, source ASC`,
    )
    .all(threshold) as SourceHealthRow[];
}
