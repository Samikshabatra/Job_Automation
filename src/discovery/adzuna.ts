import { fetchJson } from '../sources/http.js';
import type { DiscoverySource, DiscoveryResult } from './types.js';
import type { DiscoveryHit } from './register.js';
import type { Criteria } from '../config/schema.js';

interface AdzunaResult {
  title: string;
  company?: { display_name?: string };
  redirect_url: string;
}

const MAX_DAYS_OLD = 7;

export const adzunaSource: DiscoverySource = {
  name: 'adzuna',

  async search(queries: string[], criteria: Criteria): Promise<DiscoveryResult> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    if (!appId || !appKey) {
      return { hits: [], ok: false, error: 'ADZUNA_APP_ID / ADZUNA_APP_KEY not set' };
    }

    const hits: DiscoveryHit[] = [];
    try {
      for (const query of queries) {
        const url = new URL('https://api.adzuna.com/v1/api/jobs/in/search/1');
        url.searchParams.set('app_id', appId);
        url.searchParams.set('app_key', appKey);
        url.searchParams.set('what', query);
        url.searchParams.set('results_per_page', '50');
        url.searchParams.set('max_days_old', String(Math.min(MAX_DAYS_OLD, criteria.freshness.max_posted_age_days)));
        url.searchParams.set('content-type', 'application/json');

        const body = (await fetchJson(url.toString())) as { results?: AdzunaResult[] };
        for (const r of body.results ?? []) {
          // Unparseable URLs are kept: registerDiscovered decides what is
          // usable, and the raw count is what the run report needs.
          if (typeof r.redirect_url !== 'string' || !r.redirect_url) continue;
          hits.push({
            applyUrl: r.redirect_url,
            company: r.company?.display_name ?? 'Unknown',
            via: 'adzuna',
          });
        }
      }
      return { hits, ok: true };
    } catch (err) {
      return { hits: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
