import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { insertJob } from '../../src/db/jobs.js';
import { insertApplication } from '../../src/db/applications.js';
import { buildWorkbook, OUTCOME_FILL } from '../../src/track/excel.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

const baseJob = {
  source: 'greenhouse', sourceJobId: '1', url: 'https://acme/apply/1',
  company: 'Acme', title: 'Data Analyst', normTitle: 'data analyst',
  location: 'Bengaluru', normLocation: 'bengaluru',
  postedAt: '2026-08-01T00:00:00.000Z', jdText: 'jd',
  atsPlatform: 'greenhouse' as const, boardId: null,
};

function seedAppliedJob(outcome: string): number {
  const jobId = insertJob(db, { ...baseJob, fingerprint: `fp-${outcome}`, url: `https://acme/${outcome}` })!;
  db.prepare('UPDATE jobs SET match_score = 82, resume_path = ?, status = ? WHERE id = ?')
    .run(`/resumes/${outcome}.pdf`, 'submitted', jobId);
  insertApplication(db, { jobId, company: 'Acme', title: 'Data Analyst', method: 'api', emailUsed: 'me@x.com' });
  db.prepare('UPDATE applications SET outcome = ? WHERE job_id = ?').run(outcome, jobId);
  return jobId;
}

describe('buildWorkbook', () => {
  it('has a Pipeline sheet and an Applications sheet', () => {
    const wb = buildWorkbook(db);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Pipeline', 'Applications']);
  });

  it('writes a header row and one row per job on the Pipeline sheet', () => {
    insertJob(db, { ...baseJob, fingerprint: 'p1' });
    const sheet = buildWorkbook(db).getWorksheet('Pipeline')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Company');
    expect(sheet.getRow(2).getCell(1).value).toBe('Acme');
    expect(sheet.actualRowCount).toBe(2); // header + one job
  });

  it('renders the job link as a clickable hyperlink', () => {
    insertJob(db, { ...baseJob, fingerprint: 'p2' });
    const sheet = buildWorkbook(db).getWorksheet('Pipeline')!;
    const linkCol = (sheet.getRow(1).values as string[]).indexOf('Job link');
    const cell = sheet.getRow(2).getCell(linkCol);
    expect((cell.value as { hyperlink: string }).hyperlink).toBe('https://acme/apply/1');
  });

  it('lists submitted applications on the Applications sheet', () => {
    seedAppliedJob('awaiting');
    const sheet = buildWorkbook(db).getWorksheet('Applications')!;
    expect(sheet.getRow(1).getCell(2).value).toBe('Company');
    expect(sheet.getRow(2).getCell(2).value).toBe('Acme');
  });

  it('colours the status cell red for a rejected application', () => {
    seedAppliedJob('rejected');
    const sheet = buildWorkbook(db).getWorksheet('Applications')!;
    const statusCol = (sheet.getRow(1).values as string[]).indexOf('Status');
    const fill = sheet.getRow(2).getCell(statusCol).fill as { fgColor?: { argb?: string } };
    expect(fill.fgColor?.argb).toBe(OUTCOME_FILL.rejected);
  });

  it('colours the status cell green for an interview', () => {
    seedAppliedJob('interview');
    const sheet = buildWorkbook(db).getWorksheet('Applications')!;
    const statusCol = (sheet.getRow(1).values as string[]).indexOf('Status');
    const fill = sheet.getRow(2).getCell(statusCol).fill as { fgColor?: { argb?: string } };
    expect(fill.fgColor?.argb).toBe(OUTCOME_FILL.interview);
  });

  it('computes days since applied from the given now', () => {
    seedAppliedJob('awaiting');
    const now = new Date(Date.now() + 5 * 86_400_000);
    const sheet = buildWorkbook(db, now).getWorksheet('Applications')!;
    const daysCol = (sheet.getRow(1).values as string[]).indexOf('Days since applied');
    expect(sheet.getRow(2).getCell(daysCol).value).toBe(5);
  });
});
