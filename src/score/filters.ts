import type { Criteria } from '../config/schema.js';
import { normalizeTitle } from '../normalize/title.js';
import { normalizeLocation } from '../normalize/location.js';
import { extractMinYears } from './years.js';

export interface FilterInput {
  title: string;
  location: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  jdText: string;
}

export type FilterVerdict =
  | { pass: true }
  | { pass: false; status: 'stale' | 'skipped'; reason: string };

const DAY_MS = 86_400_000;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Returns a valid Date, or null if `value` is missing/unparseable. */
function toValidDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function applyHardFilters(input: FilterInput, criteria: Criteria, now: Date): FilterVerdict {
  // postedAt is preferred; fall back to firstSeenAt when postedAt is missing
  // or unparseable. If BOTH are unparseable we cannot determine age at all —
  // fail OPEN (treat the job as fresh) rather than reject it, because
  // rejecting on unknown age would silently drop a job that might be
  // perfectly fresh. The pre-submit liveness check
  // (`freshness.verify_open_before_submit`) is the real safety net that
  // catches dead postings before we actually apply.
  const effectiveDate = toValidDate(input.postedAt) ?? toValidDate(input.firstSeenAt);
  if (effectiveDate) {
    const ageDays = (now.getTime() - effectiveDate.getTime()) / DAY_MS;
    if (ageDays > criteria.freshness.max_posted_age_days) {
      return { pass: false, status: 'stale', reason: `posted ${Math.round(ageDays)}d ago` };
    }
  }

  const minYears = extractMinYears(input.jdText);
  if (minYears > criteria.experience.max_years_required) {
    return { pass: false, status: 'skipped', reason: `requires ${minYears} years` };
  }

  const title = normalizeTitle(input.title);
  const excluded = criteria.titles.exclude.find((t) => {
    const term = normalizeTitle(t);
    return new RegExp(`\\b${escapeRegex(term)}\\b`).test(title);
  });
  if (excluded) {
    return { pass: false, status: 'skipped', reason: `excluded title term "${excluded}"` };
  }
  if (!criteria.titles.include.some((t) => title.includes(normalizeTitle(t)))) {
    return { pass: false, status: 'skipped', reason: `title "${input.title}" outside target family` };
  }

  const location = normalizeLocation(input.location);
  if (!criteria.locations.include.some((l) => location === normalizeLocation(l))) {
    return { pass: false, status: 'skipped', reason: `location "${input.location ?? 'unknown'}" out of scope` };
  }

  return { pass: true };
}
