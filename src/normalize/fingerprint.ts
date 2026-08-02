import { createHash } from 'node:crypto';
import { normalizeTitle } from './title.js';
import { normalizeLocation } from './location.js';

const COMPANY_SUFFIX = /\b(inc|llc|ltd|limited|pvt|private|corp|corporation|co|gmbh|technologies|technology|labs|software)\b/g;

export function normalizeCompany(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprint(company: string, title: string, location: string | null): string {
  const parts = [normalizeCompany(company), normalizeTitle(title), normalizeLocation(location)];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
