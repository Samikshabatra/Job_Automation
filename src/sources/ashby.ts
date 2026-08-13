import { fetchJson, htmlToText } from './http.js';
import type { JobSource, RawJob, SourceResult } from './types.js';
import type { BoardRow } from '../db/types.js';

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  publishedAt?: string;
  location?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
}

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const ashbySource: JobSource = {
  name: 'ashby',
  platform: 'ashby',

  async fetchJobs(board: BoardRow): Promise<SourceResult> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.board_token)}?includeCompensation=false`;
    try {
      const body = (await fetchJson(url)) as { jobs?: AshbyJob[] };
      const jobs: RawJob[] = (body.jobs ?? [])
        // A posting with no id or jobUrl is unusable downstream; drop it
        // without failing the rest of the board.
        .filter((j) => j.id != null && typeof j.jobUrl === 'string' && j.jobUrl.length > 0)
        .map((j) => ({
          sourceJobId: String(j.id),
          url: j.jobUrl,
          company: board.company_name,
          title: j.title,
          location: j.location ?? null,
          postedAt: toIso(j.publishedAt),
          jdText: j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? ''),
          atsPlatform: 'ashby',
        }));
      return { jobs, ok: true };
    } catch (err) {
      return { jobs: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
