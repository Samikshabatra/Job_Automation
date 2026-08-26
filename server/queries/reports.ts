import type { Database } from '../../src/db/index.js';

export interface Reports {
  rates: { successRate: number; responseRate: number; interviewRate: number; offerRate: number };
  overTime: { date: string; applications: number }[];
  byStatus: { name: string; value: number }[];
  topSkills: { skill: string; pct: number }[];
  bySource: { source: string; discovered: number; qualified: number }[];
}

/**
 * Percentage of `part` out of `whole`, rounded, and 0 when there is nothing to
 * divide by. Every rate on this screen is a ratio over the number of
 * applications, which is zero on a pipeline that has only ever discovered --
 * so the zero case is the normal case, not an edge case, and it must not
 * render as NaN.
 */
function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

export function getReports(db: Database): Reports {
  const n = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;

  const applications = n('SELECT COUNT(*) n FROM applications');
  const responded = n("SELECT COUNT(*) n FROM applications WHERE outcome != 'awaiting'");
  const interviews = n("SELECT COUNT(*) n FROM applications WHERE outcome IN ('interview', 'offer')");
  const offers = n("SELECT COUNT(*) n FROM applications WHERE outcome = 'offer'");
  const positive = n("SELECT COUNT(*) n FROM applications WHERE outcome IN ('screening', 'interview', 'offer')");

  const rates = {
    successRate: pct(positive, applications),
    responseRate: pct(responded, applications),
    interviewRate: pct(interviews, applications),
    offerRate: pct(offers, applications),
  };

  const overTime = db.prepare(
    `SELECT substr(applied_at, 1, 10) date, COUNT(*) applications
       FROM applications GROUP BY date ORDER BY date`,
  ).all() as { date: string; applications: number }[];

  const byStatus = db.prepare(
    `SELECT outcome name, COUNT(*) value FROM applications GROUP BY outcome ORDER BY value DESC`,
  ).all() as { name: string; value: number }[];

  const bySource = db.prepare(
    `SELECT source,
            COUNT(*) discovered,
            SUM(CASE WHEN match_score >= 50 THEN 1 ELSE 0 END) qualified
       FROM jobs GROUP BY source ORDER BY discovered DESC`,
  ).all() as { source: string; discovered: number; qualified: number }[];

  return { rates, overTime, byStatus, topSkills: getTopSkills(db), bySource };
}

/**
 * How often each tracked skill appears in the descriptions of jobs that
 * cleared the score threshold. This is the one chart on the Reports screen
 * with real data before a single application has been sent, so it is worth
 * getting from the JD text rather than leaving as a placeholder.
 */
const TRACKED_SKILLS = [
  'python', 'sql', 'aws', 'kubernetes', 'docker', 'spark', 'airflow',
  'pandas', 'pytorch', 'tensorflow', 'django', 'fastapi', 'react',
  'typescript', 'java', 'postgresql', 'mongodb', 'tableau', 'power bi',
];

export function getTopSkills(db: Database): { skill: string; pct: number }[] {
  const { n: total } = db.prepare(
    'SELECT COUNT(*) n FROM jobs WHERE jd_text IS NOT NULL AND match_score >= 50',
  ).get() as { n: number };
  if (total === 0) return [];

  const stmt = db.prepare(
    `SELECT COUNT(*) n FROM jobs
      WHERE jd_text IS NOT NULL AND match_score >= 50 AND lower(jd_text) LIKE ?`,
  );

  return TRACKED_SKILLS
    .map((skill) => ({ skill, pct: pct((stmt.get(`%${skill}%`) as { n: number }).n, total) }))
    .filter((s) => s.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);
}
