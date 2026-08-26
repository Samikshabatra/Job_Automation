import type { Database } from 'better-sqlite3';

export interface NewEmailEvent {
  gmailMsgId: string;
  threadId: string | null;
  receivedAt: string;
  fromAddress: string;
  subject: string;
  applicationId: number | null;
  classifiedAs: string | null;
  confidence: number;
}

/**
 * How far along the pipeline each outcome sits. Used to stop a later email
 * dragging an application BACKWARDS: the automated "we have received your
 * application" frequently arrives after a human has already sent an interview
 * invitation, and letting it overwrite would erase the good news.
 *
 * `rejected` deliberately outranks everything reachable before it -- a
 * rejection is final and must always be allowed to land.
 */
export const OUTCOME_RANK: Record<string, number> = {
  awaiting: 0,
  acknowledged: 1,
  screening: 2,
  interview: 3,
  offer: 4,
  rejected: 5,
  ghosted: 0,
};

function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return (at === -1 ? '' : address.slice(at + 1)).toLowerCase().trim().replace(/>$/, '');
}

/**
 * Store one email. Returns its row id, or null when the message was already
 * recorded -- Gmail is polled on a rolling window, so the same message WILL be
 * fetched again and re-inserting it would double-count the inbox.
 */
export function recordEmailEvent(db: Database, e: NewEmailEvent): number | null {
  try {
    const info = db.prepare(
      `INSERT INTO email_events (application_id, gmail_msg_id, thread_id, received_at,
         from_address, from_domain, subject, classified_as, confidence, created_at)
       VALUES (@applicationId, @gmailMsgId, @threadId, @receivedAt,
         @fromAddress, @fromDomain, @subject, @classifiedAs, @confidence, @createdAt)`,
    ).run({ ...e, fromDomain: domainOf(e.fromAddress), createdAt: new Date().toISOString() });
    return Number(info.lastInsertRowid);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('email_events.gmail_msg_id')) return null;
    throw err;
  }
}

/**
 * Move an application to `outcome`, unless it is already further along.
 * `last_email_at` advances either way: the mail did arrive, whatever it said.
 */
export function applyOutcome(db: Database, applicationId: number, outcome: string, receivedAt: string): void {
  const row = db.prepare('SELECT outcome FROM applications WHERE id = ?')
    .get(applicationId) as { outcome: string } | undefined;
  if (!row) return;

  const current = OUTCOME_RANK[row.outcome] ?? 0;
  const next = OUTCOME_RANK[outcome] ?? 0;
  if (next > current) {
    db.prepare('UPDATE applications SET outcome = ?, last_email_at = ? WHERE id = ?')
      .run(outcome, receivedAt, applicationId);
  } else {
    db.prepare('UPDATE applications SET last_email_at = ? WHERE id = ?')
      .run(receivedAt, applicationId);
  }
}

/** Subject of the most recent email on an application, for the tracker. */
export function latestSubjectFor(db: Database, applicationId: number): string | null {
  const row = db.prepare(
    `SELECT subject FROM email_events WHERE application_id = ?
      ORDER BY received_at DESC, id DESC LIMIT 1`,
  ).get(applicationId) as { subject: string | null } | undefined;
  return row?.subject ?? null;
}
