import type { Database } from '../../src/db/index.js';

export interface OverviewOptions {
  threshold: number;
  today: string;
}

export interface PipelineStep {
  key: string;
  label: string;
  state: 'complete' | 'active' | 'waiting';
  count: number;
}

export interface Overview {
  stats: {
    discovered: number;
    discoveredToday: number;
    qualified: number;
    qualifiedToday: number;
    applied: number;
    appliedToday: number;
    responses: number;
    responsesToday: number;
  };
  pipeline: PipelineStep[];
  activity: { at: string; text: string }[];
  brief: string[];
  lastRun: { kind: string; started_at: string; finished_at: string | null; exit_code: number | null } | null;
}

const count = (db: Database, sql: string, ...params: unknown[]): number =>
  (db.prepare(sql).get(...params) as { n: number }).n;

/**
 * Everything the Overview screen shows, in one round trip.
 *
 * `qualified` is defined against the score threshold rather than against job
 * status on purpose: status moves on as a job is tailored and applied to, so
 * counting statuses would make the number fall as the pipeline succeeds --
 * exactly backwards from what the tile is meant to say.
 */
export function getOverview(db: Database, opts: OverviewOptions): Overview {
  const day = `${opts.today}%`;

  const discovered = count(db, 'SELECT COUNT(*) n FROM jobs');
  const discoveredToday = count(db, 'SELECT COUNT(*) n FROM jobs WHERE first_seen_at LIKE ?', day);
  const qualified = count(db, 'SELECT COUNT(*) n FROM jobs WHERE match_score >= ?', opts.threshold);
  const qualifiedToday = count(
    db,
    'SELECT COUNT(*) n FROM jobs WHERE match_score >= ? AND first_seen_at LIKE ?',
    opts.threshold, day,
  );

  const applied = count(db, 'SELECT COUNT(*) n FROM applications');
  const appliedToday = count(db, 'SELECT COUNT(*) n FROM applications WHERE applied_at LIKE ?', day);

  // A response is an application an employer has actually replied to. Counting
  // email_events instead would count a three-mail thread as three responses.
  const responses = count(db, "SELECT COUNT(*) n FROM applications WHERE outcome != 'awaiting'");
  const responsesToday = count(
    db,
    "SELECT COUNT(*) n FROM applications WHERE outcome != 'awaiting' AND last_email_at LIKE ?",
    day,
  );

  const statusCount = (s: string) => count(db, 'SELECT COUNT(*) n FROM jobs WHERE status = ?', s);

  const stageCounts = {
    discovery: discovered,
    normalize: discovered,
    score: count(db, 'SELECT COUNT(*) n FROM jobs WHERE match_score IS NOT NULL'),
    tailor: statusCount('tailored'),
    apply: applied,
    track: responses,
  };

  const lastRun = (db.prepare(
    'SELECT kind, started_at, finished_at, exit_code FROM runs ORDER BY id DESC LIMIT 1',
  ).get() ?? null) as Overview['lastRun'];

  const running = lastRun !== null && lastRun.finished_at === null;

  const order: { key: keyof typeof stageCounts; label: string }[] = [
    { key: 'discovery', label: 'Discovery' },
    { key: 'normalize', label: 'Normalize' },
    { key: 'score', label: 'Score' },
    { key: 'tailor', label: 'Tailor' },
    { key: 'apply', label: 'Apply' },
    { key: 'track', label: 'Track' },
  ];

  // The first stage with no rows behind it is where the pipeline actually got
  // to. Marking it "active" only while a run is live keeps a finished run from
  // looking permanently stuck at its last empty stage.
  const firstEmpty = order.findIndex((s) => stageCounts[s.key] === 0);
  const pipeline: PipelineStep[] = order.map((s, i) => {
    const n = stageCounts[s.key];
    let state: PipelineStep['state'] = 'waiting';
    if (n > 0) state = 'complete';
    if (i === firstEmpty && running) state = 'active';
    return { key: s.key, label: s.label, state, count: n };
  });

  const activity = (db.prepare(
    `SELECT created_at AS at, step, detail FROM agent_events ORDER BY id DESC LIMIT 12`,
  ).all() as { at: string; step: string; detail: string | null }[])
    .map((e) => ({ at: e.at, text: e.detail ? `${e.step}: ${e.detail}` : e.step }));

  const brief: string[] = [];
  if (qualifiedToday > 0) brief.push(`Found ${qualifiedToday} high-quality matches today`);
  const pending = statusCount('held') + statusCount('deferred');
  if (pending > 0) brief.push(`${pending} applications are pending review`);
  if (responsesToday > 0) brief.push(`${responsesToday} responses received from employers`);
  const avg = (db.prepare(
    'SELECT AVG(match_score) a FROM jobs WHERE match_score IS NOT NULL',
  ).get() as { a: number | null }).a;
  if (avg !== null) brief.push(`Average match score is ${Math.round(avg)} out of 100`);
  if (brief.length === 0) brief.push('No pipeline activity recorded yet. Run discovery to begin.');

  return {
    stats: {
      discovered, discoveredToday, qualified, qualifiedToday,
      applied, appliedToday, responses, responsesToday,
    },
    pipeline,
    activity,
    brief,
    lastRun,
  };
}
