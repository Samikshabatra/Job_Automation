import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { SubmitPayload } from './types.js';
import { SubmitError } from './types.js';

export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') || parts[0] || '' };
}

/** POST multipart/form-data built from the payload. */
export async function postMultipart(payload: SubmitPayload): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload.fields)) form.append(key, value);
  for (const file of payload.files) {
    form.append(file.field, new Blob([readFileSync(file.path)], { type: 'application/pdf' }), basename(file.path));
  }

  const res = await fetch(payload.endpoint, { method: 'POST', body: form });
  if (!res.ok) throw new SubmitError(`${payload.endpoint} returned HTTP ${res.status}`);
}
