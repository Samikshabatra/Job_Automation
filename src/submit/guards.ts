import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import type { BlockedCompany, Criteria } from '../config/schema.js';
import type { JobRow, JobStatus } from '../db/types.js';
import {
  countOpenApplicationsByCompany, countApplicationsSince,
  hasApplicationForJob, listApplicationTitlesByCompany,
} from '../db/applications.js';
import { normalizeCompany } from '../normalize/fingerprint.js';
import { titleSimilarity } from '../normalize/title.js';

const NEAR_DUPLICATE_THRESHOLD = 0.85;

export type GuardOutcome =
  | { allow: true }
  | { allow: false; status: JobStatus | 'dry-run'; reason: string };

export interface GuardContext {
  db: Database;
  job: JobRow;
  criteria: Criteria;
  blocklist: BlockedCompany[];
  now: Date;
  projectRoot: string;
  submittedThisRun: number;
  isStillOpen?: (job: JobRow) => Promise<boolean>;
}

export function randomDelayMs(criteria: Criteria): number {
  const { min_delay_seconds: min, max_delay_seconds: max } = criteria.limits;
  return Math.round((min + Math.random() * (max - min)) * 1000);
}

export async function runGuards(ctx: GuardContext): Promise<GuardOutcome> {
  const { db, job, criteria, blocklist } = ctx;

  // 1. Dry-run
  if (criteria.submission.dry_run) {
    return { allow: false, status: 'dry-run', reason: 'dry_run enabled — payload logged, nothing sent' };
  }

  // 2. Kill switch
  if (existsSync(join(ctx.projectRoot, 'PAUSE'))) {
    return { allow: false, status: 'deferred', reason: 'PAUSE file present' };
  }

  // 3. Blocklist — compared on normalized company names
  const company = normalizeCompany(job.company);
  const blocked = blocklist.find((b) => normalizeCompany(b.name) === company);
  if (blocked) {
    return { allow: false, status: 'skipped', reason: `blocklist: ${blocked.reason || 'listed'}` };
  }

  // 4. Fingerprint dedupe
  if (hasApplicationForJob(db, job.id)) {
    return { allow: false, status: 'skipped', reason: 'already applied to this fingerprint' };
  }

  // 5. Near-duplicate title at the same company
  const priorTitles = listApplicationTitlesByCompany(db, job.company);
  const duplicate = priorTitles.find((t) => titleSimilarity(t, job.title) >= NEAR_DUPLICATE_THRESHOLD);
  if (duplicate) {
    return { allow: false, status: 'held', reason: `near-duplicate of applied role "${duplicate}"` };
  }

  // 6. Per-company cap
  const openAtCompany = countOpenApplicationsByCompany(db, job.company);
  if (openAtCompany >= criteria.limits.per_company_open_applications) {
    return {
      allow: false, status: 'deferred',
      reason: `per-company cap reached (${openAtCompany}/${criteria.limits.per_company_open_applications})`,
    };
  }

  // 7. Daily cap
  const dayStart = new Date(ctx.now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const today = countApplicationsSince(db, dayStart.toISOString()) + ctx.submittedThisRun;
  if (today >= criteria.limits.daily_cap) {
    return { allow: false, status: 'deferred', reason: `daily cap reached (${today}/${criteria.limits.daily_cap})` };
  }

  // 8. Still open
  if (criteria.freshness.verify_open_before_submit && ctx.isStillOpen) {
    if (!(await ctx.isStillOpen(job))) {
      return { allow: false, status: 'closed', reason: 'posting no longer open' };
    }
  }

  // 9. Jitter is applied by the caller between successful submissions.
  return { allow: true };
}
