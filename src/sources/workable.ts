import { fetchJson, htmlToText } from './http.js';
import type { JobSource, RawJob, SourceResult } from './types.js';
import type { BoardRow } from '../db/types.js';

interface WorkableJob {
  shortcode: string;
  title: string;
  url: string;
  published_on?: string;
  location?: { city?: string; country?: string };
  description?: string;
}

/** Workable sends a date with no time, so pin it to UTC midnight. */
function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const workableSource: JobSource = {
  name: 'workable',
  platform: 'workable',

  async fetchJobs(board: BoardRow): Promise<SourceResult> {
    const url = `https://${encodeURIComponent(board.board_token)}.workable.com/spi/v3/jobs`;
    try {
      const body = (await fetchJson(url)) as { results?: WorkableJob[] };
      const jobs: RawJob[] = (body.results ?? [])
        // A posting with no shortcode or url is unusable downstream; drop it
        // without failing the rest of the board.
        .filter((j) => j.shortcode != null && typeof j.url === 'string' && j.url.length > 0)
        .map((j) => ({
          sourceJobId: String(j.shortcode),
          url: j.url,
          company: board.company_name,
          title: j.title,
          location: [j.location?.city, j.location?.country].filter(Boolean).join(', ') || null,
          postedAt: toIso(j.published_on),
          jdText: htmlToText(j.description ?? ''),
          atsPlatform: 'workable',
        }));
      return { jobs, ok: true };
    } catch (err) {
      return { jobs: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
