import type { Database } from '../../src/db/index.js';

export interface TrackingResponse {
  id: number;
  application_id: number | null;
  company: string | null;
  title: string | null;
  subject: string | null;
  classified_as: string | null;
  confidence: number;
  received_at: string;
}

export interface Tracking {
  stats: { total: number; positive: number; interviews: number; offers: number };
  recent: TrackingResponse[];
}

/** Outcomes that mean the employer engaged in your favour. */
const POSITIVE = ['screening', 'interview', 'offer'];

export function getTracking(db: Database): Tracking {
  const n = (sql: string, ...p: unknown[]) =>
    (db.prepare(sql).get(...p) as { n: number }).n;

  const marks = POSITIVE.map(() => '?').join(', ');

  const stats = {
    total: n("SELECT COUNT(*) n FROM applications WHERE outcome != 'awaiting'"),
    positive: n(`SELECT COUNT(*) n FROM applications WHERE outcome IN (${marks})`, ...POSITIVE),
    interviews: n("SELECT COUNT(*) n FROM applications WHERE outcome = 'interview'"),
    offers: n("SELECT COUNT(*) n FROM applications WHERE outcome = 'offer'"),
  };

  const recent = db.prepare(
    `SELECT e.id, e.application_id, a.company, a.title, e.subject, e.classified_as,
            e.confidence, e.received_at
       FROM email_events e LEFT JOIN applications a ON a.id = e.application_id
      ORDER BY e.received_at DESC, e.id DESC LIMIT 50`,
  ).all() as TrackingResponse[];

  return { stats, recent };
}
