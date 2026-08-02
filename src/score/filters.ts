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

export function applyHardFilters(input: FilterInput, criteria: Criteria, now: Date): FilterVerdict {
  const effectiveDate = new Date(input.postedAt ?? input.firstSeenAt);
  const ageDays = (now.getTime() - effectiveDate.getTime()) / DAY_MS;
  if (ageDays > criteria.freshness.max_posted_age_days) {
    return { pass: false, status: 'stale', reason: `posted ${Math.round(ageDays)}d ago` };
  }

  const minYears = extractMinYears(input.jdText);
  if (minYears > criteria.experience.max_years_required) {
    return { pass: false, status: 'skipped', reason: `requires ${minYears} years` };
  }

  const title = normalizeTitle(input.title);
  const excluded = criteria.titles.exclude.find((t) => title.includes(normalizeTitle(t)));
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
