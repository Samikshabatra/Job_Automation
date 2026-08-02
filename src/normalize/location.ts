const ALIASES: Record<string, string[]> = {
  bengaluru: ['bengaluru', 'bangalore', 'blr', 'bangaluru'],
  gurugram: ['gurugram', 'gurgaon'],
  delhi: ['delhi', 'new delhi', 'delhi ncr', 'ncr'],
  noida: ['noida', 'greater noida'],
  hyderabad: ['hyderabad', 'secunderabad'],
  pune: ['pune'],
  mumbai: ['mumbai', 'bombay'],
  chennai: ['chennai', 'madras'],
  remote: ['remote', 'anywhere', 'worldwide', 'work from home', 'wfh', 'remote india', 'fully remote', 'distributed'],
};

const LOOKUP = new Map<string, string>();
for (const [canonical, variants] of Object.entries(ALIASES)) {
  for (const v of variants) LOOKUP.set(v, canonical);
}

function clean(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeLocation(raw: string | null): string {
  if (!raw) return '';
  const cleaned = clean(raw);
  if (!cleaned) return '';
  if (LOOKUP.has(cleaned)) return LOOKUP.get(cleaned)!;
  // Longest alias wins, so "greater noida" is not shadowed by "noida".
  const matches = [...LOOKUP.keys()]
    .filter((alias) => new RegExp(`\\b${alias}\\b`).test(cleaned))
    .sort((a, b) => b.length - a.length);
  return matches.length ? LOOKUP.get(matches[0])! : cleaned;
}

export function isUnknownLocationToken(raw: string | null): boolean {
  if (!raw) return false;
  const cleaned = clean(raw);
  if (!cleaned) return false;
  return ![...LOOKUP.keys()].some((alias) => new RegExp(`\\b${alias}\\b`).test(cleaned));
}
