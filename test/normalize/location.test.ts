import { describe, it, expect } from 'vitest';
import { normalizeLocation, isUnknownLocationToken } from '../../src/normalize/location.js';

describe('normalizeLocation', () => {
  it('maps Bangalore spellings to bengaluru', () => {
    expect(normalizeLocation('Bangalore, India')).toBe('bengaluru');
    expect(normalizeLocation('BLR')).toBe('bengaluru');
    expect(normalizeLocation('Bengaluru, Karnataka')).toBe('bengaluru');
  });

  it('maps Gurgaon to gurugram', () => {
    expect(normalizeLocation('Gurgaon')).toBe('gurugram');
    expect(normalizeLocation('Gurgaon/Gurugram')).toBe('gurugram');
  });

  it('maps Delhi variants to delhi', () => {
    expect(normalizeLocation('New Delhi')).toBe('delhi');
    expect(normalizeLocation('Delhi NCR')).toBe('delhi');
  });

  it('maps Greater Noida to noida', () => {
    expect(normalizeLocation('Greater Noida')).toBe('noida');
  });

  it('maps every remote synonym to remote', () => {
    for (const s of ['Remote', 'Anywhere', 'Worldwide', 'Work From Home', 'Remote - India']) {
      expect(normalizeLocation(s)).toBe('remote');
    }
  });

  it('returns an empty string for null or blank input', () => {
    expect(normalizeLocation(null)).toBe('');
    expect(normalizeLocation('   ')).toBe('');
  });

  it('lowercases unknown locations rather than discarding them', () => {
    expect(normalizeLocation('Kochi, Kerala')).toBe('kochi kerala');
  });
});

describe('isUnknownLocationToken', () => {
  it('flags locations absent from the alias map', () => {
    expect(isUnknownLocationToken('Kochi, Kerala')).toBe(true);
    expect(isUnknownLocationToken('Bangalore')).toBe(false);
  });
});
