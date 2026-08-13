import { describe, it, expect } from 'vitest';
import { candidateSlugs } from '../../src/resolve/slug.js';

describe('candidateSlugs', () => {
  it('produces the lowercase concatenation first', () => {
    expect(candidateSlugs('Acme Corp')[0]).toBe('acmecorp');
  });

  it('includes a hyphenated variant', () => {
    expect(candidateSlugs('Acme Corp')).toContain('acme-corp');
  });

  it('includes a variant with the legal suffix dropped', () => {
    expect(candidateSlugs('Acme Technologies Pvt Ltd')).toContain('acme');
  });

  it('strips punctuation and diacritics', () => {
    expect(candidateSlugs("O'Reilly & Co.")).toContain('oreilly');
  });

  it('deduplicates', () => {
    const slugs = candidateSlugs('Acme');
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('never returns an empty slug', () => {
    expect(candidateSlugs('!!!')).not.toContain('');
  });
});
