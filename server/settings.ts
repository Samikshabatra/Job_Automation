import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { CriteriaSchema } from '../src/config/schema.js';

/**
 * Settings the dashboard is allowed to change, and the rule each must satisfy.
 *
 * A whitelist rather than a free-form patch: criteria.yaml also holds keys the
 * zod schema does not model (browser_enabled, confidence_threshold, optimizer),
 * and an "update anything" endpoint is one typo away from writing a daily cap
 * of 30000 or arming live submission by accident.
 */
type Check = (v: unknown) => boolean;

const isBool: Check = (v) => typeof v === 'boolean';
const isInt = (min: number, max: number): Check =>
  (v) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (min: number, max: number): Check =>
  (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export const EDITABLE: Record<string, Check> = {
  'scoring.threshold': isInt(0, 100),
  'experience.max_years_required': isInt(0, 40),
  'freshness.max_posted_age_days': isInt(1, 365),
  'freshness.verify_open_before_submit': isBool,
  'limits.daily_cap': isInt(1, 200),
  'limits.per_company_open_applications': isInt(1, 50),
  'limits.min_delay_seconds': isInt(0, 3600),
  'limits.max_delay_seconds': isInt(1, 3600),
  'submission.dry_run': isBool,
  'submission.browser_enabled': isBool,
  'submission.confidence_threshold': isNum(0, 1),
};

/** Paths whose value going the wrong way arms real submissions. */
export const DANGEROUS = new Set(['submission.dry_run', 'submission.browser_enabled']);

export class SettingsError extends Error {}

type Doc = Record<string, Record<string, unknown>>;

function criteriaPath(dir: string): string {
  return join(dir, 'criteria.yaml');
}

/**
 * The raw document, unvalidated. Reading through zod would silently drop every
 * key the schema does not model, so anything that writes the file back MUST
 * start from here.
 */
export function readRawCriteria(dir = 'config'): Doc {
  const path = criteriaPath(dir);
  if (!existsSync(path)) throw new SettingsError('config/criteria.yaml is missing');
  return (parse(readFileSync(path, 'utf8')) ?? {}) as Doc;
}

export function getSettings(dir = 'config'): { values: Doc; editable: string[]; dangerous: string[] } {
  return {
    values: readRawCriteria(dir),
    editable: Object.keys(EDITABLE),
    dangerous: [...DANGEROUS],
  };
}

/** Whether the pipeline would actually submit if it ran right now. */
export function isDryRun(dir = 'config'): boolean {
  const submission = readRawCriteria(dir).submission as { dry_run?: unknown } | undefined;
  // Absent means dry-run. The safe reading of a missing switch is "off".
  return submission?.dry_run !== false;
}

/**
 * Apply a whitelisted patch to criteria.yaml.
 *
 * The merged document is validated with CriteriaSchema before anything is
 * written, so a patch that would make the file unloadable is refused while the
 * old file is still intact -- the pipeline never sees a half-valid config.
 */
export function updateSettings(patch: Record<string, unknown>, dir = 'config'): Doc {
  const entries = Object.entries(patch);
  if (entries.length === 0) throw new SettingsError('no settings supplied');

  for (const [path, value] of entries) {
    const check = EDITABLE[path];
    if (!check) throw new SettingsError(`not an editable setting: ${path}`);
    if (!check(value)) throw new SettingsError(`invalid value for ${path}: ${JSON.stringify(value)}`);
  }

  const doc = readRawCriteria(dir);
  for (const [path, value] of entries) {
    const [section, key] = path.split('.') as [string, string];
    doc[section] = { ...(doc[section] ?? {}), [key]: value };
  }

  const parsed = CriteriaSchema.safeParse(doc);
  if (!parsed.success) {
    throw new SettingsError(
      `resulting config is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  }
  if ((doc.limits.min_delay_seconds as number) > (doc.limits.max_delay_seconds as number)) {
    throw new SettingsError('min_delay_seconds cannot exceed max_delay_seconds');
  }

  writeFileSync(criteriaPath(dir), stringify(doc), 'utf8');
  return doc;
}

/**
 * Which external integrations are actually connected, judged by whether their
 * credentials exist on disk. The mockup shows fixed "Connected" badges; a badge
 * that is not checking anything is worse than no badge.
 */
export function getIntegrations(dir = 'config'): { key: string; label: string; connected: boolean; hint: string }[] {
  const has = (f: string) => existsSync(join(dir, f));
  return [
    {
      key: 'gmail',
      label: 'Gmail',
      connected: has('gmail_credentials.json') && has('gmail_token.json'),
      hint: 'Tracks replies to your applications. See docs/gmail-setup.md.',
    },
    {
      key: 'gemini',
      label: 'Gemini',
      connected: Boolean(process.env.GEMINI_API_KEY),
      hint: 'Tailors resumes and classifies ambiguous email. Set GEMINI_API_KEY.',
    },
    {
      key: 'adzuna',
      label: 'Adzuna',
      connected: Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
      hint: 'Job discovery source. Set ADZUNA_APP_ID and ADZUNA_APP_KEY.',
    },
    {
      key: 'excel',
      label: 'Excel tracker',
      connected: true,
      hint: 'Written locally by npm run track. No account needed.',
    },
  ];
}
