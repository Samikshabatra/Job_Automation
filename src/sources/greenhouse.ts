import { fetchJson, htmlToText } from './http.js';
import type { JobSource, RawJob, SourceResult } from './types.js';
import type { BoardRow } from '../db/types.js';

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string;
}

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const greenhouseSource: JobSource = {
  name: 'greenhouse',
  platform: 'greenhouse',

  async fetchJobs(board: BoardRow): Promise<SourceResult> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.board_token)}/jobs?content=true`;
    try {
      const body = (await fetchJson(url)) as { jobs?: GhJob[] };
      const jobs: RawJob[] = (body.jobs ?? []).map((j) => ({
        sourceJobId: String(j.id),
        url: j.absolute_url,
        company: board.company_name,
        title: j.title,
        location: j.location?.name ?? null,
        postedAt: toIso(j.updated_at),
        jdText: htmlToText(j.content ?? ''),
        atsPlatform: 'greenhouse',
      }));
      return { jobs, ok: true };
    } catch (err) {
      return { jobs: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
