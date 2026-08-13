import { fetchJson } from '../sources/http.js';
import type { DiscoverySource, DiscoveryResult } from './types.js';
import type { DiscoveryHit } from './register.js';
import type { Criteria } from '../config/schema.js';

interface RemotiveJob {
  title: string;
  company_name: string;
  url: string;
}

export const remotiveSource: DiscoverySource = {
  name: 'remotive',

  async search(queries: string[], _criteria: Criteria): Promise<DiscoveryResult> {
    const hits: DiscoveryHit[] = [];
    try {
      for (const query of queries) {
        const url = new URL('https://remotive.com/api/remote-jobs');
        url.searchParams.set('search', query);
        url.searchParams.set('limit', '50');

        const body = (await fetchJson(url.toString())) as { jobs?: RemotiveJob[] };
        for (const job of body.jobs ?? []) {
          if (typeof job.url !== 'string' || !job.url) continue;
          hits.push({ applyUrl: job.url, company: job.company_name ?? 'Unknown', via: 'remotive' });
        }
      }
      return { hits, ok: true };
    } catch (err) {
      return { hits: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
