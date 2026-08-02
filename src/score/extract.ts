export type SkillDict = Record<string, string[]>;

/**
 * Canonical fresher-signal patterns, shared with `src/score/years.ts` so the
 * hard-filter years gate and the scoring fresher bonus never disagree about
 * what counts as a fresher-facing JD. This is the UNION of the two lists that
 * previously diverged (extract.ts had the "0-2 years" numeric pattern;
 * years.ts had "no prior experience") — do not drop either half when editing.
 * `years.ts` imports this array rather than keeping its own copy.
 */
export const FRESHER_SIGNAL_PATTERNS = [
  /\bfresher(s)?\b/i,
  /\bentry[- ]level\b/i,
  /\bnew grad(uate)?s?\b/i,
  /\brecent graduate(s)?\b/i,
  /\bcampus hire\b/i,
  /\b\d{4} batch\b/i,
  /\b0\s*(?:-|–|to)\s*[12]\s*(years?|yrs?)/i,
  /\binternship experience\b/i,
  /\bno prior experience\b/i,
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractSkills(jdText: string, dict: SkillDict): string[] {
  if (!jdText) return [];
  const text = jdText.toLowerCase();
  const found = new Set<string>();

  for (const [canonical, aliases] of Object.entries(dict)) {
    for (const alias of [canonical, ...aliases]) {
      const re = new RegExp(`(?<![a-z0-9])${escapeRegex(alias.toLowerCase())}(?![a-z0-9])`);
      if (re.test(text)) {
        found.add(canonical);
        break;
      }
    }
  }
  return [...found];
}

export function hasFresherSignal(jdText: string): boolean {
  return FRESHER_SIGNAL_PATTERNS.some((re) => re.test(jdText));
}
