import type { BoardRow, JobRow } from '../db/types.js';
import { sourceFor } from '../sources/index.js';
import { parseApplyUrl } from '../discovery/urlparse.js';

/**
 * Re-fetches the job's board and confirms the posting is still listed.
 * Any failure — 404, network error, unsupported platform — is treated as
 * "not open", because submitting into uncertainty is the worse outcome.
 */
export async function isStillOpen(job: JobRow): Promise<boolean> {
  if (!job.ats_platform) return false;

  const parsed = parseApplyUrl(job.url);
  if (!parsed) return false;

  const board: BoardRow = {
    id: job.board_id ?? 0,
    ats_platform: job.ats_platform,
    board_token: parsed.token,
    company_name: job.company,
    discovered_via: null,
    discovered_at: job.created_at,
    last_polled_at: null,
    active: 1,
  };

  const result = await sourceFor(job.ats_platform).fetchJobs(board);
  if (!result.ok) return false;

  const wanted = job.source_job_id ?? parsed.sourceJobId;
  if (!wanted) return false;

  return result.jobs.some((j) => j.sourceJobId === wanted);
}
