import type { Database } from 'better-sqlite3';
import { normalizeCompany } from '../normalize/fingerprint.js';

/**
 * Hosts that send on an employer's behalf. Mail from these says nothing about
 * WHICH application it concerns, so a domain match against them must never
 * link anything -- otherwise every Greenhouse notification attaches to
 * whichever Greenhouse application happens to sort first, and outcomes land on
 * the wrong company.
 */
const ATS_SENDER_HOSTS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'myworkday.com',
  'icims.com', 'smartrecruiters.com', 'successfactors.com', 'taleo.net',
  'hire.lever.co', 'us.greenhouse-mail.io', 'greenhouse-mail.io',
];

/** Tokens too generic to identify an employer by themselves. */
const STOP_TOKENS = new Set(['the', 'and', 'group', 'technologies', 'technology',
  'solutions', 'systems', 'services', 'labs', 'india', 'global', 'software']);

const MIN_TOKEN_LENGTH = 3;

/**
 * Identifying words in a company name: lowercased, stripped of legal suffixes
 * by `normalizeCompany`, with generic and very short tokens dropped. "X Corp"
 * yields nothing, which is correct -- it cannot be matched safely.
 */
export function companyTokens(company: string): string[] {
  return normalizeCompany(company)
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOP_TOKENS.has(t));
}

function senderHost(from: string): string {
  const at = from.lastIndexOf('@');
  return (at === -1 ? from : from.slice(at + 1)).toLowerCase().trim().replace(/>$/, '');
}

function isAtsHost(host: string): boolean {
  return ATS_SENDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

interface Candidate { id: number; company: string }

/**
 * Find the application an email belongs to, or null.
 *
 * Two signals, in order of trustworthiness:
 *   1. the sender's domain carrying a company token (careers@phonepe.com), and
 *   2. the company name appearing in the subject -- the only signal available
 *      when the employer sends through an ATS host.
 *
 * Returning null is a valid, common answer. An unlinked email is a logged
 * event; a WRONGLY linked one silently moves another company's application to
 * "rejected", so the tie goes to not guessing.
 */
export function linkEmailToApplication(db: Database, from: string, subject: string): number | null {
  const candidates = db
    .prepare('SELECT id, company FROM applications ORDER BY id')
    .all() as Candidate[];
  if (candidates.length === 0) return null;

  const host = senderHost(from);
  const subjectText = ` ${subject.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')} `;

  if (!isAtsHost(host)) {
    const hostMatches = candidates.filter((c) =>
      companyTokens(c.company).some((t) => host.includes(t)));
    if (hostMatches.length === 1) return hostMatches[0].id;
    // More than one company shares the host token: fall through to the
    // subject rather than pick arbitrarily.
  }

  const subjectMatches = candidates.filter((c) =>
    companyTokens(c.company).some((t) => subjectText.includes(` ${t} `)
      || subjectText.includes(`${t} `) || subjectText.includes(` ${t}`)));
  if (subjectMatches.length === 1) return subjectMatches[0].id;

  return null;
}
