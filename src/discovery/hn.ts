import { fetchJson } from '../sources/http.js';
import type { DiscoverySource, DiscoveryResult } from './types.js';
import type { DiscoveryHit } from './register.js';
import type { Criteria } from '../config/schema.js';

interface AlgoliaHit {
  objectID: string;
  comment_text?: string;
}

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;
const ATS_HOSTS = /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com)/i;

/** "Acme Corp | ML Engineer | Bengaluru | ..." — the company is the first field. */
function companyFrom(comment: string): string {
  const first = comment.split('|')[0]?.trim() ?? '';
  return first.slice(0, 80) || 'Unknown';
}

export const hnSource: DiscoverySource = {
  name: 'hn-whoishiring',

  async search(queries: string[], _criteria: Criteria): Promise<DiscoveryResult> {
    const hits: DiscoveryHit[] = [];
    try {
      for (const query of queries) {
        const url = new URL('https://hn.algolia.com/api/v1/search_by_date');
        url.searchParams.set('query', query);
        url.searchParams.set('tags', 'comment');
        url.searchParams.set('hitsPerPage', '100');

        const body = (await fetchJson(url.toString())) as { hits?: AlgoliaHit[] };
        for (const hit of body.hits ?? []) {
          const text = hit.comment_text ?? '';
          for (const found of text.match(URL_RE) ?? []) {
            if (ATS_HOSTS.test(found)) {
              hits.push({ applyUrl: found, company: companyFrom(text), via: 'hn-whoishiring' });
            }
          }
        }
      }
      return { hits, ok: true };
    } catch (err) {
      return { hits: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
