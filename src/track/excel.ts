import ExcelJS from 'exceljs';
import type { Database } from 'better-sqlite3';
import { listAllJobsForTracker } from '../db/jobs.js';
import { listApplicationsWithJob } from '../db/applications.js';

const DAY_MS = 86_400_000;

/**
 * ARGB fills for the Applications "Status" cell, keyed by outcome. Classic
 * Excel conditional-formatting colours. Outcomes absent from this map are left
 * unfilled.
 */
export const OUTCOME_FILL: Record<string, string> = {
  rejected: 'FFFFC7CE', // red
  ghosted: 'FFFFEB9C',  // amber
  interview: 'FFC6EFCE', // green
  offer: 'FFC6EFCE',    // green
};

const PIPELINE_HEADERS = [
  'Company', 'Role', 'Location', 'Source', 'Match score', 'Status',
  'Reason', 'Resume', 'Job link', 'First seen', 'Submitted at',
] as const;

const APPLICATION_HEADERS = [
  'Applied date', 'Company', 'Role', 'Location', 'Source', 'Match score',
  'Method', 'Resume', 'Job link', 'Status', 'Last contact', 'Days since applied',
] as const;

/** A cell value that Excel renders as a clickable link, or a plain blank. */
function link(url: string | null, text?: string): ExcelJS.CellValue {
  if (!url) return '';
  return { text: text ?? url, hyperlink: url };
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
}

function fillCell(cell: ExcelJS.Cell, argb: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
}

export function buildWorkbook(db: Database, now: Date = new Date()): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();

  const pipeline = wb.addWorksheet('Pipeline');
  styleHeader(pipeline.addRow([...PIPELINE_HEADERS]));
  for (const j of listAllJobsForTracker(db)) {
    pipeline.addRow([
      j.company, j.title, j.location, j.source, j.match_score, j.status,
      j.status_reason, link(j.resume_path, 'PDF'), link(j.url, 'Open'),
      j.first_seen_at, j.submitted_at,
    ]);
  }

  const apps = wb.addWorksheet('Applications');
  styleHeader(apps.addRow([...APPLICATION_HEADERS]));
  const statusCol = APPLICATION_HEADERS.indexOf('Status') + 1;
  for (const a of listApplicationsWithJob(db)) {
    const row = apps.addRow([
      a.applied_at, a.company, a.title, a.location, a.source, a.match_score,
      a.method, link(a.resume_path, 'PDF'), link(a.url, 'Open'),
      a.outcome, a.last_email_at, daysSince(a.applied_at, now),
    ]);
    const fill = OUTCOME_FILL[a.outcome];
    if (fill) fillCell(row.getCell(statusCol), fill);
  }

  return wb;
}

/** Regenerate the tracker workbook at `path`, overwriting any previous file. */
export async function writeTracker(db: Database, path: string, now: Date = new Date()): Promise<void> {
  await buildWorkbook(db, now).xlsx.writeFile(path);
}
