import { describe, it, expect } from 'vitest';
import { normalizeTitle, titleSimilarity } from '../../src/normalize/title.js';

describe('normalizeTitle', () => {
  it('lowercases and trims', () => {
    expect(normalizeTitle('  Data Analyst  ')).toBe('data analyst');
  });

  it('expands known abbreviations', () => {
    expect(normalizeTitle('ML Engineer')).toBe('machine learning engineer');
    expect(normalizeTitle('Sr. SDE')).toBe('senior software engineer');
    expect(normalizeTitle('AI/ML Engineer')).toBe('ai machine learning engineer');
  });

  it('strips bracketed and trailing location suffixes', () => {
    expect(normalizeTitle('Data Engineer (Bengaluru)')).toBe('data engineer');
    expect(normalizeTitle('Data Engineer - Remote')).toBe('data engineer');
    expect(normalizeTitle('Data Engineer, India')).toBe('data engineer');
  });

  it('strips requisition ids', () => {
    expect(normalizeTitle('Data Scientist [REQ-12345]')).toBe('data scientist');
  });

  it('collapses internal whitespace and punctuation', () => {
    expect(normalizeTitle('Machine   Learning  Engineer!')).toBe('machine learning engineer');
  });
});

describe('titleSimilarity', () => {
  it('scores identical normalized titles as 1', () => {
    expect(titleSimilarity('ML Engineer', 'Machine Learning Engineer')).toBe(1);
  });

  it('scores near-duplicates above 0.85', () => {
    expect(titleSimilarity('Data Scientist', 'Data Scientist II')).toBeGreaterThan(0.85);
  });

  it('scores unrelated titles below 0.85', () => {
    expect(titleSimilarity('Data Analyst', 'Backend Engineer')).toBeLessThan(0.85);
  });
});
