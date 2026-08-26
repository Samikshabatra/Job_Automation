import type { SubmitAdapter, SubmitPayload } from './types.js';
import { postMultipart } from './multipart.js';
import type { JobRow } from '../db/types.js';
import type { Profile } from '../tailor/resume.js';
import { parseApplyUrl } from '../discovery/urlparse.js';

export const leverAdapter: SubmitAdapter = {
  platform: 'lever',

  buildPayload(job: JobRow, profile: Profile, resumePath: string): SubmitPayload {
    const parsed = parseApplyUrl(job.url);
    const token = parsed?.token ?? '';
    const postingId = job.source_job_id ?? parsed?.sourceJobId ?? '';

    return {
      endpoint: `https://jobs.lever.co/${token}/${postingId}/apply`,
      method: 'POST',
      fields: {
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
        ...(profile.links.linkedin ? { 'urls[LinkedIn]': profile.links.linkedin } : {}),
        ...(profile.links.github ? { 'urls[GitHub]': profile.links.github } : {}),
      },
      files: [{ field: 'resume', path: resumePath }],
    };
  },

  submit: postMultipart,
};
