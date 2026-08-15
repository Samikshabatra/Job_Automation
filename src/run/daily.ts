import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { Database } from 'better-sqlite3';
import type { BlockedCompany, CompanyEntry, Criteria } from '../config/schema.js';
import { loadBlocklist, loadCompanies, loadCriteria } from '../config/load.js';
import { openDb } from '../db/index.js';
import { listActiveBoards, markBoardPolled } from '../db/boards.js';
import {
  insertJob, listJobsByStatus, markMissingJobsClosed,
  markSubmitted, setJobResume, setJobScore, updateJobStatus,
} from '../db/jobs.js';
import { insertApplication } from '../db/applications.js';
import { recordSourceOutcome, listUnhealthySources } from '../db/health.js';
import type { BoardRow, JobRow } from '../db/types.js';
import { normalizeTitle } from '../normalize/title.js';
import { normalizeLocation, isUnknownLocationToken } from '../normalize/location.js';
import { fingerprint } from '../normalize/fingerprint.js';
import { sourceFor } from '../sources/index.js';
import type { RawJob, SourceResult } from '../sources/types.js';
import { ALL_DISCOVERY } from '../discovery/index.js';
import { registerDiscovered, type DiscoveryHit } from '../discovery/register.js';
import { resolveAll } from '../resolve/resolver.js';
import { extractSkills } from '../score/extract.js';
import { extractMinYears } from '../score/years.js';
import { applyHardFilters } from '../score/filters.js';
import { scoreJob } from '../score/score.js';
import { loadResume, type Resume } from '../tailor/resume.js';
import { selectEntries } from '../tailor/select.js';
import { tailor, type LlmCall } from '../tailor/llm.js';
import { verifyNoFabrication } from '../tailor/verify.js';
import { buildRenderInput, renderPdf, resumePath } from '../tailor/render.js';
import { runGuards, randomDelayMs } from '../submit/guards.js';
import { adapterFor } from '../submit/router.js';
import type { SubmitPayload } from '../submit/types.js';
import { isStillOpen as defaultIsStillOpen } from '../submit/liveness.js';
import { emptyReport, writeReport, formatReport, type RunReport } from './report.js';

const ENTRIES_PER_RESUME = 2;
const FAILURE_PAUSE_RATIO = 0.3;
const UNHEALTHY_AFTER_RUNS = 3;

/**
 * Statuses eligible for the submission stage. Spec §5.5: `deferred` jobs are
 * automatically reconsidered on the next run (they lost a cap race, not a
 * judgement), whereas `held` jobs require the user to act and must NOT be
 * picked up again automatically.
 */
const SUBMITTABLE: JobRow['status'][] = ['tailored', 'deferred'];

export interface RunDeps {
  db: Database;
  criteria: Criteria;
  blocklist: BlockedCompany[];
  companies: CompanyEntry[];
  resume: Resume;
  projectRoot: string;
  now: Date;
  archiveDir?: string;
  fetchBoard?: (board: BoardRow) => Promise<SourceResult>;
  runDiscovery?: (queries: string[], criteria: Criteria) => Promise<{ hits: DiscoveryHit[]; failures: { source: string; error: string }[] }>;
  resolveCompanies?: () => Promise<{ resolved: unknown[]; unresolved: string[] }>;
  callLlm?: LlmCall;
  render?: (input: ReturnType<typeof buildRenderInput>, out: string) => Promise<void>;
  submit?: (payload: SubmitPayload) => Promise<void>;
  isStillOpen?: (job: JobRow) => Promise<boolean>;
}

function bump(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

export async function runDaily(deps: RunDeps): Promise<RunReport> {
  const { db, criteria, blocklist, resume, now } = deps;
  const report = emptyReport(now.toISOString());
  const archiveDir = deps.archiveDir ?? join(homedir(), 'job-applications');

  const fetchBoard = deps.fetchBoard ?? ((b: BoardRow) => sourceFor(b.ats_platform).fetchJobs(b));
  const render = deps.render ?? renderPdf;
  const isStillOpen = deps.isStillOpen ?? defaultIsStillOpen;

  // 1–2. Resolve company names into boards
  const resolution = deps.resolveCompanies
    ? await deps.resolveCompanies()
    : await resolveAll(db, deps.companies);
  report.unresolvedCompanies = resolution.unresolved;

  // 3. Poll every active board
  const boards = listActiveBoards(db);
  const fetched: { job: RawJob; board: BoardRow }[] = [];

  for (const board of boards) {
    const result = await fetchBoard(board);
    report.boardsPolled++;
    recordSourceOutcome(db, `${board.ats_platform}:${board.board_token}`, result.ok);
    if (!result.ok) {
      report.sourceFailures.push({ source: `${board.ats_platform}:${board.board_token}`, error: result.error ?? 'unknown' });
      continue;
    }
    markBoardPolled(db, board.id);
    for (const job of result.jobs) fetched.push({ job, board });
    // 6. Anything previously seen but now absent is closed
    markMissingJobsClosed(db, board.id, result.jobs.map((j) => j.sourceJobId));
  }
  report.fetched = fetched.length;

  // 4. Discovery
  const queries = criteria.titles.include;
  const discovery = deps.runDiscovery
    ? await deps.runDiscovery(queries, criteria)
    : await (async () => {
        const hits: DiscoveryHit[] = [];
        const failures: { source: string; error: string }[] = [];
        for (const source of ALL_DISCOVERY) {
          const result = await source.search(queries, criteria);
          recordSourceOutcome(db, source.name, result.ok);
          if (result.ok) hits.push(...result.hits);
          else failures.push({ source: source.name, error: result.error ?? 'unknown' });
        }
        return { hits, failures };
      })();
  report.sourceFailures.push(...discovery.failures);
  report.discovered = registerDiscovered(db, discovery.hits).registered;

  // 5. Normalize, fingerprint, dedupe, insert
  for (const { job, board } of fetched) {
    if (isUnknownLocationToken(job.location) && !report.unknownLocations.includes(job.location ?? '')) {
      report.unknownLocations.push(job.location ?? '');
    }

    const fp = fingerprint(job.company, job.title, job.location);
    const id = insertJob(db, {
      fingerprint: fp, boardId: board.id, source: board.ats_platform,
      sourceJobId: job.sourceJobId, url: job.url, company: job.company,
      title: job.title, normTitle: normalizeTitle(job.title),
      location: job.location, normLocation: normalizeLocation(job.location),
      postedAt: job.postedAt, jdText: job.jdText, atsPlatform: job.atsPlatform,
    });
    if (id === null) report.deduped++;
  }

  // 7–8. Filter and score everything still new
  const survivors: JobRow[] = [];
  for (const job of listJobsByStatus(db, 'new')) {
    const verdict = applyHardFilters(
      {
        title: job.title, location: job.location,
        postedAt: job.posted_at, firstSeenAt: job.first_seen_at,
        jdText: job.jd_text ?? '',
      },
      criteria, now,
    );
    if (!verdict.pass) {
      updateJobStatus(db, job.id, verdict.status, verdict.reason);
      bump(report.filtered, verdict.status === 'stale' ? 'stale' : verdict.reason.split(' ')[0]);
      continue;
    }

    const jdSkills = extractSkills(job.jd_text ?? '', resume.skills);
    const score = scoreJob(
      {
        title: job.title, jdSkills, jdText: job.jd_text ?? '',
        resumeSkills: Object.keys(resume.skills), targetTitles: criteria.titles.include,
      },
      criteria.scoring.threshold,
    );
    setJobScore(db, job.id, extractMinYears(job.jd_text ?? ''), score);
    report.scored++;

    if (score < criteria.scoring.threshold) {
      updateJobStatus(db, job.id, 'skipped', `score ${score} below threshold`);
      bump(report.filtered, 'score');
      continue;
    }
    survivors.push({ ...job, match_score: score });
  }

  // 9. Tailor
  let failures = 0;
  for (const job of survivors) {
    const jdSkills = extractSkills(job.jd_text ?? '', resume.skills);
    try {
      const tailored = await tailor(
        { jdSkills, jobTitle: job.title, entries: selectEntries(resume.experience, jdSkills, ENTRIES_PER_RESUME) },
        { call: deps.callLlm },
      );

      const check = verifyNoFabrication(tailored, resume.experience);
      if (!check.ok) {
        updateJobStatus(db, job.id, 'failed', `fabrication check failed: ${check.offending.join(' | ')}`);
        failures++;
        continue;
      }

      const out = resumePath(archiveDir, job.company, job.title, now);
      await render(
        buildRenderInput(resume.profile, tailored, resume.experience, resume.education, Object.keys(resume.skills)),
        out,
      );
      setJobResume(db, job.id, out);
      report.tailored++;
    } catch (err) {
      updateJobStatus(db, job.id, 'failed', err instanceof Error ? err.message : String(err));
      failures++;
    }
  }

  // Computed here rather than at the end of the function because no source is
  // polled after this point, and the auto-pause path below returns early — an
  // auto-paused run is exactly when a repeatedly-dead adapter most needs to be
  // visible, so both exit paths must carry the escalation.
  report.unhealthySources = listUnhealthySources(db, UNHEALTHY_AFTER_RUNS)
    .map((s) => ({ source: s.source, consecutiveFailures: s.consecutive_failures }));

  // Auto-pause before submission if the run went badly
  if (survivors.length > 0 && failures / survivors.length > FAILURE_PAUSE_RATIO) {
    report.finishedAt = new Date().toISOString();
    report.sourceFailures.push({
      source: 'pipeline',
      error: `auto-paused: ${failures}/${survivors.length} tailoring failures exceeded ${FAILURE_PAUSE_RATIO * 100}%`,
    });
    return report;
  }

  // 10. Submit through guards
  let submittedThisRun = 0;
  const queue = SUBMITTABLE.flatMap((status) => listJobsByStatus(db, status));

  for (const job of queue) {
    const outcome = await runGuards({
      db, job, criteria, blocklist, now,
      projectRoot: deps.projectRoot, submittedThisRun, isStillOpen,
    });

    if (!outcome.allow) {
      bump(report.outcomes, outcome.status);
      if (outcome.status !== 'dry-run') {
        updateJobStatus(db, job.id, outcome.status, outcome.reason);
      }
      continue;
    }

    const adapter = adapterFor(job.ats_platform!);
    if (!adapter) {
      updateJobStatus(db, job.id, 'skipped', `no adapter for ${job.ats_platform}`);
      bump(report.outcomes, 'no-adapter');
      continue;
    }

    const payload = adapter.buildPayload(job, resume.profile, job.resume_path!);
    try {
      await (deps.submit ?? adapter.submit)(payload);
      markSubmitted(db, job.id);
      insertApplication(db, {
        jobId: job.id, company: job.company, title: job.title,
        method: 'api', emailUsed: resume.profile.email,
      });
      submittedThisRun++;
      report.submitted++;
      await sleep(randomDelayMs(criteria));
    } catch (err) {
      updateJobStatus(db, job.id, 'failed', err instanceof Error ? err.message : String(err));
      bump(report.outcomes, 'submit-failed');
    }
  }

  report.finishedAt = new Date().toISOString();
  return report;
}

/**
 * CLI entrypoint: `npm run daily`.
 *
 * `pathToFileURL` is required, not cosmetic: on Windows a hand-built
 * `file://${argv[1]}` yields `file://C:/Users/Samiksha Batra/...` while
 * `import.meta.url` is `file:///C:/Users/Samiksha%20Batra/...` — different
 * slash count AND different space encoding, so the guard would never fire and
 * `npm run daily` would exit silently having done nothing.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  const report = await runDaily({
    db,
    criteria: loadCriteria(),
    blocklist: loadBlocklist(),
    companies: loadCompanies(),
    resume: loadResume(),
    projectRoot: process.cwd(),
    now: new Date(),
  });
  console.log(formatReport(report));
  console.log(`\nReport written to ${writeReport(report)}`);
  db.close();
}
