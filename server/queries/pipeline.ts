import type { Database } from '../../src/db/index.js';

export interface BoardCard {
  id: number;
  company: string;
  title: string;
  match_score: number | null;
  status: string;
  first_seen_at: string;
}

export interface BoardColumn {
  key: string;
  label: string;
  count: number;
  cards: BoardCard[];
}

/**
 * The board's five columns are a presentation of `jobs.status`, not a second
 * state machine. Statuses that mean "this job left the pipeline" -- skipped,
 * stale, closed -- are deliberately absent: a column of 3,500 rejected jobs
 * would bury the handful that still need a human.
 */
const COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'discovered', label: 'Discovered', statuses: ['new'] },
  { key: 'scored',     label: 'Scored',     statuses: ['scored'] },
  { key: 'tailoring',  label: 'Tailoring',  statuses: ['tailored'] },
  { key: 'review',     label: 'Review',     statuses: ['held', 'deferred', 'queued', 'failed'] },
  { key: 'applied',    label: 'Applied',    statuses: ['submitted'] },
];

const CARDS_PER_COLUMN = 20;

export function getPipelineBoard(db: Database): BoardColumn[] {
  return COLUMNS.map((col) => {
    const marks = col.statuses.map(() => '?').join(', ');

    const { n } = db.prepare(
      `SELECT COUNT(*) n FROM jobs WHERE status IN (${marks})`,
    ).get(...col.statuses) as { n: number };

    const cards = db.prepare(
      `SELECT id, company, title, match_score, status, first_seen_at
         FROM jobs WHERE status IN (${marks})
        ORDER BY match_score DESC NULLS LAST, id DESC LIMIT ?`,
    ).all(...col.statuses, CARDS_PER_COLUMN) as BoardCard[];

    return { key: col.key, label: col.label, count: n, cards };
  });
}
