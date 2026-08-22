import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { openDb } from '../db/index.js';
import { syncInbox, type InboxEmail } from '../track/inbox.js';
import { fetchRecentEmails, GmailAuthError } from '../track/gmail.js';
import type { Outcome } from '../track/classify.js';
import { writeTracker } from '../track/excel.js';
import { trackerPath } from './track.js';

const VALID: Outcome[] = ['rejected', 'interview', 'screening', 'acknowledged'];

/**
 * Last-resort classifier for the handful of emails the rules abstain on.
 * Deliberately tiny: subject plus the first 800 characters, because the
 * signal in a recruiting email is always near the top and the roadmap's whole
 * cost argument rests on not shipping full bodies to an LLM.
 */
export function buildClassifyPrompt(email: InboxEmail): string {
  return `Classify this recruiting email into exactly one of:
rejected, interview, screening, acknowledged, none

"none" means it is not about a job application at all.
Answer with the single word and nothing else.

Subject: ${email.subject}
From: ${email.from}
Body: ${email.body.slice(0, 800)}`;
}

export function parseOutcome(reply: string): Outcome | null {
  const word = reply.trim().toLowerCase().replace(/[^a-z]/g, '');
  return (VALID as string[]).includes(word) ? (word as Outcome) : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('dotenv/config');
  const { tailor } = await import('../tailor/llm.js');
  void tailor; // keeps the Gemini module resolution identical to the daily run

  const sinceDays = Number(process.argv[2] ?? 7);
  const db = openDb();

  try {
    const summary = await syncInbox(db, {
      fetchEmails: () => fetchRecentEmails(sinceDays),
      classifyWithLlm: async (email) => {
        const { callGeminiText } = await import('../track/llm.js');
        return parseOutcome(await callGeminiText(buildClassifyPrompt(email)));
      },
      now: new Date(),
    });

    console.log(
      `fetched=${summary.fetched} new=${summary.fetched - summary.skippedAlreadySeen} `
      + `linked=${summary.linked} unlinked=${summary.unlinked}\n`
      + `rules=${summary.classifiedByRule} llm=${summary.classifiedByLlm} `
      + `unclassified=${summary.unclassified} ghosted=${summary.ghosted}`,
    );

    const archiveDir = join(homedir(), 'job-applications');
    const path = trackerPath(archiveDir);
    await writeTracker(db, path);
    console.log(`Tracker written to ${path}`);
  } catch (err) {
    if (err instanceof GmailAuthError) {
      console.error(`\nGmail is not set up yet:\n  ${err.message}\n`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    db.close();
  }
}
