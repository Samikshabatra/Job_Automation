import { describe, it, expect } from 'vitest';
import { normalizeLocation, isUnknownLocationToken } from '../../src/normalize/location.js';

describe('normalizeLocation', () => {
  it('maps Bangalore spellings to bengaluru', () => {
    expect(normalizeLocation('Bangalore, India')).toBe('bengaluru');
    expect(normalizeLocation('BLR')).toBe('bengaluru');
    expect(normalizeLocation('Bengaluru, Karnataka')).toBe('bengaluru');
    expect(normalizeLocation('Banglore')).toBe('bengaluru');
  });

  it('maps the widened metro set to canonicals', () => {
    expect(normalizeLocation('Hyderabad, Telangana')).toBe('hyderabad');
    expect(normalizeLocation('Secunderabad')).toBe('hyderabad');
    expect(normalizeLocation('Bombay')).toBe('mumbai');
    expect(normalizeLocation('Mumbai-Lower Parel, India')).toBe('mumbai');
    expect(normalizeLocation('Navi Mumbai')).toBe('mumbai');
    expect(normalizeLocation('Poona')).toBe('pune');
    expect(normalizeLocation('Madras')).toBe('chennai');
    expect(normalizeLocation('Calcutta')).toBe('kolkata');
    for (const s of ['Hyderabad', 'Pune', 'Mumbai', 'Chennai', 'Kolkata', 'Ahmedabad']) {
      expect(isUnknownLocationToken(s)).toBe(false);
    }
  });

  it('maps a bare country mention to india without shadowing a named city', () => {
    expect(normalizeLocation('India')).toBe('india');
    // Longest alias wins, so a city named alongside the country still wins.
    expect(normalizeLocation('Mumbai, India')).toBe('mumbai');
    expect(normalizeLocation('Hyderabad, India')).toBe('hyderabad');
  });

  it('does not treat Indiana or Indianapolis as india', () => {
    expect(normalizeLocation('Indianapolis, IN')).not.toBe('india');
    expect(isUnknownLocationToken('Indiana')).toBe(true);
  });

  it('still rejects Indian cities outside the target set', () => {
    for (const s of ['Jaipur', 'Indore', 'Bhopal', 'Purnia']) {
      expect(normalizeLocation(s)).toBe(s.toLowerCase());
      expect(isUnknownLocationToken(s)).toBe(true);
    }
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

  it('treats India-qualified remote as remote', () => {
    for (const s of ['Remote (India)', 'Remote - Bengaluru', 'India - Remote']) {
      expect(normalizeLocation(s)).toBe('remote');
    }
  });

  it('does NOT treat foreign-qualified remote as our remote', () => {
    for (const s of ['Remote - United Kingdom', 'Remote, US', 'Remote (US only)', 'Remote - EMEA']) {
      expect(normalizeLocation(s)).not.toBe('remote');
      expect(isUnknownLocationToken(s)).toBe(true);
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
