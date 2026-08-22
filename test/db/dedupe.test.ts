import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Database } from '../../src/db/index.js';
import { dedupeBySourceId } from '../../src/db/dedupe.js';

let db: Database;

function addJob(fields: Partial<Record<string, unknown>> & { fingerprint: string }): number {
  const row = {
    board_id: 1, source: 'greenhouse', source_job_id: 'j1', url: 'https://x/1',
    company: 'Acme', title: 'Data Analyst', norm_title: 'data analyst',
    location: 'Pune', norm_location: 'pune', posted_at: null,
    first_seen_at: '2026-01-01T00:00:00Z', jd_text: 'jd', ats_platform: 'greenhouse',
    min_years: null, match_score: null, status: 'new', status_reason: null,
    resume_path: null, submitted_at: null, created_at: '2026-01-01T00:00:00Z',
    ...fields,
  };
  const cols = Object.keys(row);
  const info = db.prepare(
    `INSERT INTO jobs (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`,
  ).run(row);
  return Number(info.lastInsertRowid);
}

/**
 * Reproduces a database written before `idx_jobs_source_identity` existed --
 * the only state in which duplicate rows can be seeded at all, and precisely
 * the state `dedupeBySourceId` was written to clean up.
 */
function dropSourceIdentityIndex(): void {
  db.exec('DROP INDEX IF EXISTS idx_jobs_source_identity');
}

const INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_identity
  ON jobs(source, source_job_id) WHERE source_job_id IS NOT NULL`;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare(
    `INSERT INTO company_boards (id, ats_platform, board_token, company_name, discovered_at)
     VALUES (1, 'greenhouse', 'acme', 'Acme', '2026-01-01T00:00:00Z')`).run();
  dropSourceIdentityIndex();
});

describe('dedupeBySourceId', () => {
  it('collapses rows sharing a source and source_job_id', () => {
    addJob({ fingerprint: 'fp-old' });
    addJob({ fingerprint: 'fp-new' });

    expect(dedupeBySourceId(db)).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 1 });
  });

  it('keeps the most advanced row, not merely the oldest', () => {
    const older = addJob({ fingerprint: 'fp-old', status: 'skipped' });
    const newer = addJob({ fingerprint: 'fp-new', status: 'tailored', resume_path: '/tmp/a.pdf' });

    dedupeBySourceId(db);
    const rows = db.prepare('SELECT id, status, resume_path FROM jobs').all() as any[];
    expect(rows).toEqual([{ id: newer, status: 'tailored', resume_path: '/tmp/a.pdf' }]);
    expect(rows.map((r) => r.id)).not.toContain(older);
  });

  it('breaks a tie on status by keeping the lowest id', () => {
    const first = addJob({ fingerprint: 'fp-a', status: 'new' });
    addJob({ fingerprint: 'fp-b', status: 'new' });

    dedupeBySourceId(db);
    expect(db.prepare('SELECT id FROM jobs').all()).toEqual([{ id: first }]);
  });

  it('never collapses rows whose source_job_id is null', () => {
    addJob({ fingerprint: 'fp-a', source_job_id: null });
    addJob({ fingerprint: 'fp-b', source_job_id: null });

    expect(dedupeBySourceId(db)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 2 });
  });

  it('does not collapse the same source_job_id across different sources', () => {
    addJob({ fingerprint: 'fp-a', source: 'greenhouse' });
    addJob({ fingerprint: 'fp-b', source: 'lever' });

    expect(dedupeBySourceId(db)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 2 });
  });

  it('repoints an application at the surviving row before deleting its job', () => {
    // The application is filed against the copy that loses on rank, so the
    // repoint is actually exercised. Two equally-ranked rows would tie-break
    // to the lowest id and leave the application already on the winner.
    const loser = addJob({ fingerprint: 'fp-old', status: 'queued' });
    const winner = addJob({ fingerprint: 'fp-new', status: 'submitted' });
    db.prepare(
      `INSERT INTO applications (job_id, company, title, applied_at, method)
       VALUES (?, 'Acme', 'Data Analyst', '2026-01-02T00:00:00Z', 'api')`).run(loser);

    dedupeBySourceId(db);
    expect(db.prepare('SELECT job_id FROM applications').all()).toEqual([{ job_id: winner }]);
    expect(db.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 1 });
  });

  it('rebuilds cleanly enough that the unique index can then be created', () => {
    addJob({ fingerprint: 'fp-old' });
    addJob({ fingerprint: 'fp-new' });

    dedupeBySourceId(db);
    expect(() => db.exec(INDEX_SQL)).not.toThrow();
  });

  it('is a no-op on an already clean table', () => {
    addJob({ fingerprint: 'fp-a', source_job_id: 'j1' });
    addJob({ fingerprint: 'fp-b', source_job_id: 'j2' });

    expect(dedupeBySourceId(db)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 2 });
  });
});

describe('the source-identity unique index', () => {
  beforeEach(() => { db.exec(INDEX_SQL); });

  it('stops a second row for the same posting even when the fingerprint differs', () => {
    addJob({ fingerprint: 'fp-a' });
    expect(() => addJob({ fingerprint: 'fp-b' })).toThrow(/UNIQUE/i);
  });

  it('still allows many rows with no source_job_id', () => {
    addJob({ fingerprint: 'fp-a', source_job_id: null });
    expect(() => addJob({ fingerprint: 'fp-b', source_job_id: null })).not.toThrow();
  });
});
