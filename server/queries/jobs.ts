import type { Database } from '../../src/db/index.js';
import type { JobRow } from '../../src/db/types.js';

export interface JobFilters {
  q?: string;
  source?: string;
  location?: string;
  status?: string;
  minScore?: number;
  since?: string;
  sort?: 'score' | 'recent' | 'company';
  limit?: number;
  offset?: number;
}

export interface JobListRow {
  id: number;
  title: string;
  company: string;
  source: string;
  location: string | null;
  match_score: number | null;
  status: string;
  first_seen_at: string;
  url: string;
  ats_platform: string | null;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

const SORTS: Record<string, string> = {
  score: 'match_score DESC NULLS LAST, id DESC',
  recent: 'first_seen_at DESC, id DESC',
  company: 'company COLLATE NOCASE ASC, id DESC',
};

/**
 * Builds the WHERE clause once and uses it for both the page and the count, so
 * the total can never disagree with the rows it is supposed to describe.
 * Filters combine with AND: each one narrows, none replaces another.
 */
function buildWhere(f: JobFilters): { sql: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (f.q) {
    clauses.push('(company LIKE @q COLLATE NOCASE OR title LIKE @q COLLATE NOCASE)');
    params.q = `%${f.q}%`;
  }
  if (f.source) { clauses.push('source = @source'); params.source = f.source; }
  if (f.status) { clauses.push('status = @status'); params.status = f.status; }
  if (f.location) {
    clauses.push('(location LIKE @location COLLATE NOCASE OR norm_location LIKE @location COLLATE NOCASE)');
    params.location = `%${f.location}%`;
  }
  if (f.minScore !== undefined) {
    clauses.push('match_score >= @minScore');
    params.minScore = f.minScore;
  }
  if (f.since) { clauses.push('first_seen_at >= @since'); params.since = f.since; }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function listJobs(db: Database, f: JobFilters): Page<JobListRow> {
  const { sql: where, params } = buildWhere(f);
  const order = SORTS[f.sort ?? 'score'] ?? SORTS.score;
  const limit = Math.min(f.limit ?? 50, 200);
  const offset = f.offset ?? 0;

  const rows = db.prepare(
    `SELECT id, title, company, source, location, match_score, status, first_seen_at, url, ats_platform
       FROM jobs ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`,
  ).all({ ...params, limit, offset }) as JobListRow[];

  const { n } = db.prepare(`SELECT COUNT(*) n FROM jobs ${where}`)
    .get(params) as { n: number };

  return { rows, total: n };
}

export function getJobDetail(db: Database, id: number): JobRow | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ?? null;
}

/** How many locations the filter offers. */
export const LOCATION_FACET_LIMIT = 25;

/**
 * Distinct values behind the filter dropdowns, so they never offer a dead option.
 *
 * Locations are the awkward one: the raw column holds 800+ variants, including
 * junk a board wrote into its own field ("*Job Posting Only: US"). Offering all
 * of them is a dropdown nobody can use, so this returns the most common
 * NORMALIZED locations -- which is also what the filter matches against.
 */
export function getJobFacets(db: Database): {
  sources: string[];
  locations: { value: string; count: number }[];
  statuses: string[];
} {
  const col = (name: string) =>
    (db.prepare(
      `SELECT DISTINCT ${name} v FROM jobs WHERE ${name} IS NOT NULL AND ${name} != '' ORDER BY v`,
    ).all() as { v: string }[]).map((r) => r.v);

  const locations = db.prepare(
    `SELECT norm_location value, COUNT(*) count FROM jobs
      WHERE norm_location IS NOT NULL AND norm_location != ''
      GROUP BY norm_location ORDER BY count DESC, value LIMIT ?`,
  ).all(LOCATION_FACET_LIMIT) as { value: string; count: number }[];

  return { sources: col('source'), locations, statuses: col('status') };
}
