import type { AtsPlatform } from '../config/schema.js';
import type { SubmitAdapter } from './types.js';
import { leverAdapter } from './lever.js';

/**
 * Platforms this pipeline can submit to over HTTP.
 *
 * Greenhouse, Ashby and Workable adapters used to sit here and were removed
 * once each was shown to be incapable of ever submitting:
 *
 *   greenhouse  posted to boards.greenhouse.io/{token}/jobs/{id}, which is a
 *               web page -- it answers GET with a 301 to the employer's own
 *               careers site. Submitting needs the employer's Harvest key.
 *   ashby       posted flat multipart fields at a GraphQL endpoint, which
 *               rejects any request without a `query` body.
 *   workable    posted to the employer API with no Authorization header; that
 *               API requires the employer's bearer token.
 *
 * None had ever produced an application. A job on those platforms is handed
 * to the browser agent instead, which drives the real form.
 */
const ADAPTERS: Partial<Record<AtsPlatform, SubmitAdapter>> = {
  lever: leverAdapter,
};

/** Null means "no HTTP path" -- the caller must route the job to the browser agent. */
export function adapterFor(platform: AtsPlatform): SubmitAdapter | null {
  return ADAPTERS[platform] ?? null;
}
