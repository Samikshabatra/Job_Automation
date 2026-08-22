import type { Database } from 'better-sqlite3';

/**
 * How advanced a row is, highest wins. When the same posting was stored twice
 * we keep whichever copy the pipeline invested the most work in, so a rendered
 * resume or a recorded submission is never the row that gets deleted.
 */
const STATUS_RANK: Record<string, number> = {
  submitted: 90, queued: 80, tailored: 70, deferred: 60, held: 55,
  scored: 50, new: 40, failed: 30, stale: 20, skipped: 10, closed: 5,
};

interface DupRow { id: number; status: string }

/**
 * Collapse rows that describe the SAME posting on the same board.
 *
 * `jobs.fingerprint` hashes the *normalized* company, title and location, so
 * it is a fuzzy cross-source key: it is what catches one role listed on both
 * LinkedIn and a Greenhouse board. That also makes it unstable under our own
 * code — widening the location alias map changes what "Hyderabad, India"
 * normalizes to, which changes the hash, which lets the next poll insert a
 * second row for a posting already stored. 440 of 4884 rows were duplicates
 * by the time this was written.
 *
 * `(source, source_job_id)` is the board's own identifier: exact, and immune
 * to anything we do to the normalizers. This collapses on that pair and leaves
 * the fingerprint to go on doing the fuzzy cross-source job for discovery hits
 * that carry no `source_job_id`.
 *
 * Idempotent: returns 0 on a clean table, so it is safe to run on every open.
 */
export function dedupeBySourceId(db: Database): number {
  const groups = db.prepare(
    `SELECT source, source_job_id FROM jobs
      WHERE source_job_id IS NOT NULL
      GROUP BY source, source_job_id HAVING COUNT(*) > 1`,
  ).all() as { source: string; source_job_id: string }[];

  if (groups.length === 0) return 0;

  const rowsFor = db.prepare(
    'SELECT id, status FROM jobs WHERE source = ? AND source_job_id = ? ORDER BY id ASC',
  );
  const repoint = db.prepare('UPDATE applications SET job_id = ? WHERE job_id = ?');
  const remove = db.prepare('DELETE FROM jobs WHERE id = ?');

  let deleted = 0;
  const run = db.transaction(() => {
    for (const g of groups) {
      const rows = rowsFor.all(g.source, g.source_job_id) as DupRow[];
      // Ties on status fall back to the lowest id, which `ORDER BY id ASC`
      // above already puts first — `reduce` only replaces on a strict win.
      const winner = rows.reduce((best, r) =>
        (STATUS_RANK[r.status] ?? 0) > (STATUS_RANK[best.status] ?? 0) ? r : best);

      for (const r of rows) {
        if (r.id === winner.id) continue;
        // Applications outlive the job row they were filed against, so move
        // them across before the delete rather than letting the FK cascade or
        // orphan them.
        repoint.run(winner.id, r.id);
        remove.run(r.id);
        deleted++;
      }
    }
  });
  run();
  return deleted;
}
