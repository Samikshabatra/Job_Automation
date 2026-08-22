const ABBREVIATIONS: [RegExp, string][] = [
  [/\bai\/ml\b/g, 'ai machine learning'],
  [/\bml\b/g, 'machine learning'],
  [/\bnlp\b/g, 'natural language processing'],
  [/\bsde\b/g, 'software engineer'],
  [/\bswe\b/g, 'software engineer'],
  [/\bsr\b/g, 'senior'],
  [/\bjr\b/g, 'junior'],
  [/\bmle\b/g, 'machine learning engineer'],
  [/\bds\b/g, 'data scientist'],
];

// Only the location keyword(s) themselves are stripped, plus any directly
// chained keyword/qualifier (e.g. "- Bengaluru, India"). Anything else after
// the separator (e.g. "- US Enterprise") is a differentiator, not a location,
// and must survive.
const LOCATION_KEYWORDS =
  'remote|hybrid|onsite|on-site|india|bengaluru|bangalore|delhi|gurgaon|gurugram|noida|'
  + 'hyderabad|secunderabad|pune|mumbai|bombay|chennai|kolkata|ahmedabad|'
  + 'anywhere|worldwide|us|usa|emea|apac';

const LOCATION_SUFFIX = new RegExp(
  `\\s*[-–—,|]\\s*(?:${LOCATION_KEYWORDS})\\b(?:\\s*[-–—,|]\\s*(?:${LOCATION_KEYWORDS})\\b)*\\s*$`,
  'i',
);

export function normalizeTitle(raw: string): string {
  let t = raw.toLowerCase();
  t = t.replace(/\([^)]*\)/g, ' ');          // (Bengaluru)
  t = t.replace(/\[[^\]]*\]/g, ' ');          // [REQ-12345]
  t = t.replace(LOCATION_SUFFIX, ' ');
  t = t.replace(/\./g, ' ');
  for (const [pattern, replacement] of ABBREVIATIONS) t = t.replace(pattern, replacement);
  t = t.replace(/[^a-z0-9+#\s]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Dice coefficient over character bigrams of the normalized titles. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  if (A.size === 0 || B.size === 0) return 0;
  let overlap = 0;
  for (const g of A) if (B.has(g)) overlap++;
  return (2 * overlap) / (A.size + B.size);
}
