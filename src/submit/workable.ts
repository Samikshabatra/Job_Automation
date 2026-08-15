import type { SubmitAdapter, SubmitPayload } from './types.js';
import { postMultipart, splitName } from './greenhouse.js';
import type { JobRow } from '../db/types.js';
import type { Profile } from '../tailor/resume.js';
import { parseApplyUrl } from '../discovery/urlparse.js';

export const workableAdapter: SubmitAdapter = {
  platform: 'workable',

  buildPayload(job: JobRow, profile: Profile, resumePath: string): SubmitPayload {
    const parsed = parseApplyUrl(job.url);
    const token = parsed?.token ?? '';
    const shortcode = job.source_job_id ?? parsed?.sourceJobId ?? '';
    const { first, last } = splitName(profile.name);

    return {
      endpoint: `https://${token}.workable.com/api/v1/candidates/${shortcode}`,
      method: 'POST',
      fields: {
        firstname: first,
        lastname: last,
        email: profile.email,
        phone: profile.phone,
        address: profile.location,
      },
      files: [{ field: 'resume', path: resumePath }],
    };
  },

  submit: postMultipart,
};
