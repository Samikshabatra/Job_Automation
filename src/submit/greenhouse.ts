import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { SubmitAdapter, SubmitPayload } from './types.js';
import { SubmitError } from './types.js';
import type { JobRow } from '../db/types.js';
import type { Profile } from '../tailor/resume.js';
import { parseApplyUrl } from '../discovery/urlparse.js';

export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') || parts[0] || '' };
}

/** Shared by all adapters: POST multipart/form-data built from the payload. */
export async function postMultipart(payload: SubmitPayload): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload.fields)) form.append(key, value);
  for (const file of payload.files) {
    form.append(file.field, new Blob([readFileSync(file.path)], { type: 'application/pdf' }), basename(file.path));
  }

  const res = await fetch(payload.endpoint, { method: 'POST', body: form });
  if (!res.ok) throw new SubmitError(`${payload.endpoint} returned HTTP ${res.status}`);
}

export const greenhouseAdapter: SubmitAdapter = {
  platform: 'greenhouse',

  buildPayload(job: JobRow, profile: Profile, resumePath: string): SubmitPayload {
    const parsed = parseApplyUrl(job.url);
    const token = parsed?.token ?? '';
    const jobId = job.source_job_id ?? parsed?.sourceJobId ?? '';
    const { first, last } = splitName(profile.name);

    return {
      endpoint: `https://boards.greenhouse.io/${token}/jobs/${jobId}`,
      method: 'POST',
      fields: {
        id: jobId,
        first_name: first,
        last_name: last,
        email: profile.email,
        phone: profile.phone,
        ...(profile.links.linkedin ? { 'job_application[answers_attributes][0][text_value]': profile.links.linkedin } : {}),
      },
      files: [{ field: 'resume', path: resumePath }],
    };
  },

  submit: postMultipart,
};
