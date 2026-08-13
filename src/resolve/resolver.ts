import type { Database } from 'better-sqlite3';
import type { AtsPlatform, CompanyEntry } from '../config/schema.js';
import { boardExists, upsertBoard } from '../db/boards.js';
import { candidateSlugs } from './slug.js';

export type Probe = (ats: AtsPlatform, token: string) => Promise<boolean>;

export interface Resolution {
  name: string;
  ats: AtsPlatform | null;
  token: string | null;
}

const PLATFORMS: AtsPlatform[] = ['greenhouse', 'lever', 'ashby', 'workable'];

const PROBE_URLS: Record<AtsPlatform, (token: string) => string> = {
  greenhouse: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
  lever: (t) => `https://api.lever.co/v0/postings/${t}?mode=json&limit=1`,
  ashby: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
  workable: (t) => `https://${t}.workable.com/spi/v3/jobs`,
};

/** A board exists if the endpoint answers 2xx. Network errors count as "not found". */
async function httpProbe(ats: AtsPlatform, token: string): Promise<boolean> {
  try {
    const res = await fetch(PROBE_URLS[ats](encodeURIComponent(token)), {
      headers: { accept: 'application/json', 'user-agent': 'job-pipeline/1.0' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveCompany(
  name: string, deps: { probe?: Probe } = {},
): Promise<Resolution> {
  const probe = deps.probe ?? httpProbe;
  for (const token of candidateSlugs(name)) {
    for (const ats of PLATFORMS) {
      if (await probe(ats, token)) return { name, ats, token };
    }
  }
  return { name, ats: null, token: null };
}

export async function resolveAll(
  db: Database,
  entries: CompanyEntry[],
  deps: { probe?: Probe } = {},
): Promise<{ resolved: Resolution[]; unresolved: string[] }> {
  const resolved: Resolution[] = [];
  const unresolved: string[] = [];

  for (const entry of entries) {
    if (entry.paused) continue;

    if (entry.ats && entry.token) {
      upsertBoard(db, {
        atsPlatform: entry.ats, boardToken: entry.token,
        companyName: entry.name, discoveredVia: 'companies.yaml',
      });
      resolved.push({ name: entry.name, ats: entry.ats, token: entry.token });
      continue;
    }

    // Already-known boards short-circuit the probe entirely, so a steady
    // company list costs no network calls on subsequent runs.
    const already = PLATFORMS
      .flatMap((ats) => candidateSlugs(entry.name).map((token) => ({ ats, token })))
      .find(({ ats, token }) => boardExists(db, ats, token));
    if (already) {
      resolved.push({ name: entry.name, ats: already.ats, token: already.token });
      continue;
    }

    const resolution = await resolveCompany(entry.name, deps);
    if (resolution.ats && resolution.token) {
      upsertBoard(db, {
        atsPlatform: resolution.ats, boardToken: resolution.token,
        companyName: entry.name, discoveredVia: 'companies.yaml',
      });
      resolved.push(resolution);
    } else {
      unresolved.push(entry.name);
    }
  }

  return { resolved, unresolved };
}
