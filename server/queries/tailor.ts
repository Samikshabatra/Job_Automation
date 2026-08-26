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

/**
 * Turns a stored before/after pair into the side-by-side the screen renders.
 *
 * Tolerant of shape on purpose: these blobs are whatever the tailor wrote at
 * the time, and a schema change six months from now must degrade to "no
 * sections" rather than break the page for every historical run.
 */
export function diffSections(originalJson: string, tailoredJson: string): TailorSection[] {
  const original = safeParse(originalJson);
  const tailored = safeParse(tailoredJson);
  if (!original || !tailored) return [];

  const headings = new Set([...Object.keys(original), ...Object.keys(tailored)]);
  const sections: TailorSection[] = [];

  for (const heading of headings) {
    const o = toLines(original[heading]);
    const t = toLines(tailored[heading]);
    if (o.length === 0 && t.length === 0) continue;
    const before = new Set(o);
    sections.push({ heading, original: o, tailored: t, added: t.filter((l) => !before.has(l)) });
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

function toLines(v: unknown): string[] {
  if (typeof v === 'string') return v.split(/\r?\n/).filter(Boolean);
  if (Array.isArray(v)) {
    return v.flatMap((item) => {
      if (typeof item === 'string') return [item];
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const bullets = Array.isArray(o.bullets) ? (o.bullets as unknown[]).map(String) : [];
        const label = [o.title, o.company, o.role, o.name].filter(Boolean).join(' - ');
        return label ? [label, ...bullets] : bullets;
      }
      return [];
    });
  }
  return [];
}
