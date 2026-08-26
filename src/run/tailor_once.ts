import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db/index.js';
import { getJobById } from '../db/jobs.js';
import { recordTailorRun } from '../db/tailorRuns.js';
import { extractSkills } from '../score/extract.js';
import { loadResume, type Resume } from '../tailor/resume.js';
import { selectEntries } from '../tailor/select.js';
import { tailor, type LlmCall } from '../tailor/llm.js';
import { verifyNoFabrication } from '../tailor/verify.js';
import { buildRenderInput, renderPdf, resumePath } from '../tailor/render.js';

const ENTRIES_PER_RESUME = 2;

export interface TailorOnceResult {
  ok: boolean;
  offending: string[];
  resumePath?: string;
}

export interface TailorOnceDeps {
  db: Database;
  jobId: number;
  resume: Resume;
  now: Date;
  archiveDir: string;
  repairHint?: string;
  callLlm?: LlmCall;
  render?: (input: ReturnType<typeof buildRenderInput>, out: string) => Promise<void>;
}

/**
 * One tailor + fabrication-verify pass for a single job, rendering the PDF
 * only when the result survives the gate. Returns the offending bullets on
 * failure so the resume-optimizer agent can build a repair hint for the next
 * attempt. The fabrication gate is run unchanged — this never force-passes.
 */
export async function tailorOnce(deps: TailorOnceDeps): Promise<TailorOnceResult> {
  const { db, jobId, resume, now, archiveDir } = deps;
  const render = deps.render ?? renderPdf;

  const job = getJobById(db, jobId);
  if (!job) throw new Error(`no job with id ${jobId}`);

  const jdSkills = extractSkills(job.jd_text ?? '', resume.skills);
  const tailored = await tailor(
    {
      jdSkills, jobTitle: job.title,
      entries: selectEntries(resume.experience, jdSkills, ENTRIES_PER_RESUME),
      repairHint: deps.repairHint,
    },
    { call: deps.callLlm },
  );

  const check = verifyNoFabrication(
    tailored, resume.experience, Object.keys(resume.skills), job.title,
  );
  // Every attempt is recorded, pass or fail. This path IS the repair loop, so
  // the sequence of rows for one job is the record of the optimizer trying and
  // either converging or not -- which is the whole question a human has about
  // a job that keeps failing the fabrication gate.
  const runId = runIdFromEnv();

  if (!check.ok) {
    recordTailorRun(db, {
      jobId, runId, source: resume.experience, tailored,
      verdict: 'fail', offending: check.offending, resumePath: null,
    });
    return { ok: false, offending: check.offending };
  }

  const out = resumePath(archiveDir, job.company, job.title, now);
  await render(
    buildRenderInput(resume.profile, tailored, resume.experience, resume.education, Object.keys(resume.skills)),
    out,
  );
  recordTailorRun(db, {
    jobId, runId, source: resume.experience, tailored,
    verdict: 'pass', offending: [], resumePath: out,
  });
  return { ok: true, offending: [], resumePath: out };
}

/** The dashboard run this pass belongs to, or null outside one. */
function runIdFromEnv(): number | null {
  const raw = (process.env.JOBPILOT_RUN_ID ?? '').trim();
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/**
 * CLI: `npm run tailor-once -- <jobId> [--repair <hint-file>]`.
 * Emits a single JSON line ({ ok, offending, resumePath? }) to stdout so the
 * Python resume-optimizer agent can drive the repair loop across invocations.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('dotenv/config');

  const jobId = Number(process.argv[2]);
  if (!Number.isInteger(jobId)) {
    process.stderr.write('usage: tailor-once <jobId> [--repair <hint-file>]\n');
    process.exit(2);
  }
  const repairIdx = process.argv.indexOf('--repair');
  const repairHint = repairIdx >= 0 && process.argv[repairIdx + 1]
    ? readFileSync(process.argv[repairIdx + 1], 'utf8')
    : undefined;

  const db = openDb();
  try {
    const result = await tailorOnce({
      db, jobId, resume: loadResume(), now: new Date(),
      archiveDir: join(homedir(), 'job-applications'), repairHint,
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    db.close();
  }
}
