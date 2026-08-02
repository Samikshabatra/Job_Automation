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
 * experience phrase: "<years> preferred/required" (the qualifier must
 * immediately follow "year(s)"), or "for <level> role(s)" (an explicit
 * seniority-level role phrase such as "for senior roles"). Anything else must
 * match a direct experience-domain word (experience, exp, working, industry,
 * professional, hands-on, building, in data/ml/ai/analytics/software).
 */
const EXPERIENCE_CONTEXT =
  /(experience|exp\b|working|industry|professional|hands[- ]on|building|years?\s+(?:preferred|required)|for\s+(?:senior|junior|associate|entry|mid)(?:[\s-]*level)?\s*roles?|in\s+(data|ml|ai|analytics|software))/i;

const FRESHER_SIGNALS = [
  /\bfresher(s)?\b/i,
  /\brecent graduate(s)?\b/i,
  /\bnew grad(uate)?s?\b/i,
  /\bentry[- ]level\b/i,
  /\bcampus hire\b/i,
  /\b\d{4} batch\b/i,
  /\binternship experience\b/i,
  /\bno prior experience\b/i,
];

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
    const context = windowAround(text, m.index ?? 0);
    if (DEGREE.test(context)) continue;
    if (!EXPERIENCE_CONTEXT.test(context)) continue;
    const n = Number(m[group]);
    if (Number.isFinite(n) && n >= 0 && n <= 40) found.push(n);
  }
  return found;
}

export function extractMinYears(jdText: string): number {
  if (!jdText) return 0;
  const text = jdText.toLowerCase();

  if (FRESHER_SIGNALS.some((re) => re.test(text))) return 0;
  if (UPPER_BOUND_ONLY.test(text)) return 0;

  const candidates = [
    ...collect(text, RANGE, 1),
    ...collect(text, MINIMUM, 1),
    ...collect(text, PLUS, 1),
    ...collect(text, BARE, 1),
  ];

  return candidates.length ? Math.min(...candidates) : 0;
}
