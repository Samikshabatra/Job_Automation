const LEGAL_SUFFIXES = [
  'inc', 'llc', 'ltd', 'limited', 'pvt', 'private', 'corp', 'corporation',
  'co', 'gmbh', 'technologies', 'technology', 'labs', 'software', 'solutions', 'systems',
];

function words(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function candidateSlugs(name: string): string[] {
  const all = words(name);
  const core = all.filter((w) => !LEGAL_SUFFIXES.includes(w));
  const base = core.length ? core : all;

  // Full-name variants come first deliberately. A suffix-stripped guess like
  // "acme" is likelier to collide with an unrelated company that happens to
  // own that board, and a wrong-but-live board means applying to the wrong
  // employer — a worse failure than not resolving at all.
  const candidates = [
    all.join(''),
    all.join('-'),
    base.join(''),
    base.join('-'),
    base[0] ?? '',
    base.slice(0, 2).join(''),
  ];

  return [...new Set(candidates)].filter((s) => s.length > 0);
}
