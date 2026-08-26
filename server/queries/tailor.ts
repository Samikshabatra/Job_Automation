import type { Database } from '../../src/db/index.js';

export interface TailorRunRow {
  id: number;
  job_id: number;
  company: string | null;
  title: string | null;
  original_json: string;
  tailored_json: string;
  ai_confidence: number | null;
  similarity: number | null;
  verdict: string | null;
  resume_path: string | null;
  created_at: string;
}

export interface TailorSection {
  heading: string;
  original: string[];
  tailored: string[];
  /** Bullets present in the tailored version that were not in the original. */
  added: string[];
}

const SELECT = `
  SELECT t.id, t.job_id, j.company, j.title, t.original_json, t.tailored_json,
         t.ai_confidence, t.similarity, t.verdict, t.resume_path, t.created_at
    FROM tailor_runs t LEFT JOIN jobs j ON j.id = t.job_id`;

export function getLatestTailorRun(db: Database, jobId: number): TailorRunRow | null {
  const row = db.prepare(`${SELECT} WHERE t.job_id = ? ORDER BY t.id DESC LIMIT 1`)
    .get(jobId) as TailorRunRow | undefined;
  return row ?? null;
}

export function listTailorRuns(db: Database, limit = 50): TailorRunRow[] {
  return db.prepare(`${SELECT} ORDER BY t.id DESC LIMIT ?`).all(limit) as TailorRunRow[];
}

interface StoredBullet { id?: unknown; text?: unknown }
interface StoredEntry { id?: unknown; role?: unknown; org?: unknown; bullets?: unknown }

/**
 * Turns a stored before/after pair into the side-by-side the screen renders.
 *
 * One section per experience entry, headed by the role and organisation the
 * bullets belong to -- the question a person has is "what did it do to my
 * Acme bullets", not "what is in the entries key". The two sides are joined on
 * bullet id, because the tailored payload carries only ids and rewritten text.
 *
 * Entries the tailor did not select are left out entirely rather than shown
 * with an empty right-hand column, which would read as "it deleted this job".
 *
 * Tolerant of shape on purpose: these blobs are whatever the tailor wrote at
 * the time, and a schema change later must degrade to "no sections" rather
 * than break the page for every historical run.
 */
export function diffSections(originalJson: string, tailoredJson: string): TailorSection[] {
  const original = safeParse(originalJson);
  const tailored = safeParse(tailoredJson);
  if (!original || !tailored) return [];

  const sourceEntries = asEntries(original.entries);
  const sections: TailorSection[] = [];

  for (const tailoredEntry of asEntries(tailored.entries)) {
    const source = sourceEntries.find((e) => e.id === tailoredEntry.id);
    if (!source) continue;

    const sourceText = new Map<string, string>();
    for (const b of asBullets(source.bullets)) {
      if (b.id) sourceText.set(b.id, b.text);
    }

    const tailoredLines = asBullets(tailoredEntry.bullets).map((b) => b.text);
    // Only the source bullets this pass actually used, in the tailored order,
    // so the two columns line up row for row.
    const originalLines = asBullets(tailoredEntry.bullets)
      .map((b) => (b.id ? sourceText.get(b.id) : undefined))
      .filter((t): t is string => t !== undefined);

    const heading = [source.role, source.org].filter(Boolean).join(' - ') || String(source.id ?? 'Experience');
    const unchanged = new Set(originalLines);

    sections.push({
      heading,
      original: originalLines,
      tailored: tailoredLines,
      added: tailoredLines.filter((l) => !unchanged.has(l)),
    });
  }

  const summary = typeof tailored.summary === 'string' ? tailored.summary.trim() : '';
  if (summary) {
    sections.push({ heading: 'Summary', original: [], tailored: [summary], added: [summary] });
  }

  return sections;
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asEntries(v: unknown): { id?: string; role?: string; org?: string; bullets?: unknown }[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is StoredEntry => Boolean(e) && typeof e === 'object').map((e) => ({
    id: typeof e.id === 'string' ? e.id : undefined,
    role: typeof e.role === 'string' ? e.role : undefined,
    org: typeof e.org === 'string' ? e.org : undefined,
    bullets: e.bullets,
  }));
}

function asBullets(v: unknown): { id?: string; text: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((b): b is StoredBullet => Boolean(b) && typeof b === 'object')
    .map((b) => ({
      id: typeof b.id === 'string' ? b.id : undefined,
      text: typeof b.text === 'string' ? b.text : '',
    }))
    .filter((b) => b.text !== '');
}
