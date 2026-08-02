import { describe, it, expect } from 'vitest';
import { extractSkills, hasFresherSignal } from '../../src/score/extract.js';

const dict = {
  python: ['python', 'py'],
  sql: ['sql', 'postgresql', 'mysql'],
  'machine learning': ['machine learning', 'ml'],
  pytorch: ['pytorch', 'torch'],
  tableau: ['tableau'],
  kubernetes: ['kubernetes', 'k8s'],
};

describe('extractSkills', () => {
  it('finds canonical names and aliases', () => {
    const jd = 'You will write Python and SQL, and deploy models with k8s.';
    expect(extractSkills(jd, dict).sort()).toEqual(['kubernetes', 'python', 'sql']);
  });

  it('deduplicates when several aliases of one skill appear', () => {
    expect(extractSkills('We use ML. Machine learning is core.', dict)).toEqual(['machine learning']);
  });

  it('matches whole words only', () => {
    expect(extractSkills('We use pythonic idioms and SQLite.', dict)).toEqual([]);
  });

  it('is case insensitive', () => {
    expect(extractSkills('PYTORCH and Tableau', dict).sort()).toEqual(['pytorch', 'tableau']);
  });

  it('returns an empty array for an empty JD', () => {
    expect(extractSkills('', dict)).toEqual([]);
  });
});

describe('hasFresherSignal', () => {
  it.each([
    'Freshers welcome',
    'This is an entry-level role',
    'New grad, 2026 batch',
    'Campus hire program',
    '0-1 years of experience',
    'Internship experience welcome',
  ])('detects "%s"', (jd) => expect(hasFresherSignal(jd)).toBe(true));

  it('returns false for a senior JD', () => {
    expect(hasFresherSignal('5+ years leading ML teams')).toBe(false);
  });
});
