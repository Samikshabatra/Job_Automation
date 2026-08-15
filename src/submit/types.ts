import type { AtsPlatform } from '../config/schema.js';
import type { JobRow } from '../db/types.js';
import type { Profile } from '../tailor/resume.js';

export interface SubmitPayload {
  endpoint: string;
  method: 'POST';
  fields: Record<string, string>;
  files: { field: string; path: string }[];
}

export interface SubmitAdapter {
  platform: AtsPlatform;
  buildPayload(job: JobRow, profile: Profile, resumePath: string): SubmitPayload;
  submit(payload: SubmitPayload): Promise<void>;
}

export class SubmitError extends Error {}
