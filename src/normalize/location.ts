// Only the target *cities* live here. Remote is handled separately below,
// because a bare "remote" and a "Remote - United Kingdom" must not collapse to
// the same token: the first is in scope, the second is a foreign role that
// merely contains the word "remote". Misspellings seen in live board data
// (e.g. "Banglore") are folded in so real matches are not missed.
//
// `india` is a canonical of its own so a JD that names only the country
// ("India", "Mumbai-Lower Parel, India" once the city misses) still lands in
// scope. Longest-alias-wins in `matchCity` keeps it from shadowing a real
// city: "mumbai india" resolves to `mumbai`, not `india`. `` matching means
// "Indiana" and "Indianapolis" never match `india`.
const CITY_ALIASES: Record<string, string[]> = {
  bengaluru: ['bengaluru', 'bangalore', 'blr', 'banglore', 'bangaluru', 'bengalore'],
  gurugram: ['gurugram', 'gurgaon'],
  delhi: ['delhi', 'new delhi', 'delhi ncr', 'ncr'],
  noida: ['noida', 'greater noida'],
  hyderabad: ['hyderabad', 'hyderabad telangana', 'secunderabad', 'hyd'],
  pune: ['pune', 'poona', 'pimpri chinchwad'],
  mumbai: ['mumbai', 'bombay', 'navi mumbai', 'thane', 'lower parel'],
  chennai: ['chennai', 'madras'],
  kolkata: ['kolkata', 'calcutta'],
  ahmedabad: ['ahmedabad', 'gandhinagar'],
  india: ['india', 'bharat'],
};

const CITY_LOOKUP = new Map<string, string>();
for (const [canonical, variants] of Object.entries(CITY_ALIASES)) {
  for (const v of variants) CITY_LOOKUP.set(v, canonical);
}

// A location string is treated as our "remote" only when it is remote AND not
// pinned to a foreign geography. These are the words that make remote acceptable.
const REMOTE_KEYWORDS = ['remote', 'anywhere', 'worldwide', 'work from home', 'wfh', 'distributed'];

// Words left over after stripping the remote keywords that still keep the role
// in scope: India signals, plus harmless qualifiers. Anything NOT in here (e.g.
// "united kingdom", "us", "emea") marks the remote role as foreign.
const INDIA_SIGNALS = new Set(['india', 'in', 'bharat', ...CITY_LOOKUP.keys()]);
const REMOTE_NOISE = new Set([
  'fully', 'only', 'based', 'first', 'friendly', 'position', 'role', 'job',
  'opportunity', 'global', 'hybrid', 'or', 'and',
]);

function clean(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(haystack);
}

/**
 * True when a remote string carries no foreign geography — i.e. everything left
 * after removing the remote keywords is an India signal or harmless noise.
 */
function isInScopeRemote(cleaned: string): boolean {
  let rest = cleaned;
  for (const kw of REMOTE_KEYWORDS) rest = rest.replace(new RegExp(`\\b${kw}\\b`, 'g'), ' ');
  const leftover = rest.split(/\s+/).filter(Boolean);
  return leftover.every((w) => INDIA_SIGNALS.has(w) || REMOTE_NOISE.has(w));
}

function matchCity(cleaned: string): string | null {
  if (CITY_LOOKUP.has(cleaned)) return CITY_LOOKUP.get(cleaned)!;
  // Longest alias wins, so "greater noida" is not shadowed by "noida".
  const matches = [...CITY_LOOKUP.keys()]
    .filter((alias) => hasWord(cleaned, alias))
    .sort((a, b) => b.length - a.length);
  return matches.length ? CITY_LOOKUP.get(matches[0])! : null;
}

export function normalizeLocation(raw: string | null): string {
  if (!raw) return '';
  const cleaned = clean(raw);
  if (!cleaned) return '';

  const isRemote = REMOTE_KEYWORDS.some((kw) => hasWord(cleaned, kw));
  if (isRemote && isInScopeRemote(cleaned)) return 'remote';

  // Not (in-scope) remote: fall back to city matching. A foreign-remote string
  // reaches here and matches no city, so it is returned as its cleaned raw form
  // and the location filter rejects it.
  return matchCity(cleaned) ?? cleaned;
}

/** True when a location maps to none of the target canonicals. */
export function isUnknownLocationToken(raw: string | null): boolean {
  if (!raw) return false;
  const cleaned = clean(raw);
  if (!cleaned) return false;
  const normalized = normalizeLocation(raw);
  return normalized !== 'remote' && !CITY_LOOKUP.has(normalized)
    && !Object.keys(CITY_ALIASES).includes(normalized);
}
