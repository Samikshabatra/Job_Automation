import type { ExperienceEntry } from './resume.js';
import type { TailorResponse } from './llm.js';

const SIMILARITY_FLOOR = 0.6;

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection++;
  return intersection / (A.size + B.size - intersection);
}

/** Every number in the text, so an inflated metric can be caught. */
function numbers(s: string): string[] {
  return (s.match(/\d+(?:\.\d+)?\s*[kmb%]?/gi) ?? []).map((n) => n.toLowerCase().replace(/\s+/g, ''));
}

export function verifyNoFabrication(
  res: TailorResponse, source: ExperienceEntry[],
): { ok: boolean; offending: string[] } {
  const entryById = new Map(source.map((e) => [e.id, e]));
  const offending: string[] = [];

  for (const entry of res.entries) {
    const sourceEntry = entryById.get(entry.id);
    if (!sourceEntry) {
      offending.push(`unknown entry id "${entry.id}"`);
      continue;
    }
    const bulletById = new Map(sourceEntry.bullets.map((b) => [b.id, b]));

    for (const bullet of entry.bullets) {
      const sourceBullet = bulletById.get(bullet.id);
      if (!sourceBullet) {
        offending.push(`unknown bullet id "${bullet.id}"`);
        continue;
      }
      if (jaccard(bullet.text, sourceBullet.text) < SIMILARITY_FLOOR) {
        offending.push(bullet.text);
        continue;
      }
      const sourceNumbers = new Set(numbers(sourceBullet.text));
      const invented = numbers(bullet.text).filter((n) => !sourceNumbers.has(n));
      if (invented.length) {
        offending.push(`${bullet.text} (invented figures: ${invented.join(', ')})`);
      }
    }
  }

  return { ok: offending.length === 0, offending };
}
