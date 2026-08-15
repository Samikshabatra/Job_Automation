import type { SubmitAdapter, SubmitPayload } from './types.js';
import { postMultipart } from './greenhouse.js';
import type { JobRow } from '../db/types.js';
import type { Profile } from '../tailor/resume.js';
import { parseApplyUrl } from '../discovery/urlparse.js';

export const ashbyAdapter: SubmitAdapter = {
  platform: 'ashby',

  buildPayload(job: JobRow, profile: Profile, resumePath: string): SubmitPayload {
    const parsed = parseApplyUrl(job.url);
    const jobId = job.source_job_id ?? parsed?.sourceJobId ?? '';

    return {
      endpoint: `https://jobs.ashbyhq.com/api/non-user-graphql?op=ApplyToJob`,
      method: 'POST',
      fields: {
        jobPostingId: jobId,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        ...(profile.links.linkedin ? { linkedin: profile.links.linkedin } : {}),
      },
      files: [{ field: 'resume', path: resumePath }],
    };
  },

  submit: postMultipart,
};
