export type SkillDict = Record<string, string[]>;

const FRESHER_SIGNALS = [
  /\bfresher(s)?\b/i,
  /\bentry[- ]level\b/i,
  /\bnew grad(uate)?s?\b/i,
  /\brecent graduate(s)?\b/i,
  /\bcampus hire\b/i,
  /\b\d{4} batch\b/i,
  /\b0\s*(?:-|–|to)\s*[12]\s*(years?|yrs?)/i,
  /\binternship experience\b/i,
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
  return FRESHER_SIGNALS.some((re) => re.test(jdText));
}
