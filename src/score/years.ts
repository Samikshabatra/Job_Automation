// Fresher-signal patterns are shared with `src/score/extract.ts` (canonical
// list: `FRESHER_SIGNAL_PATTERNS`) so this hard-filter gate and the scoring
// fresher bonus never disagree about what counts as a fresher-facing JD.
import { FRESHER_SIGNAL_PATTERNS } from './extract.js';

/**
 * Context the gate requires before a bare number-of-years match counts as an
 * experience requirement.
 *
 * Bare words like "role", "required", and "preferred" are deliberately NOT
 * accepted on their own — they are among the most common words in any job
 * posting and a ±60-char window is not sentence-aware, so accepting them bare
 * leaked false positives across clause boundaries, e.g.
 * "This role was created 3 years ago." or
 * "Relocation is preferred within 2 years of joining."
 *
 * Instead, those qualifiers only count when anchored directly onto the
 * experience phrase, in either order:
 *   - AFTER the number: "<years> preferred/required" (the qualifier must
 *     immediately follow "year(s)"), or "for <level> role(s)" (an explicit
 *     seniority-level role phrase such as "for senior roles").
 *   - BEFORE the number: "required/require/requires/requiring/preferred/
 *     prefer/must have/should have/minimum (of)/at least <N> years" — real
 *     postings phrase requirements this way at least as often ("Required:
 *     3 years of Python"). The qualifier and the number may only be
 *     separated by whitespace, a colon, or a hyphen (`[\s:-]*`) — never
 *     another word — so "preferred within 2 years" (an intervening word,
 *     "within") still correctly fails to anchor and stays unmatched.
 *
 *     NOTE: "with" and "brings" were tried here and withdrawn — they attach
 *     to any noun ("startup with 5 years of history", "brings 3 years of
 *     runway"), not specifically to a candidate's experience, and produced
 *     false positives on company/funding/product blurbs. Only qualifiers
 *     that unambiguously introduce a *candidate* requirement are listed.
 * Anything else must match a direct experience-domain word (experience, exp,
 * working, industry, professional, hands-on, building,
 * in data/ml/ai/analytics/software).
 *
 * Even after this gate passes, `collect()` applies one more check —
 * `NEGATIVE_NOUN` — because qualifiers like "requires" and "minimum of" are
 * also legitimately used for non-experience requirements ("requires 2 years
 * of exclusivity", "minimum of 2 years lease"). See `NEGATIVE_NOUN` below.
 */
const EXPERIENCE_CONTEXT =
  /(experience|exp\b|working|industry|professional|hands[- ]on|building|years?\s+(?:preferred|required)|for\s+(?:senior|junior|associate|entry|mid)(?:[\s-]*level)?\s*roles?|\b(?:required?|requiring|requires|preferred|prefer|must\s+have|should\s+have|minimum(?:\s+of)?|at\s+least)[\s:-]*\d|in\s+(data|ml|ai|analytics|software))/i;

/**
 * Non-experience nouns that a "requires"/"minimum of"-style qualifier can
 * legitimately attach to instead of a candidate's years of experience
 * ("The contract requires 2 years of exclusivity", "Minimum of 2 years lease
 * commitment"). If one of these immediately follows the matched years
 * phrase, the match is discarded regardless of how EXPERIENCE_CONTEXT was
 * satisfied.
 */
const NEGATIVE_NOUN =
  /\b(history|runway|traction|lease|exclusivity|contract|tenure|notice\s+period|funding|operation|existence|warranty|validity)\b/i;

function windowAfter(text: string, index: number, radius = 25): string {
  return text.slice(index, Math.min(text.length, index + radius));
}

/** "up to 2 years", "less than 2 years" — an upper bound, so the minimum is 0. */
const UPPER_BOUND_ONLY = /\b(up to|less than|under|fewer than|maximum(?: of)?|max)\s+\d+\s*(\+)?\s*(years?|yrs?)/i;

const RANGE = /\b(\d{1,2})\s*(?:-|–|—|\s+to\s+)\s*(\d{1,2})\s*(?:\+)?\s*(years?|yrs?)/gi;
const MINIMUM = /\b(?:minimum(?:\s+of)?|at least|min\.?)\s+(\d{1,2})\s*(?:\+)?\s*(years?|yrs?)/gi;
const PLUS = /\b(\d{1,2})\s*\+\s*(years?|yrs?)/gi;
const BARE = /\b(\d{1,2})\s*(years?|yrs?)\b/gi;

const DEGREE = /\b\d{1,2}[\s-]*year[\s-]*(degree|program|course|b\.?tech|bachelor)/i;

function windowAround(text: string, index: number, radius = 60): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
}

function collect(text: string, pattern: RegExp, group: number): number[] {
  const found: number[] = [];
  pattern.lastIndex = 0;
  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const context = windowAround(text, start);
    if (DEGREE.test(context)) continue;
    if (!EXPERIENCE_CONTEXT.test(context)) continue;
    if (NEGATIVE_NOUN.test(windowAfter(text, end))) continue;
    const n = Number(m[group]);
    if (Number.isFinite(n) && n >= 0 && n <= 40) found.push(n);
  }
  return found;
}

export function extractMinYears(jdText: string): number {
  if (!jdText) return 0;
  const text = jdText.toLowerCase();

  if (FRESHER_SIGNAL_PATTERNS.some((re) => re.test(text))) return 0;
  if (UPPER_BOUND_ONLY.test(text)) return 0;

  const candidates = [
    ...collect(text, RANGE, 1),
    ...collect(text, MINIMUM, 1),
    ...collect(text, PLUS, 1),
    ...collect(text, BARE, 1),
  ];

  return candidates.length ? Math.min(...candidates) : 0;
}
