import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatReport, writeReport, emptyReport } from '../../src/run/report.js';

const report = {
  ...emptyReport('2026-08-01T00:00:00.000Z'),
  finishedAt: '2026-08-01T00:05:00.000Z',
  boardsPolled: 12,
  fetched: 80,
  deduped: 14,
  filtered: { stale: 20, years: 30, title: 8, location: 4 },
  scored: 18,
  tailored: 6,
  submitted: 4,
  outcomes: { 'dry-run': 2, held: 1, deferred: 1 },
  sourceFailures: [{ source: 'adzuna', error: 'HTTP 429' }],
  unresolvedCompanies: ['Ghost Ltd'],
  unknownLocations: ['Kochi, Kerala'],
};

describe('formatReport', () => {
  it('reports the funnel from fetch to submit', () => {
    const text = formatReport(report);
    expect(text).toContain('fetched');
    expect(text).toContain('80');
    expect(text).toContain('submitted');
  });

  it('surfaces source failures', () => {
    expect(formatReport(report)).toContain('adzuna');
    expect(formatReport(report)).toContain('HTTP 429');
  });

  it('surfaces unresolved company names so they can be fixed by hand', () => {
    expect(formatReport(report)).toContain('Ghost Ltd');
  });

  it('surfaces unknown locations so the alias map can be extended', () => {
    expect(formatReport(report)).toContain('Kochi');
  });

  it('states clearly when the run was a dry run', () => {
    expect(formatReport(report).toLowerCase()).toContain('dry-run');
  });
});

describe('writeReport', () => {
  it('writes a timestamped file and returns its path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'report-'));
    const path = writeReport(report, dir);
    expect(path).toContain(dir);
    expect(readFileSync(path, 'utf8')).toContain('submitted');
    rmSync(dir, { recursive: true, force: true });
  });

  it('produces a filename with no characters that are illegal on Windows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'report-'));
    const path = writeReport(report, dir);
    expect(path.slice(dir.length + 1)).not.toMatch(/[:*?"<>|]/);
    rmSync(dir, { recursive: true, force: true });
  });
});
