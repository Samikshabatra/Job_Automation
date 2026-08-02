import { describe, it, expect } from 'vitest';
import { applyHardFilters } from '../../src/score/filters.js';
import type { Criteria } from '../../src/config/schema.js';

const criteria: Criteria = {
  titles: { include: ['data analyst', 'machine learning engineer'], exclude: ['senior', 'principal', 'director'] },
  experience: { max_years_required: 0 },
  locations: { include: ['bengaluru', 'delhi', 'gurugram', 'noida', 'remote'] },
  freshness: { max_posted_age_days: 7, verify_open_before_submit: true },
  scoring: { threshold: 60 },
  limits: { daily_cap: 30, per_company_open_applications: 3, min_delay_seconds: 45, max_delay_seconds: 120 },
  submission: { dry_run: true },
};

const NOW = new Date('2026-08-01T00:00:00.000Z');
const base = {
  title: 'Data Analyst',
  location: 'Bangalore, India',
  postedAt: '2026-07-30T00:00:00.000Z',
  firstSeenAt: '2026-07-30T00:00:00.000Z',
  jdText: '0-2 years of experience with SQL',
};

describe('applyHardFilters', () => {
  it('passes a fresh, in-scope, fresher-eligible job', () => {
    expect(applyHardFilters(base, criteria, NOW)).toEqual({ pass: true });
  });

  it('rejects a posting older than max_posted_age_days as stale', () => {
    const v = applyHardFilters({ ...base, postedAt: '2026-07-01T00:00:00.000Z' }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'stale' });
  });

  it('falls back to firstSeenAt when postedAt is null', () => {
    const v = applyHardFilters(
      { ...base, postedAt: null, firstSeenAt: '2026-06-01T00:00:00.000Z' }, criteria, NOW,
    );
    expect(v).toMatchObject({ pass: false, status: 'stale' });
  });

  it('rejects a job whose minimum years exceeds the cap', () => {
    const v = applyHardFilters({ ...base, jdText: '2+ years of experience' }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'skipped' });
    expect(v).toHaveProperty('reason', expect.stringContaining('years'));
  });

  it('rejects an excluded title', () => {
    const v = applyHardFilters({ ...base, title: 'Senior Data Analyst' }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'skipped' });
  });

  it('rejects a title outside the include family', () => {
    const v = applyHardFilters({ ...base, title: 'Backend Engineer' }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'skipped' });
  });

  it('accepts a title matching an include term after normalization', () => {
    expect(applyHardFilters({ ...base, title: 'ML Engineer' }, criteria, NOW)).toEqual({ pass: true });
  });

  it('rejects an out-of-scope location', () => {
    const v = applyHardFilters({ ...base, location: 'Hyderabad' }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'skipped' });
  });

  it('accepts remote synonyms', () => {
    expect(applyHardFilters({ ...base, location: 'Anywhere' }, criteria, NOW)).toEqual({ pass: true });
  });

  it('rejects a job with no location when no include term matches', () => {
    const v = applyHardFilters({ ...base, location: null }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'skipped' });
  });
});
