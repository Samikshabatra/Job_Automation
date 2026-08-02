import { describe, it, expect } from 'vitest';
import { extractMinYears } from '../../src/score/years.js';

describe('extractMinYears — ranges take the lower bound', () => {
  const cases: [string, number][] = [
    ['0-2 years of experience', 0],
    ['0 - 2 years of experience', 0],
    ['0 to 2 years of experience', 0],
    ['0–2 years experience', 0],
    ['1-3 years of experience required', 1],
    ['2-4 years of relevant experience', 2],
    ['3 to 5 years in data science', 3],
  ];
  it.each(cases)('%s → %i', (jd, expected) => {
    expect(extractMinYears(jd)).toBe(expected);
  });
});

describe('extractMinYears — minimums', () => {
  const cases: [string, number][] = [
    ['1+ years of experience', 1],
    ['2+ yrs experience', 2],
    ['minimum 3 years of experience', 3],
    ['at least 2 years of experience', 2],
    ['3 years preferred', 3],
    ['5 years of industry experience', 5],
  ];
  it.each(cases)('%s → %i', (jd, expected) => {
    expect(extractMinYears(jd)).toBe(expected);
  });
});

describe('extractMinYears — fresher-facing and unstated JDs are 0', () => {
  const cases: string[] = [
    'up to 2 years of experience',
    'less than 2 years of experience',
    'We are hiring freshers for our analytics team',
    'Recent graduates encouraged to apply',
    'New grad role, 2026 batch',
    'Entry level position on the data team',
    'Internship experience welcome',
    'We build data pipelines with Python and dbt.',
    '',
  ];
  it.each(cases)('"%s" → 0', (jd) => {
    expect(extractMinYears(jd)).toBe(0);
  });
});

describe('extractMinYears — traps', () => {
  it('ignores years that are not about experience', () => {
    expect(extractMinYears('Founded 10 years ago. We ship fast.')).toBe(0);
  });

  it('ignores degree durations', () => {
    expect(extractMinYears('A 4 year degree in Computer Science is required.')).toBe(0);
  });

  it('takes the lowest requirement when several are stated', () => {
    expect(extractMinYears('5+ years for senior roles; 1+ years for associate roles')).toBe(1);
  });

  it('lets an explicit fresher signal override a stated minimum', () => {
    expect(extractMinYears('Freshers welcome. 1+ years preferred but not required.')).toBe(0);
  });

  it('is case insensitive', () => {
    expect(extractMinYears('MINIMUM 2 YEARS OF EXPERIENCE')).toBe(2);
  });

  it('does not let "role" leak across a clause boundary onto an unrelated number', () => {
    expect(extractMinYears('This role was created 3 years ago.')).toBe(0);
  });

  it('does not let "preferred" leak backward across a clause onto an unrelated number', () => {
    expect(extractMinYears('Relocation is preferred within 2 years of joining.')).toBe(0);
  });

  it('does not let "role" leak across a semicolon-free compound sentence', () => {
    expect(extractMinYears('We have grown 5 years running and this role is new.')).toBe(0);
  });

  it('ignores undergraduate education durations', () => {
    expect(extractMinYears('4-year undergraduate education required')).toBe(0);
  });

  it('ignores an unhyphenated degree duration', () => {
    expect(extractMinYears('4 year undergraduate education required')).toBe(0);
  });

  it('ignores a tenure figure when the sentence merely contains "role"', () => {
    expect(extractMinYears('Our team has 6 years of history and this role is open')).toBe(0);
  });

  it('ignores "preferred" when it is not attached to a years phrase', () => {
    expect(extractMinYears('The role is preferred for those who can start in 2 weeks')).toBe(0);
  });

  it('ignores "required" when it is not attached to a years phrase', () => {
    expect(extractMinYears('This position has been open 3 years and is required headcount')).toBe(0);
  });
});
