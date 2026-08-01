import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCriteria, loadBlocklist, loadCompanies } from '../../src/config/load.js';

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, 'utf8');
  }
  return dir;
}

const VALID_CRITERIA = `
titles:
  include: [data analyst, ml engineer]
  exclude: [senior]
experience:
  max_years_required: 0
locations:
  include: [bengaluru, remote]
freshness:
  max_posted_age_days: 7
  verify_open_before_submit: true
scoring:
  threshold: 60
limits:
  daily_cap: 30
  per_company_open_applications: 3
  min_delay_seconds: 45
  max_delay_seconds: 120
submission:
  dry_run: true
`;

describe('loadCriteria', () => {
  it('parses a valid criteria file', () => {
    const dir = fixtureDir({ 'criteria.yaml': VALID_CRITERIA });
    const c = loadCriteria(dir);
    expect(c.experience.max_years_required).toBe(0);
    expect(c.titles.include).toContain('ml engineer');
    expect(c.submission.dry_run).toBe(true);
  });

  it('throws when a required field is missing', () => {
    const dir = fixtureDir({ 'criteria.yaml': 'titles:\n  include: [a]\n' });
    expect(() => loadCriteria(dir)).toThrow(/criteria\.yaml/);
  });

  it('defaults dry_run to true when submission block is absent', () => {
    const withoutSubmission = VALID_CRITERIA.replace(
      'submission:\n  dry_run: true\n',
      '',
    );
    const dir = fixtureDir({ 'criteria.yaml': withoutSubmission });
    expect(loadCriteria(dir).submission.dry_run).toBe(true);
  });
});

describe('loadCompanies', () => {
  it('returns an empty list for an empty file', () => {
    const dir = fixtureDir({ 'companies.yaml': 'companies: []\n' });
    expect(loadCompanies(dir)).toEqual([]);
  });

  it('parses names, paused flags and manual overrides', () => {
    const dir = fixtureDir({
      'companies.yaml':
        'companies:\n  - name: Acme\n  - name: Beta\n    paused: true\n  - name: Gamma\n    ats: lever\n    token: gamma\n',
    });
    const list = loadCompanies(dir);
    expect(list[0]).toEqual({ name: 'Acme', paused: false });
    expect(list[1].paused).toBe(true);
    expect(list[2]).toMatchObject({ ats: 'lever', token: 'gamma' });
  });
});

describe('loadBlocklist', () => {
  it('parses blocked companies', () => {
    const dir = fixtureDir({
      'blocklist.yaml': 'blocked:\n  - name: NoGo Ltd\n    reason: current employer\n',
    });
    expect(loadBlocklist(dir)[0].name).toBe('NoGo Ltd');
  });

  it('returns an empty list when the file is missing', () => {
    const dir = fixtureDir({});
    expect(loadBlocklist(dir)).toEqual([]);
  });
});
