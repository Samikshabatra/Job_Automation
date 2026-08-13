import type { Database } from 'better-sqlite3';
import { boardExists, upsertBoard } from '../db/boards.js';
import { parseApplyUrl } from './urlparse.js';

export interface DiscoveryHit {
  applyUrl: string;
  company: string;
  via: string;
}

export function registerDiscovered(
  db: Database, hits: DiscoveryHit[],
): { registered: number; skipped: number } {
  let registered = 0;
  let skipped = 0;

  for (const hit of hits) {
    const parsed = parseApplyUrl(hit.applyUrl);
    if (!parsed) {
      skipped++;
      continue;
    }
    if (boardExists(db, parsed.ats, parsed.token)) continue;

    upsertBoard(db, {
      atsPlatform: parsed.ats,
      boardToken: parsed.token,
      companyName: hit.company,
      discoveredVia: hit.via,
    });
    registered++;
  }

  return { registered, skipped };
}
