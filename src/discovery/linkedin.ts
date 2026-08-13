import { fetchText } from '../sources/http.js';
import type { DiscoverySource, DiscoveryResult } from './types.js';
import type { DiscoveryHit } from './register.js';
import type { Criteria } from '../config/schema.js';

const LINK_RE = /<a[^>]+class="[^"]*base-card__full-link[^"]*"[^>]+href="([^"]+)"/g;
const COMPANY_RE = /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>\s*<a[^>]*>([^<]+)</g;

const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const linkedinSource: DiscoverySource = {
  name: 'linkedin-guest',

  async search(queries: string[], criteria: Criteria): Promise<DiscoveryResult> {
    const hits: DiscoveryHit[] = [];
    try {
      for (const [index, query] of queries.entries()) {
        // Deliberately paced: this hits the unauthenticated guest endpoint,
        // and a burst is what gets an IP blocked.
        if (index > 0) {
          await sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
        }

        const url = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
        url.searchParams.set('keywords', query);
        url.searchParams.set('location', criteria.locations.include[0] ?? 'India');
        url.searchParams.set('f_TPR', 'r604800');   // last 7 days
        url.searchParams.set('start', '0');

        const html = await fetchText(url.toString());
        const links = [...html.matchAll(LINK_RE)].map((m) => m[1]);
        const companies = [...html.matchAll(COMPANY_RE)].map((m) => m[1].trim());

        links.forEach((link, i) => {
          hits.push({
            applyUrl: link.split('?')[0],
            company: companies[i] ?? 'Unknown',
            via: 'linkedin-guest',
          });
        });
      }
      return { hits, ok: true };
    } catch (err) {
      return { hits: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
