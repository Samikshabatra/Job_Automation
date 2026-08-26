import type { Database } from 'better-sqlite3';
import { classifyEmail, type Outcome } from './classify.js';
import { linkEmailToApplication } from './link.js';
import { recordEmailEvent, applyOutcome } from './events.js';

export interface InboxEmail {
  id: string;
  threadId: string | null;
  receivedAt: string;
  from: string;
  subject: string;
  body: string;
}

export interface InboxDeps {
  fetchEmails: () => Promise<InboxEmail[]>;
  /** Called ONLY for emails the rules could not classify. */
  classifyWithLlm?: (email: InboxEmail) => Promise<Outcome | null>;
  now: Date;
  ghostAfterDays?: number;
}

export interface InboxSummary {
  fetched: number;
  skippedAlreadySeen: number;
  linked: number;
  unlinked: number;
  classifiedByRule: number;
  classifiedByLlm: number;
  unclassified: number;
  ghosted: number;
}

const DAY_MS = 86_400_000;
const DEFAULT_GHOST_AFTER_DAYS = 21;

/** Outcomes that mean the employer has actually engaged. */
const ENGAGED = new Set(['acknowledged', 'screening', 'interview', 'offer', 'rejected']);

const LLM_CONFIDENCE = 0.6;

/**
 * Pull recruiting mail, attach it to applications, and move outcomes.
 *
 * Cost discipline is structural, not incidental: `classifyWithLlm` is reached
 * only when `classifyEmail` abstains, so the ordinary inbox costs nothing.
 * The roadmap budgets ~5 calls a day and the rules are written to hit ~80%.
 */
export async function syncInbox(db: Database, deps: InboxDeps): Promise<InboxSummary> {
  const s: InboxSummary = {
    fetched: 0, skippedAlreadySeen: 0, linked: 0, unlinked: 0,
    classifiedByRule: 0, classifiedByLlm: 0, unclassified: 0, ghosted: 0,
  };

  const emails = await deps.fetchEmails();
  s.fetched = emails.length;

  for (const email of emails) {
    const applicationId = linkEmailToApplication(db, email.from, email.subject);

    let outcome: Outcome | null = null;
    let confidence = 0;

    const ruled = classifyEmail({ subject: email.subject, body: email.body });
    if (ruled.outcome) {
      outcome = ruled.outcome;
      confidence = ruled.confidence;
      s.classifiedByRule++;
    } else if (deps.classifyWithLlm) {
      try {
        outcome = await deps.classifyWithLlm(email);
        if (outcome) {
          confidence = LLM_CONFIDENCE;
          s.classifiedByLlm++;
        }
      } catch {
        // A quota error or a malformed reply must not lose the email. It is
        // still recorded, just unclassified, and a later run can revisit it.
        outcome = null;
      }
    }
    if (!outcome) s.unclassified++;

    const stored = recordEmailEvent(db, {
      gmailMsgId: email.id,
      threadId: email.threadId,
      receivedAt: email.receivedAt,
      fromAddress: email.from,
      subject: email.subject,
      applicationId,
      classifiedAs: outcome,
      confidence,
    });

    // Already recorded on an earlier, overlapping poll: counting it again
    // would inflate the summary and re-apply an outcome we already applied.
    if (stored === null) {
      s.skippedAlreadySeen++;
      if (outcome) {
        if (ruled.outcome) s.classifiedByRule--; else s.classifiedByLlm--;
      } else {
        s.unclassified--;
      }
      continue;
    }

    if (applicationId === null) {
      s.unlinked++;
      continue;
    }
    s.linked++;
    if (outcome) applyOutcome(db, applicationId, outcome, email.receivedAt);
  }

  s.ghosted = markGhosted(db, deps.now, deps.ghostAfterDays ?? DEFAULT_GHOST_AFTER_DAYS);
  return s;
}

/**
 * Flag applications that have gone silent. Only ever touches rows still
 * sitting at `awaiting`: an application the employer has actually engaged with
 * is not ghosted, whatever the calendar says.
 */
function markGhosted(db: Database, now: Date, afterDays: number): number {
  const rows = db.prepare(
    "SELECT id, applied_at, last_email_at, outcome FROM applications WHERE outcome = 'awaiting'",
  ).all() as { id: number; applied_at: string; last_email_at: string | null; outcome: string }[];

  let count = 0;
  for (const row of rows) {
    if (ENGAGED.has(row.outcome)) continue;
    const since = new Date(row.last_email_at ?? row.applied_at);
    if (Number.isNaN(since.getTime())) continue;
    if ((now.getTime() - since.getTime()) / DAY_MS < afterDays) continue;
    db.prepare("UPDATE applications SET outcome = 'ghosted' WHERE id = ?").run(row.id);
    count++;
  }
  return count;
}
