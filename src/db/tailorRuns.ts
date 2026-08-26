import type { Database } from 'better-sqlite3';
import type { ExperienceEntry } from '../tailor/resume.js';
import type { TailorResponse } from '../tailor/llm.js';
import { bulletSimilarity } from '../tailor/verify.js';

export interface TailorRunInput {
  jobId: number;
  /** The dashboard run this happened inside, or null for a plain CLI run. */
  runId: number | null;
  /** The candidate's real experience, before tailoring. */
  source: ExperienceEntry[];
  tailored: TailorResponse;
  verdict: 'pass' | 'fail';
  /** What the anti-fabrication check objected to. Empty on a pass. */
  offending: string[];
  resumePath: string | null;
}

/**
 * Mean similarity between each tailored bullet and the bullet it came from.
 *
 * This is the same number `verifyNoFabrication` gates on, averaged: it says
 * how far the tailoring moved from what the candidate actually wrote. A 1.0
 * means nothing was reworded; a low value means heavy rewriting, which is
 * exactly when a human should look at the result.
 *
 * Bullets the tailor invented have no source to compare against and are scored
 * 0 rather than skipped -- dropping them would let a fabricated bullet raise
 * the average.
 */
function meanSimilarity(source: ExperienceEntry[], tailored: TailorResponse): number | null {
  const sourceText = new Map<string, string>();
  for (const entry of source) {
    for (const bullet of entry.bullets) sourceText.set(bullet.id, bullet.text);
  }

  const scores = tailored.entries.flatMap((entry) =>
    entry.bullets.map((b) => {
      const original = sourceText.get(b.id);
      return original === undefined ? 0 : bulletSimilarity(b.text, original);
    }));

  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Append one tailoring pass to the history the dashboard reads.
 *
 * Best-effort by design, exactly like the agent's step trace: `tailor_runs` is
 * written by the pipeline and read only by the dashboard, so a failed write
 * must cost the history and never the resume that was just rendered. A run
 * that has produced a tailored PDF has done its job whether or not anything
 * managed to record that it did.
 */
export function recordTailorRun(db: Database, input: TailorRunInput): void {
  try {
    // The offending list is folded into the stored payload rather than given a
    // column of its own: it only exists on a failure, and the screen shows it
    // beside the tailored text it is objecting to.
    const tailoredPayload = input.offending.length > 0
      ? { ...input.tailored, offending: input.offending }
      : input.tailored;

    db.prepare(
      `INSERT INTO tailor_runs
         (job_id, run_id, original_json, tailored_json, ai_confidence, similarity,
          verdict, resume_path, created_at)
       VALUES (@jobId, @runId, @originalJson, @tailoredJson, NULL, @similarity,
               @verdict, @resumePath, @createdAt)`,
    ).run({
      jobId: input.jobId,
      runId: input.runId,
      originalJson: JSON.stringify({ entries: input.source }),
      tailoredJson: JSON.stringify(tailoredPayload),
      // `ai_confidence` is deliberately null. The tailoring step produces no
      // such number, and inventing one to fill a column would put a figure on
      // the screen that means nothing. `similarity` is measured, so it is what
      // gets stored.
      similarity: meanSimilarity(input.source, input.tailored),
      verdict: input.verdict,
      resumePath: input.resumePath,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // See the doc comment: the history is never worth a failed run.
  }
}

export function summariseTailoring(db: Database): { total: number; passed: number; failed: number } {
  try {
    const row = db.prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN verdict = 'pass' THEN 1 ELSE 0 END) passed,
              SUM(CASE WHEN verdict = 'fail' THEN 1 ELSE 0 END) failed
         FROM tailor_runs`,
    ).get() as { total: number; passed: number | null; failed: number | null };
    return { total: row.total, passed: row.passed ?? 0, failed: row.failed ?? 0 };
  } catch {
    return { total: 0, passed: 0, failed: 0 };
  }
}
