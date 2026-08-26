import type { Database } from '../../src/db/index.js';

export interface AgentEvent {
  id: number;
  run_id: number | null;
  job_id: number | null;
  company: string | null;
  title: string | null;
  step: string;
  detail: string | null;
  confidence: number | null;
  created_at: string;
}

export interface AgentSnapshot {
  stats: {
    successRate: number;
    applicationsToday: number;
    avgSecondsPerApp: number | null;
    totalRuns: number;
  };
  current: { job_id: number | null; company: string | null; step: string; detail: string | null } | null;
  recent: AgentEvent[];
  runs: { id: number; kind: string; started_at: string; finished_at: string | null; exit_code: number | null; dry_run: number }[];
}

const EVENT_SELECT = `
  SELECT e.id, e.run_id, e.job_id, j.company, j.title, e.step, e.detail, e.confidence, e.created_at
    FROM agent_events e LEFT JOIN jobs j ON j.id = e.job_id`;

export function getAgentSnapshot(db: Database): AgentSnapshot {
  const n = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  const today = `${new Date().toISOString().slice(0, 10)}%`;

  const agentRuns = n("SELECT COUNT(*) n FROM runs WHERE kind = 'agent'");
  const cleanRuns = n("SELECT COUNT(*) n FROM runs WHERE kind = 'agent' AND exit_code = 0");

  // Average wall-clock seconds per submitted application, over finished agent
  // runs. Null rather than zero when nothing has finished: "0 min per app" reads
  // as a suspiciously fast agent, not as an absence of data.
  const avgRow = db.prepare(
    `SELECT AVG(seconds) a FROM (
       SELECT (julianday(finished_at) - julianday(started_at)) * 86400 AS seconds
         FROM runs WHERE kind = 'agent' AND finished_at IS NOT NULL)`,
  ).get() as { a: number | null };

  const recent = db.prepare(`${EVENT_SELECT} ORDER BY e.id DESC LIMIT 30`).all() as AgentEvent[];

  const live = db.prepare(
    `${EVENT_SELECT}
      WHERE e.run_id = (SELECT id FROM runs WHERE kind = 'agent' AND finished_at IS NULL ORDER BY id DESC LIMIT 1)
      ORDER BY e.id DESC LIMIT 1`,
  ).get() as AgentEvent | undefined;

  const runs = db.prepare(
    'SELECT id, kind, started_at, finished_at, exit_code, dry_run FROM runs ORDER BY id DESC LIMIT 20',
  ).all() as AgentSnapshot['runs'];

  return {
    stats: {
      successRate: agentRuns === 0 ? 0 : Math.round((cleanRuns / agentRuns) * 100),
      applicationsToday: n('SELECT COUNT(*) n FROM applications WHERE applied_at LIKE ?', today),
      avgSecondsPerApp: avgRow.a === null ? null : Math.round(avgRow.a),
      totalRuns: agentRuns,
    },
    current: live
      ? { job_id: live.job_id, company: live.company, step: live.step, detail: live.detail }
      : null,
    recent,
    runs,
  };
}
