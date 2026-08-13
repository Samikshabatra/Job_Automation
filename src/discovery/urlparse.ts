import type { AtsPlatform } from '../config/schema.js';

export interface ParsedApplyUrl {
  ats: AtsPlatform;
  token: string;
  sourceJobId: string | null;
}

const RESERVED = new Set(['www', 'apply', 'jobs', 'careers', 'help', 'support', 'account']);

/**
 * Suffix matching has to be anchored at a dot. A bare endsWith('greenhouse.io')
 * also matches notgreenhouse.io, which would register a board token harvested
 * from a domain nobody vetted.
 */
function isHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function parseApplyUrl(raw: string): ParsedApplyUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (isHost(host, 'greenhouse.io')) {
    const token = segments[0];
    if (!token) return null;
    const jobIndex = segments.indexOf('jobs');
    return { ats: 'greenhouse', token, sourceJobId: jobIndex >= 0 ? segments[jobIndex + 1] ?? null : null };
  }

  if (isHost(host, 'lever.co')) {
    const [token, id] = segments;
    if (!token) return null;
    return { ats: 'lever', token, sourceJobId: id ?? null };
  }

  if (isHost(host, 'ashbyhq.com')) {
    const [token, id] = segments;
    if (!token) return null;
    return { ats: 'ashby', token, sourceJobId: id ?? null };
  }

  if (isHost(host, 'workable.com')) {
    if (host.startsWith('apply.')) {
      const [token, , id] = segments;   // /{token}/j/{id}
      if (!token) return null;
      return { ats: 'workable', token, sourceJobId: id ?? null };
    }
    const token = host.split('.')[0];
    if (!token || RESERVED.has(token)) return null;
    const jIndex = segments.indexOf('j');
    return { ats: 'workable', token, sourceJobId: jIndex >= 0 ? segments[jIndex + 1] ?? null : null };
  }

  return null;
}
