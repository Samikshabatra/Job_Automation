import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDb } from '../db/index.js';
import { writeTracker } from '../track/excel.js';

/**
 * Default location for the regenerated tracker, alongside the tailored resume
 * PDFs the pipeline archives under `~/job-applications/`.
 */
export function trackerPath(archiveDir = join(homedir(), 'job-applications')): string {
  return join(archiveDir, 'tracker.xlsx');
}

/**
 * CLI entrypoint: `npm run track`. Rewrites the Excel tracker from the DB.
 * Guarded so importing `trackerPath` from elsewhere (e.g. the daily runner)
 * does not open a database and write a file as an import side effect.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const archiveDir = join(homedir(), 'job-applications');
  mkdirSync(archiveDir, { recursive: true });
  const path = trackerPath(archiveDir);
  const db = openDb();
  await writeTracker(db, path);
  db.close();
  console.log(`Tracker written to ${path}`);
}
