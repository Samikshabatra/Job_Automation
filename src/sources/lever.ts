import { fetchJson, htmlToText } from './http.js';
import type { JobSource, RawJob, SourceResult } from './types.js';
import type { BoardRow } from '../db/types.js';

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: { location?: string };
  descriptionPlain?: string;
  description?: string;
}

/** Lever dates arrive as epoch milliseconds. */
function toIso(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const leverSource: JobSource = {
  name: 'lever',
  platform: 'lever',

  async fetchJobs(board: BoardRow): Promise<SourceResult> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(board.board_token)}?mode=json`;
    try {
      const body = (await fetchJson(url)) as LeverPosting[];
      const jobs: RawJob[] = (body ?? [])
        // Same guard as greenhouse: a posting with no id or hostedUrl is
        // unusable downstream, so drop it rather than emit a fake
        // sourceJobId. One bad entry must not fail the whole board.
        .filter((p) => p.id != null && typeof p.hostedUrl === 'string' && p.hostedUrl.length > 0)
        .map((p) => ({
          sourceJobId: String(p.id),
          url: p.hostedUrl,
          company: board.company_name,
          title: p.text,
          location: p.categories?.location ?? null,
          postedAt: toIso(p.createdAt),
          jdText: p.descriptionPlain ?? htmlToText(p.description ?? ''),
          atsPlatform: 'lever',
        }));
      return { jobs, ok: true };
    } catch (err) {
      return { jobs: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
