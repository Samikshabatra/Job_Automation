# Job Application Pipeline — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally-run Node/TypeScript pipeline that finds fresher-eligible AI/ML/Data roles, tailors a resume to each, and auto-submits to Greenhouse/Lever/Ashby/Workable behind hard safety guards.

**Architecture:** A single Node process invoked by Windows Task Scheduler. Company boards are polled through official free ATS APIs; search aggregators discover new boards and register their tokens, so the registry compounds. Jobs are deduped by fingerprint, filtered and scored deterministically (no LLM), and only survivors reach a small-payload Gemini call that reorders existing resume bullets. Submission runs behind nine ordered guards with dry-run on by default.

**Tech Stack:** Node 20, TypeScript, vitest, better-sqlite3, zod, yaml, native `fetch`, Typst CLI, Gemini REST API.

**Spec:** `docs/superpowers/specs/2026-08-01-job-pipeline-slice1-design.md`

## Global Constraints

- **Runtime:** Node 20+, TypeScript strict mode, ESM (`"type": "module"`).
- **All SQL lives in `src/db/`.** No other module may import `better-sqlite3` or write SQL. This keeps the slice-4 Postgres swap contained.
- **Timestamps are ISO-8601 strings** everywhere (`new Date().toISOString()`), never Date objects in the DB layer.
- **`submission.dry_run` defaults to `true`** and must never be flipped to `false` by code, only by the user editing `config/criteria.yaml`.
- **No network calls in tests.** Every source/adapter test runs against recorded fixtures or mocked `fetch`. The only live network is the manual canary.
- **The LLM may never receive the full resume or the full JD** — only extracted keywords and preselected bullets.
- **`max_years_required` compares against the JD's MINIMUM stated years**, not the maximum. `"0-2 years"` → minimum 0 → passes at 0.
- **Every rejection records a reason.** No job is ever silently dropped.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `chore:`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/config/schema.ts` | zod schemas for criteria/companies/blocklist |
| `src/config/load.ts` | Read + validate YAML and `.env`; throw on malformed |
| `src/db/schema.sql` | Table DDL |
| `src/db/index.ts` | Connection, migration runner |
| `src/db/jobs.ts` | Job row queries |
| `src/db/boards.ts` | `company_boards` queries |
| `src/db/applications.ts` | Application row queries |
| `src/normalize/title.ts` | Title normalization + alias map |
| `src/normalize/location.ts` | Location normalization + alias map |
| `src/normalize/fingerprint.ts` | sha256 fingerprint |
| `src/sources/types.ts` | `RawJob`, `JobSource` interfaces |
| `src/sources/greenhouse.ts` | Greenhouse board poll |
| `src/sources/lever.ts` | Lever board poll |
| `src/sources/ashby.ts` | Ashby board poll |
| `src/sources/workable.ts` | Workable board poll |
| `src/resolve/resolver.ts` | Company name → `{ats, token}` |
| `src/discovery/urlparse.ts` | Apply URL → `{ats, token, company}` |
| `src/discovery/adzuna.ts` | Adzuna keyword search |
| `src/discovery/hn.ts` | HN "Who is Hiring" via Algolia |
| `src/discovery/remotive.ts` | Remotive search |
| `src/discovery/linkedin.ts` | LinkedIn guest endpoint |
| `src/score/years.ts` | Minimum-years extraction |
| `src/score/extract.ts` | JD → skills, fresher signals |
| `src/score/filters.ts` | Hard filters |
| `src/score/score.ts` | Weighted 0–100 score |
| `src/tailor/select.ts` | Deterministic bullet preselection |
| `src/tailor/llm.ts` | Gemini call + schema validation |
| `src/tailor/verify.ts` | Anti-fabrication gate |
| `src/tailor/render.ts` | Typst → PDF |
| `src/submit/types.ts` | `SubmitAdapter`, `SubmitPayload` |
| `src/submit/guards.ts` | Nine ordered guards |
| `src/submit/router.ts` | ATS → adapter dispatch |
| `src/submit/{greenhouse,lever,ashby,workable}.ts` | Payload builders |
| `src/run/daily.ts` | Orchestrator |
| `src/run/report.ts` | Run report writer |
| `resume/*.json` | Resume data (fixture first, real later) |

---

## Task 1: Project scaffold and config loading

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/config/schema.ts`, `src/config/load.ts`
- Create: `config/criteria.yaml`, `config/companies.yaml`, `config/blocklist.yaml`
- Test: `test/config/load.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `loadCriteria(dir: string): Criteria`, `loadCompanies(dir: string): CompanyEntry[]`, `loadBlocklist(dir: string): BlockedCompany[]`, and the types `Criteria`, `CompanyEntry`, `BlockedCompany`

- [ ] **Step 1: Initialise the repo and install dependencies**

```bash
cd "C:/Users/Samiksha Batra/Desktop/Job_Automation"
git init
npm init -y
npm i better-sqlite3 zod yaml dotenv
npm i -D typescript tsx vitest @types/node @types/better-sqlite3
```

- [ ] **Step 2: Write the config files**

`package.json` — replace the `"scripts"` and add `"type"`:

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "daily": "tsx src/run/daily.ts"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

`.gitignore`:

```
node_modules/
dist/
.env
data/*.db
runs/
resume/*.json
!resume/*.example.json
```

`.env.example`:

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
APPLICANT_EMAIL=
```

- [ ] **Step 3: Write the failing test**

`test/config/load.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `npx vitest run test/config/load.test.ts`
Expected: FAIL — `Cannot find module '../../src/config/load.js'`

- [ ] **Step 5: Write the schemas**

`src/config/schema.ts`:

```ts
import { z } from 'zod';

export const AtsPlatform = z.enum(['greenhouse', 'lever', 'ashby', 'workable']);
export type AtsPlatform = z.infer<typeof AtsPlatform>;

export const CriteriaSchema = z.object({
  titles: z.object({
    include: z.array(z.string()).min(1),
    exclude: z.array(z.string()).default([]),
  }),
  experience: z.object({
    max_years_required: z.number().int().min(0),
  }),
  locations: z.object({
    include: z.array(z.string()).min(1),
  }),
  freshness: z.object({
    max_posted_age_days: z.number().int().positive(),
    verify_open_before_submit: z.boolean().default(true),
  }),
  scoring: z.object({
    threshold: z.number().min(0).max(100),
  }),
  limits: z.object({
    daily_cap: z.number().int().positive(),
    per_company_open_applications: z.number().int().positive(),
    min_delay_seconds: z.number().int().nonnegative(),
    max_delay_seconds: z.number().int().positive(),
  }),
  submission: z
    .object({ dry_run: z.boolean().default(true) })
    .default({ dry_run: true }),
});
export type Criteria = z.infer<typeof CriteriaSchema>;

export const CompanyEntrySchema = z.object({
  name: z.string().min(1),
  paused: z.boolean().default(false),
  ats: AtsPlatform.optional(),
  token: z.string().optional(),
});
export type CompanyEntry = z.infer<typeof CompanyEntrySchema>;

export const CompaniesFileSchema = z.object({
  companies: z.array(CompanyEntrySchema).default([]),
});

export const BlockedCompanySchema = z.object({
  name: z.string().min(1),
  reason: z.string().default(''),
});
export type BlockedCompany = z.infer<typeof BlockedCompanySchema>;

export const BlocklistFileSchema = z.object({
  blocked: z.array(BlockedCompanySchema).default([]),
});
```

- [ ] **Step 6: Write the loader**

`src/config/load.ts`:

```ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ZodType } from 'zod';
import {
  CriteriaSchema, CompaniesFileSchema, BlocklistFileSchema,
  type Criteria, type CompanyEntry, type BlockedCompany,
} from './schema.js';

function readYaml<T>(dir: string, file: string, schema: ZodType<T>, fallback?: T): T {
  const path = join(dir, file);
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing config file: ${file}`);
  }
  const parsed = schema.safeParse(parse(readFileSync(path, 'utf8')) ?? {});
  if (!parsed.success) {
    throw new Error(`Invalid ${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

export function loadCriteria(dir = 'config'): Criteria {
  return readYaml(dir, 'criteria.yaml', CriteriaSchema);
}

export function loadCompanies(dir = 'config'): CompanyEntry[] {
  return readYaml(dir, 'companies.yaml', CompaniesFileSchema, { companies: [] }).companies;
}

export function loadBlocklist(dir = 'config'): BlockedCompany[] {
  return readYaml(dir, 'blocklist.yaml', BlocklistFileSchema, { blocked: [] }).blocked;
}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `npx vitest run test/config/load.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 8: Create the real config files**

`config/criteria.yaml` — copy verbatim from spec §4.2.
`config/companies.yaml`:

```yaml
# Add companies you want polled. Edits take effect on the next run.
#   - name: Acme Corp        # ats/token resolved automatically
#   - name: Beta Inc
#     paused: true           # keep listed, stop applying
#   - name: Gamma Ltd
#     ats: lever             # manual override if resolution fails
#     token: gamma
companies: []
```

`config/blocklist.yaml`:

```yaml
# Companies that are NEVER auto-applied to, regardless of discovery.
blocked: []
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: project scaffold and validated config loading"
```

---

## Task 2: Database schema and query modules

**Files:**
- Create: `src/db/schema.sql`, `src/db/index.ts`, `src/db/types.ts`, `src/db/jobs.ts`, `src/db/boards.ts`, `src/db/applications.ts`
- Test: `test/db/jobs.test.ts`, `test/db/boards.test.ts`

**Interfaces:**
- Consumes: `AtsPlatform` from `src/config/schema.ts`
- Produces:
  - `openDb(path: string): Database` (runs migrations on open)
  - `type JobStatus`, `type JobRow`, `type BoardRow`
  - `insertJob(db, job: NewJob): number | null` (null when the fingerprint already exists)
  - `getJobByFingerprint(db, fp: string): JobRow | undefined`
  - `updateJobStatus(db, id: number, status: JobStatus, reason?: string): void`
  - `listJobsByStatus(db, status: JobStatus): JobRow[]`
  - `markMissingJobsClosed(db, boardId: number, seenSourceIds: string[]): number`
  - `upsertBoard(db, b: NewBoard): number`, `listActiveBoards(db): BoardRow[]`, `deactivateBoard(db, id: number): void`
  - `insertApplication(db, a: NewApplication): number`, `countOpenApplicationsByCompany(db, company: string): number`, `countApplicationsSince(db, iso: string): number`, `listApplicationTitlesByCompany(db, company: string): string[]`

- [ ] **Step 1: Write the schema**

`src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS company_boards (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ats_platform   TEXT NOT NULL,
  board_token    TEXT NOT NULL,
  company_name   TEXT NOT NULL,
  discovered_via TEXT,
  discovered_at  TEXT NOT NULL,
  last_polled_at TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (ats_platform, board_token)
);

CREATE TABLE IF NOT EXISTS jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint    TEXT UNIQUE NOT NULL,
  board_id       INTEGER REFERENCES company_boards(id),
  source         TEXT NOT NULL,
  source_job_id  TEXT,
  url            TEXT NOT NULL,
  company        TEXT NOT NULL,
  title          TEXT NOT NULL,
  norm_title     TEXT NOT NULL,
  location       TEXT,
  norm_location  TEXT,
  posted_at      TEXT,
  first_seen_at  TEXT NOT NULL,
  jd_text        TEXT,
  ats_platform   TEXT,
  min_years      INTEGER,
  match_score    REAL,
  status         TEXT NOT NULL DEFAULT 'new',
  status_reason  TEXT,
  resume_path    TEXT,
  submitted_at   TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);

CREATE TABLE IF NOT EXISTS applications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER NOT NULL REFERENCES jobs(id),
  company       TEXT NOT NULL,
  title         TEXT NOT NULL,
  applied_at    TEXT NOT NULL,
  method        TEXT NOT NULL,
  email_used    TEXT,
  outcome       TEXT NOT NULL DEFAULT 'awaiting',
  last_email_at TEXT,
  thread_ids    TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_apps_company ON applications(company);
```

- [ ] **Step 2: Write the failing test**

`test/db/jobs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import {
  insertJob, getJobByFingerprint, updateJobStatus,
  listJobsByStatus, markMissingJobsClosed,
} from '../../src/db/jobs.js';
import { upsertBoard } from '../../src/db/boards.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

const base = {
  source: 'greenhouse', sourceJobId: '1', url: 'https://x/1',
  company: 'Acme', title: 'Data Analyst', normTitle: 'data analyst',
  location: 'Bengaluru', normLocation: 'bengaluru',
  postedAt: '2026-08-01T00:00:00.000Z', jdText: 'jd',
  atsPlatform: 'greenhouse' as const, boardId: null,
};

describe('insertJob', () => {
  it('inserts a job and returns its id', () => {
    const id = insertJob(db, { ...base, fingerprint: 'fp1' });
    expect(id).toBeGreaterThan(0);
    expect(getJobByFingerprint(db, 'fp1')?.company).toBe('Acme');
  });

  it('returns null for a duplicate fingerprint instead of throwing', () => {
    insertJob(db, { ...base, fingerprint: 'fp1' });
    expect(insertJob(db, { ...base, fingerprint: 'fp1', url: 'https://y/2' })).toBeNull();
  });

  it('defaults status to new and records first_seen_at', () => {
    insertJob(db, { ...base, fingerprint: 'fp2' });
    const row = getJobByFingerprint(db, 'fp2')!;
    expect(row.status).toBe('new');
    expect(row.first_seen_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('updateJobStatus', () => {
  it('records the status and its reason', () => {
    const id = insertJob(db, { ...base, fingerprint: 'fp3' })!;
    updateJobStatus(db, id, 'skipped', 'below threshold');
    const row = getJobByFingerprint(db, 'fp3')!;
    expect(row.status).toBe('skipped');
    expect(row.status_reason).toBe('below threshold');
  });
});

describe('listJobsByStatus', () => {
  it('returns only jobs in the requested status', () => {
    const a = insertJob(db, { ...base, fingerprint: 'a' })!;
    insertJob(db, { ...base, fingerprint: 'b' });
    updateJobStatus(db, a, 'tailored');
    expect(listJobsByStatus(db, 'tailored').map((r) => r.fingerprint)).toEqual(['a']);
  });
});

describe('markMissingJobsClosed', () => {
  it('closes jobs no longer present on their board', () => {
    const boardId = upsertBoard(db, {
      atsPlatform: 'greenhouse', boardToken: 'acme',
      companyName: 'Acme', discoveredVia: 'manual',
    });
    insertJob(db, { ...base, fingerprint: 'keep', sourceJobId: '1', boardId });
    insertJob(db, { ...base, fingerprint: 'gone', sourceJobId: '2', boardId });

    expect(markMissingJobsClosed(db, boardId, ['1'])).toBe(1);
    expect(getJobByFingerprint(db, 'gone')!.status).toBe('closed');
    expect(getJobByFingerprint(db, 'keep')!.status).toBe('new');
  });

  it('never re-closes an already submitted job', () => {
    const boardId = upsertBoard(db, {
      atsPlatform: 'lever', boardToken: 'beta',
      companyName: 'Beta', discoveredVia: 'manual',
    });
    const id = insertJob(db, { ...base, fingerprint: 'sub', sourceJobId: '9', boardId })!;
    updateJobStatus(db, id, 'submitted');
    expect(markMissingJobsClosed(db, boardId, [])).toBe(0);
    expect(getJobByFingerprint(db, 'sub')!.status).toBe('submitted');
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run test/db/jobs.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write the types and connection**

`src/db/types.ts`:

```ts
import type { AtsPlatform } from '../config/schema.js';

export type JobStatus =
  | 'new' | 'scored' | 'tailored' | 'queued' | 'submitted'
  | 'failed' | 'skipped' | 'held' | 'deferred' | 'stale' | 'closed';

export interface NewJob {
  fingerprint: string;
  boardId: number | null;
  source: string;
  sourceJobId: string | null;
  url: string;
  company: string;
  title: string;
  normTitle: string;
  location: string | null;
  normLocation: string | null;
  postedAt: string | null;
  jdText: string | null;
  atsPlatform: AtsPlatform | null;
}

export interface JobRow {
  id: number;
  fingerprint: string;
  board_id: number | null;
  source: string;
  source_job_id: string | null;
  url: string;
  company: string;
  title: string;
  norm_title: string;
  location: string | null;
  norm_location: string | null;
  posted_at: string | null;
  first_seen_at: string;
  jd_text: string | null;
  ats_platform: AtsPlatform | null;
  min_years: number | null;
  match_score: number | null;
  status: JobStatus;
  status_reason: string | null;
  resume_path: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface NewBoard {
  atsPlatform: AtsPlatform;
  boardToken: string;
  companyName: string;
  discoveredVia: string;
}

export interface BoardRow {
  id: number;
  ats_platform: AtsPlatform;
  board_token: string;
  company_name: string;
  discovered_via: string | null;
  discovered_at: string;
  last_polled_at: string | null;
  active: number;
}

export interface NewApplication {
  jobId: number;
  company: string;
  title: string;
  method: 'api' | 'agent' | 'manual';
  emailUsed: string | null;
}
```

`src/db/index.ts`:

```ts
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(path = 'data/pipeline.db'): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  return db;
}

export type { Database } from 'better-sqlite3';
```

- [ ] **Step 5: Write the job queries**

`src/db/jobs.ts`:

```ts
import type { Database } from 'better-sqlite3';
import type { JobRow, JobStatus, NewJob } from './types.js';

const TERMINAL: JobStatus[] = ['submitted', 'closed'];

export function insertJob(db: Database, job: NewJob): number | null {
  const now = new Date().toISOString();
  try {
    const info = db
      .prepare(
        `INSERT INTO jobs (fingerprint, board_id, source, source_job_id, url, company,
           title, norm_title, location, norm_location, posted_at, first_seen_at,
           jd_text, ats_platform, status, created_at)
         VALUES (@fingerprint, @boardId, @source, @sourceJobId, @url, @company,
           @title, @normTitle, @location, @normLocation, @postedAt, @firstSeenAt,
           @jdText, @atsPlatform, 'new', @createdAt)`,
      )
      .run({ ...job, firstSeenAt: now, createdAt: now });
    return Number(info.lastInsertRowid);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) return null;
    throw err;
  }
}

export function getJobByFingerprint(db: Database, fp: string): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE fingerprint = ?').get(fp) as JobRow | undefined;
}

export function getJobById(db: Database, id: number): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
}

export function updateJobStatus(db: Database, id: number, status: JobStatus, reason?: string): void {
  db.prepare('UPDATE jobs SET status = ?, status_reason = ? WHERE id = ?').run(status, reason ?? null, id);
}

export function setJobScore(db: Database, id: number, minYears: number, score: number): void {
  db.prepare('UPDATE jobs SET min_years = ?, match_score = ?, status = ? WHERE id = ?')
    .run(minYears, score, 'scored', id);
}

export function setJobResume(db: Database, id: number, path: string): void {
  db.prepare("UPDATE jobs SET resume_path = ?, status = 'tailored' WHERE id = ?").run(path, id);
}

export function markSubmitted(db: Database, id: number): void {
  db.prepare("UPDATE jobs SET status = 'submitted', submitted_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function listJobsByStatus(db: Database, status: JobStatus): JobRow[] {
  return db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY match_score DESC, id ASC')
    .all(status) as JobRow[];
}

export function markMissingJobsClosed(db: Database, boardId: number, seenSourceIds: string[]): number {
  const placeholders = seenSourceIds.map(() => '?').join(',') || "''";
  const terminals = TERMINAL.map(() => '?').join(',');
  const info = db
    .prepare(
      `UPDATE jobs SET status = 'closed', status_reason = 'no longer listed on board'
       WHERE board_id = ? AND status NOT IN (${terminals})
         AND (source_job_id IS NULL OR source_job_id NOT IN (${placeholders}))`,
    )
    .run(boardId, ...TERMINAL, ...seenSourceIds);
  return info.changes;
}
```

- [ ] **Step 6: Write the board and application queries**

`src/db/boards.ts`:

```ts
import type { Database } from 'better-sqlite3';
import type { BoardRow, NewBoard } from './types.js';

export function upsertBoard(db: Database, b: NewBoard): number {
  db.prepare(
    `INSERT INTO company_boards (ats_platform, board_token, company_name, discovered_via, discovered_at, active)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(ats_platform, board_token) DO UPDATE SET company_name = excluded.company_name`,
  ).run(b.atsPlatform, b.boardToken, b.companyName, b.discoveredVia, new Date().toISOString());

  const row = db.prepare('SELECT id FROM company_boards WHERE ats_platform = ? AND board_token = ?')
    .get(b.atsPlatform, b.boardToken) as { id: number };
  return row.id;
}

export function listActiveBoards(db: Database): BoardRow[] {
  return db.prepare('SELECT * FROM company_boards WHERE active = 1 ORDER BY id').all() as BoardRow[];
}

export function boardExists(db: Database, ats: string, token: string): boolean {
  return !!db.prepare('SELECT 1 FROM company_boards WHERE ats_platform = ? AND board_token = ?').get(ats, token);
}

export function markBoardPolled(db: Database, id: number): void {
  db.prepare('UPDATE company_boards SET last_polled_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function deactivateBoard(db: Database, id: number): void {
  db.prepare('UPDATE company_boards SET active = 0 WHERE id = ?').run(id);
}
```

`src/db/applications.ts`:

```ts
import type { Database } from 'better-sqlite3';
import type { NewApplication } from './types.js';

const OPEN_OUTCOMES = ['awaiting', 'acknowledged', 'screening', 'interview'];

export function insertApplication(db: Database, a: NewApplication): number {
  const info = db
    .prepare(
      `INSERT INTO applications (job_id, company, title, applied_at, method, email_used)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(a.jobId, a.company, a.title, new Date().toISOString(), a.method, a.emailUsed);
  return Number(info.lastInsertRowid);
}

export function hasApplicationForJob(db: Database, jobId: number): boolean {
  return !!db.prepare('SELECT 1 FROM applications WHERE job_id = ?').get(jobId);
}

export function countOpenApplicationsByCompany(db: Database, company: string): number {
  const placeholders = OPEN_OUTCOMES.map(() => '?').join(',');
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM applications WHERE company = ? AND outcome IN (${placeholders})`)
    .get(company, ...OPEN_OUTCOMES) as { n: number };
  return row.n;
}

export function countApplicationsSince(db: Database, iso: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM applications WHERE applied_at >= ?')
    .get(iso) as { n: number };
  return row.n;
}

export function listApplicationTitlesByCompany(db: Database, company: string): string[] {
  const rows = db.prepare('SELECT title FROM applications WHERE company = ?')
    .all(company) as { title: string }[];
  return rows.map((r) => r.title);
}
```

- [ ] **Step 7: Write the board test**

`test/db/boards.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { upsertBoard, listActiveBoards, deactivateBoard, boardExists } from '../../src/db/boards.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

const acme = {
  atsPlatform: 'greenhouse' as const, boardToken: 'acme',
  companyName: 'Acme', discoveredVia: 'manual',
};

it('upsert is idempotent on (ats, token)', () => {
  const first = upsertBoard(db, acme);
  const second = upsertBoard(db, { ...acme, companyName: 'Acme Corp' });
  expect(second).toBe(first);
  expect(listActiveBoards(db)).toHaveLength(1);
  expect(listActiveBoards(db)[0].company_name).toBe('Acme Corp');
});

it('treats the same token on different platforms as distinct boards', () => {
  upsertBoard(db, acme);
  upsertBoard(db, { ...acme, atsPlatform: 'lever' });
  expect(listActiveBoards(db)).toHaveLength(2);
});

it('excludes deactivated boards', () => {
  const id = upsertBoard(db, acme);
  deactivateBoard(db, id);
  expect(listActiveBoards(db)).toHaveLength(0);
  expect(boardExists(db, 'greenhouse', 'acme')).toBe(true);
});
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `npx vitest run test/db`
Expected: PASS — all job and board tests

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: sqlite schema and query modules"
```

---

## Task 3: Title and location normalization, fingerprinting

**Files:**
- Create: `src/normalize/title.ts`, `src/normalize/location.ts`, `src/normalize/fingerprint.ts`
- Test: `test/normalize/title.test.ts`, `test/normalize/location.test.ts`, `test/normalize/fingerprint.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normalizeTitle(raw: string): string`
  - `titleSimilarity(a: string, b: string): number` (0–1, on normalized titles)
  - `normalizeLocation(raw: string | null): string` (`''` when unknown)
  - `isUnknownLocationToken(raw: string | null): boolean`
  - `fingerprint(company: string, title: string, location: string | null): string`

- [ ] **Step 1: Write the failing title test**

`test/normalize/title.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeTitle, titleSimilarity } from '../../src/normalize/title.js';

describe('normalizeTitle', () => {
  it('lowercases and trims', () => {
    expect(normalizeTitle('  Data Analyst  ')).toBe('data analyst');
  });

  it('expands known abbreviations', () => {
    expect(normalizeTitle('ML Engineer')).toBe('machine learning engineer');
    expect(normalizeTitle('Sr. SDE')).toBe('senior software engineer');
    expect(normalizeTitle('AI/ML Engineer')).toBe('ai machine learning engineer');
  });

  it('strips bracketed and trailing location suffixes', () => {
    expect(normalizeTitle('Data Engineer (Bengaluru)')).toBe('data engineer');
    expect(normalizeTitle('Data Engineer - Remote')).toBe('data engineer');
    expect(normalizeTitle('Data Engineer, India')).toBe('data engineer');
  });

  it('strips requisition ids', () => {
    expect(normalizeTitle('Data Scientist [REQ-12345]')).toBe('data scientist');
  });

  it('collapses internal whitespace and punctuation', () => {
    expect(normalizeTitle('Machine   Learning  Engineer!')).toBe('machine learning engineer');
  });
});

describe('titleSimilarity', () => {
  it('scores identical normalized titles as 1', () => {
    expect(titleSimilarity('ML Engineer', 'Machine Learning Engineer')).toBe(1);
  });

  it('scores near-duplicates above 0.85', () => {
    expect(titleSimilarity('Data Scientist', 'Data Scientist II')).toBeGreaterThan(0.85);
  });

  it('scores unrelated titles below 0.85', () => {
    expect(titleSimilarity('Data Analyst', 'Backend Engineer')).toBeLessThan(0.85);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/normalize/title.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement title normalization**

`src/normalize/title.ts`:

```ts
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bml\b/g, 'machine learning'],
  [/\bai\/ml\b/g, 'ai machine learning'],
  [/\bnlp\b/g, 'natural language processing'],
  [/\bsde\b/g, 'software engineer'],
  [/\bswe\b/g, 'software engineer'],
  [/\bsr\b/g, 'senior'],
  [/\bjr\b/g, 'junior'],
  [/\bmle\b/g, 'machine learning engineer'],
  [/\bds\b/g, 'data scientist'],
];

const LOCATION_SUFFIX =
  /\s*[-–—,|]\s*(remote|hybrid|onsite|on-site|india|bengaluru|bangalore|delhi|gurgaon|gurugram|noida|hyderabad|pune|mumbai|chennai|anywhere|worldwide|us|usa|emea|apac)\b.*$/i;

export function normalizeTitle(raw: string): string {
  let t = raw.toLowerCase();
  t = t.replace(/\([^)]*\)/g, ' ');          // (Bengaluru)
  t = t.replace(/\[[^\]]*\]/g, ' ');          // [REQ-12345]
  t = t.replace(LOCATION_SUFFIX, ' ');
  t = t.replace(/\./g, ' ');
  for (const [pattern, replacement] of ABBREVIATIONS) t = t.replace(pattern, replacement);
  t = t.replace(/[^a-z0-9+#\s]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Dice coefficient over character bigrams of the normalized titles. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  if (A.size === 0 || B.size === 0) return 0;
  let overlap = 0;
  for (const g of A) if (B.has(g)) overlap++;
  return (2 * overlap) / (A.size + B.size);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run test/normalize/title.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Write the failing location test**

`test/normalize/location.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeLocation, isUnknownLocationToken } from '../../src/normalize/location.js';

describe('normalizeLocation', () => {
  it('maps Bangalore spellings to bengaluru', () => {
    expect(normalizeLocation('Bangalore, India')).toBe('bengaluru');
    expect(normalizeLocation('BLR')).toBe('bengaluru');
    expect(normalizeLocation('Bengaluru, Karnataka')).toBe('bengaluru');
  });

  it('maps Gurgaon to gurugram', () => {
    expect(normalizeLocation('Gurgaon')).toBe('gurugram');
    expect(normalizeLocation('Gurgaon/Gurugram')).toBe('gurugram');
  });

  it('maps Delhi variants to delhi', () => {
    expect(normalizeLocation('New Delhi')).toBe('delhi');
    expect(normalizeLocation('Delhi NCR')).toBe('delhi');
  });

  it('maps Greater Noida to noida', () => {
    expect(normalizeLocation('Greater Noida')).toBe('noida');
  });

  it('maps every remote synonym to remote', () => {
    for (const s of ['Remote', 'Anywhere', 'Worldwide', 'Work From Home', 'Remote - India']) {
      expect(normalizeLocation(s)).toBe('remote');
    }
  });

  it('returns an empty string for null or blank input', () => {
    expect(normalizeLocation(null)).toBe('');
    expect(normalizeLocation('   ')).toBe('');
  });

  it('lowercases unknown locations rather than discarding them', () => {
    expect(normalizeLocation('Kochi, Kerala')).toBe('kochi kerala');
  });
});

describe('isUnknownLocationToken', () => {
  it('flags locations absent from the alias map', () => {
    expect(isUnknownLocationToken('Kochi, Kerala')).toBe(true);
    expect(isUnknownLocationToken('Bangalore')).toBe(false);
  });
});
```

- [ ] **Step 6: Implement location normalization**

`src/normalize/location.ts`:

```ts
const ALIASES: Record<string, string[]> = {
  bengaluru: ['bengaluru', 'bangalore', 'blr', 'bangaluru'],
  gurugram: ['gurugram', 'gurgaon'],
  delhi: ['delhi', 'new delhi', 'delhi ncr', 'ncr'],
  noida: ['noida', 'greater noida'],
  hyderabad: ['hyderabad', 'secunderabad'],
  pune: ['pune'],
  mumbai: ['mumbai', 'bombay'],
  chennai: ['chennai', 'madras'],
  remote: ['remote', 'anywhere', 'worldwide', 'work from home', 'wfh', 'remote india', 'fully remote', 'distributed'],
};

const LOOKUP = new Map<string, string>();
for (const [canonical, variants] of Object.entries(ALIASES)) {
  for (const v of variants) LOOKUP.set(v, canonical);
}

function clean(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeLocation(raw: string | null): string {
  if (!raw) return '';
  const cleaned = clean(raw);
  if (!cleaned) return '';
  if (LOOKUP.has(cleaned)) return LOOKUP.get(cleaned)!;
  // Longest alias wins, so "greater noida" is not shadowed by "noida".
  const matches = [...LOOKUP.keys()]
    .filter((alias) => new RegExp(`\\b${alias}\\b`).test(cleaned))
    .sort((a, b) => b.length - a.length);
  return matches.length ? LOOKUP.get(matches[0])! : cleaned;
}

export function isUnknownLocationToken(raw: string | null): boolean {
  if (!raw) return false;
  const cleaned = clean(raw);
  if (!cleaned) return false;
  return ![...LOOKUP.keys()].some((alias) => new RegExp(`\\b${alias}\\b`).test(cleaned));
}
```

- [ ] **Step 7: Write and pass the fingerprint test**

`test/normalize/fingerprint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fingerprint } from '../../src/normalize/fingerprint.js';

it('collapses equivalent postings to one fingerprint', () => {
  const a = fingerprint('Acme Corp', 'ML Engineer', 'Bangalore, India');
  const b = fingerprint('acme corp.', 'Machine Learning Engineer', 'Bengaluru');
  expect(a).toBe(b);
});

it('distinguishes different roles at the same company', () => {
  expect(fingerprint('Acme', 'Data Analyst', 'Remote'))
    .not.toBe(fingerprint('Acme', 'Data Engineer', 'Remote'));
});

it('distinguishes the same role at different companies', () => {
  expect(fingerprint('Acme', 'Data Analyst', 'Remote'))
    .not.toBe(fingerprint('Beta', 'Data Analyst', 'Remote'));
});

it('produces a stable 64-char hex digest', () => {
  expect(fingerprint('Acme', 'Data Analyst', null)).toMatch(/^[a-f0-9]{64}$/);
});
```

`src/normalize/fingerprint.ts`:

```ts
import { createHash } from 'node:crypto';
import { normalizeTitle } from './title.js';
import { normalizeLocation } from './location.js';

const COMPANY_SUFFIX = /\b(inc|llc|ltd|limited|pvt|private|corp|corporation|co|gmbh|technologies|technology|labs|software)\b/g;

export function normalizeCompany(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprint(company: string, title: string, location: string | null): string {
  const parts = [normalizeCompany(company), normalizeTitle(title), normalizeLocation(location)];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
```

- [ ] **Step 8: Run the full normalize suite**

Run: `npx vitest run test/normalize`
Expected: PASS — all title, location and fingerprint tests

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: title/location normalization and fingerprinting"
```

---

## Task 4: Greenhouse source

**Files:**
- Create: `src/sources/types.ts`, `src/sources/http.ts`, `src/sources/greenhouse.ts`
- Create: `test/fixtures/greenhouse-board.json`
- Test: `test/sources/greenhouse.test.ts`

**Interfaces:**
- Consumes: `AtsPlatform`, `BoardRow`, `normalizeTitle`, `normalizeLocation`, `fingerprint`
- Produces:
  - `interface RawJob { sourceJobId, url, company, title, location, postedAt, jdText, atsPlatform }`
  - `interface SourceResult { jobs: RawJob[]; ok: boolean; error?: string }`
  - `interface JobSource { name: string; platform: AtsPlatform; fetchJobs(board: BoardRow): Promise<SourceResult> }`
  - `greenhouseSource: JobSource`
  - `fetchJson(url: string, init?: RequestInit): Promise<unknown>` (throws `HttpError` with `.status`)

- [ ] **Step 1: Define the source contract**

`src/sources/types.ts`:

```ts
import type { AtsPlatform } from '../config/schema.js';
import type { BoardRow } from '../db/types.js';

export interface RawJob {
  sourceJobId: string;
  url: string;
  company: string;
  title: string;
  location: string | null;
  postedAt: string | null;
  jdText: string;
  atsPlatform: AtsPlatform;
}

export interface SourceResult {
  jobs: RawJob[];
  ok: boolean;
  error?: string;
}

export interface JobSource {
  name: string;
  platform: AtsPlatform;
  fetchJobs(board: BoardRow): Promise<SourceResult>;
}
```

`src/sources/http.ts`:

```ts
export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'user-agent': 'job-pipeline/1.0', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.json();
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': 'job-pipeline/1.0', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.text();
}

/** Strips HTML tags and decodes the entities Greenhouse/Lever actually emit. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 2: Save the fixture**

`test/fixtures/greenhouse-board.json` — trimmed shape of the real
`boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` response:

```json
{
  "jobs": [
    {
      "id": 4012345,
      "title": "Data Analyst (Bengaluru)",
      "absolute_url": "https://boards.greenhouse.io/acme/jobs/4012345",
      "updated_at": "2026-07-30T09:15:00-04:00",
      "location": { "name": "Bangalore, India" },
      "content": "&lt;p&gt;We are hiring a Data Analyst.&lt;/p&gt;&lt;p&gt;0-2 years of experience. SQL, Python, Tableau.&lt;/p&gt;"
    },
    {
      "id": 4012346,
      "title": "Senior ML Engineer",
      "absolute_url": "https://boards.greenhouse.io/acme/jobs/4012346",
      "updated_at": "2026-07-28T09:15:00-04:00",
      "location": { "name": "Remote" },
      "content": "&lt;p&gt;5+ years building ML systems.&lt;/p&gt;"
    }
  ],
  "meta": { "total": 2 }
}
```

- [ ] **Step 3: Write the failing test**

`test/sources/greenhouse.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { greenhouseSource } from '../../src/sources/greenhouse.js';
import type { BoardRow } from '../../src/db/types.js';

const board: BoardRow = {
  id: 1, ats_platform: 'greenhouse', board_token: 'acme', company_name: 'Acme',
  discovered_via: 'manual', discovered_at: '2026-08-01T00:00:00.000Z',
  last_polled_at: null, active: 1,
};

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('greenhouseSource', () => {
  it('maps the board response into RawJobs', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/greenhouse-board.json', 'utf8')));
    const result = await greenhouseSource.fetchJobs(board);

    expect(result.ok).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({
      sourceJobId: '4012345',
      url: 'https://boards.greenhouse.io/acme/jobs/4012345',
      company: 'Acme',
      title: 'Data Analyst (Bengaluru)',
      location: 'Bangalore, India',
      atsPlatform: 'greenhouse',
    });
  });

  it('converts updated_at to an ISO-8601 UTC string', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/greenhouse-board.json', 'utf8')));
    const { jobs } = await greenhouseSource.fetchJobs(board);
    expect(jobs[0].postedAt).toBe('2026-07-30T13:15:00.000Z');
  });

  it('strips HTML from the JD content', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/greenhouse-board.json', 'utf8')));
    const { jobs } = await greenhouseSource.fetchJobs(board);
    expect(jobs[0].jdText).toContain('0-2 years of experience');
    expect(jobs[0].jdText).not.toContain('<p>');
  });

  it('reports failure without throwing when the board 404s', async () => {
    mockFetch({ error: 'not found' }, 404);
    const result = await greenhouseSource.fetchJobs(board);
    expect(result.ok).toBe(false);
    expect(result.jobs).toEqual([]);
    expect(result.error).toContain('404');
  });

  it('returns an empty successful result for a board with no jobs', async () => {
    mockFetch({ jobs: [] });
    const result = await greenhouseSource.fetchJobs(board);
    expect(result.ok).toBe(true);
    expect(result.jobs).toEqual([]);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run test/sources/greenhouse.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Implement the source**

`src/sources/greenhouse.ts`:

```ts
import { fetchJson, htmlToText } from './http.js';
import type { JobSource, RawJob, SourceResult } from './types.js';
import type { BoardRow } from '../db/types.js';

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string;
}

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const greenhouseSource: JobSource = {
  name: 'greenhouse',
  platform: 'greenhouse',

  async fetchJobs(board: BoardRow): Promise<SourceResult> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.board_token)}/jobs?content=true`;
    try {
      const body = (await fetchJson(url)) as { jobs?: GhJob[] };
      const jobs: RawJob[] = (body.jobs ?? []).map((j) => ({
        sourceJobId: String(j.id),
        url: j.absolute_url,
        company: board.company_name,
        title: j.title,
        location: j.location?.name ?? null,
        postedAt: toIso(j.updated_at),
        jdText: htmlToText(j.content ?? ''),
        atsPlatform: 'greenhouse',
      }));
      return { jobs, ok: true };
    } catch (err) {
      return { jobs: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `npx vitest run test/sources/greenhouse.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: greenhouse board source with fixture tests"
```

---

## Task 5: Minimum-years extraction

This is the highest-consequence rule in the system. At `max_years_required: 0`
it alone determines feed size, so it gets its own task and its own suite.

**Files:**
- Create: `src/score/years.ts`
- Test: `test/score/years.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `extractMinYears(jdText: string): number` — the LOWER bound of the JD's stated requirement; `0` when unstated or when the JD is explicitly fresher-facing.

- [ ] **Step 1: Write the failing test**

`test/score/years.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractMinYears } from '../../src/score/years.js';

describe('extractMinYears — ranges take the lower bound', () => {
  const cases: [string, number][] = [
    ['0-2 years of experience', 0],
    ['0 - 2 years of experience', 0],
    ['0 to 2 years of experience', 0],
    ['0–2 years experience', 0],
    ['1-3 years of experience required', 1],
    ['2-4 years of relevant experience', 2],
    ['3 to 5 years in data science', 3],
  ];
  it.each(cases)('%s → %i', (jd, expected) => {
    expect(extractMinYears(jd)).toBe(expected);
  });
});

describe('extractMinYears — minimums', () => {
  const cases: [string, number][] = [
    ['1+ years of experience', 1],
    ['2+ yrs experience', 2],
    ['minimum 3 years of experience', 3],
    ['at least 2 years of experience', 2],
    ['3 years preferred', 3],
    ['5 years of industry experience', 5],
  ];
  it.each(cases)('%s → %i', (jd, expected) => {
    expect(extractMinYears(jd)).toBe(expected);
  });
});

describe('extractMinYears — fresher-facing and unstated JDs are 0', () => {
  const cases: string[] = [
    'up to 2 years of experience',
    'less than 2 years of experience',
    'We are hiring freshers for our analytics team',
    'Recent graduates encouraged to apply',
    'New grad role, 2026 batch',
    'Entry level position on the data team',
    'Internship experience welcome',
    'We build data pipelines with Python and dbt.',
    '',
  ];
  it.each(cases)('"%s" → 0', (jd) => {
    expect(extractMinYears(jd)).toBe(0);
  });
});

describe('extractMinYears — traps', () => {
  it('ignores years that are not about experience', () => {
    expect(extractMinYears('Founded 10 years ago. We ship fast.')).toBe(0);
  });

  it('ignores degree durations', () => {
    expect(extractMinYears('A 4 year degree in Computer Science is required.')).toBe(0);
  });

  it('takes the lowest requirement when several are stated', () => {
    expect(extractMinYears('5+ years for senior roles; 1+ years for associate roles')).toBe(1);
  });

  it('lets an explicit fresher signal override a stated minimum', () => {
    expect(extractMinYears('Freshers welcome. 1+ years preferred but not required.')).toBe(0);
  });

  it('is case insensitive', () => {
    expect(extractMinYears('MINIMUM 2 YEARS OF EXPERIENCE')).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/score/years.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the extractor**

`src/score/years.ts`:

```ts
/** Words that must appear near a number for it to count as an experience requirement. */
const EXPERIENCE_CONTEXT = /(experience|exp\b|working|industry|professional|hands[- ]on|building|in\s+(data|ml|ai|analytics|software))/i;

const FRESHER_SIGNALS = [
  /\bfresher(s)?\b/i,
  /\brecent graduate(s)?\b/i,
  /\bnew grad(uate)?s?\b/i,
  /\bentry[- ]level\b/i,
  /\bcampus hire\b/i,
  /\b\d{4} batch\b/i,
  /\binternship experience\b/i,
  /\bno prior experience\b/i,
];

/** "up to 2 years", "less than 2 years" — an upper bound, so the minimum is 0. */
const UPPER_BOUND_ONLY = /\b(up to|less than|under|fewer than|maximum(?: of)?|max)\s+\d+\s*(\+)?\s*(years?|yrs?)/i;

const RANGE = /\b(\d{1,2})\s*(?:-|–|—|\s+to\s+)\s*(\d{1,2})\s*(?:\+)?\s*(years?|yrs?)/gi;
const MINIMUM = /\b(?:minimum(?:\s+of)?|at least|min\.?)\s+(\d{1,2})\s*(?:\+)?\s*(years?|yrs?)/gi;
const PLUS = /\b(\d{1,2})\s*\+\s*(years?|yrs?)/gi;
const BARE = /\b(\d{1,2})\s*(years?|yrs?)\b/gi;

const DEGREE = /\b\d{1,2}[\s-]*year[\s-]*(degree|program|course|b\.?tech|bachelor)/i;

function windowAround(text: string, index: number, radius = 60): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
}

function collect(text: string, pattern: RegExp, group: number): number[] {
  const found: number[] = [];
  pattern.lastIndex = 0;
  for (const m of text.matchAll(pattern)) {
    const context = windowAround(text, m.index ?? 0);
    if (DEGREE.test(context)) continue;
    if (!EXPERIENCE_CONTEXT.test(context)) continue;
    const n = Number(m[group]);
    if (Number.isFinite(n) && n >= 0 && n <= 40) found.push(n);
  }
  return found;
}

export function extractMinYears(jdText: string): number {
  if (!jdText) return 0;
  const text = jdText.toLowerCase();

  if (FRESHER_SIGNALS.some((re) => re.test(text))) return 0;
  if (UPPER_BOUND_ONLY.test(text)) return 0;

  const candidates = [
    ...collect(text, RANGE, 1),
    ...collect(text, MINIMUM, 1),
    ...collect(text, PLUS, 1),
    ...collect(text, BARE, 1),
  ];

  return candidates.length ? Math.min(...candidates) : 0;
}
```

- [ ] **Step 4: Run it and confirm every case passes**

Run: `npx vitest run test/score/years.test.ts`
Expected: PASS — all 27 cases

If any case fails, fix `src/score/years.ts` — never weaken the test. These
phrasings were taken from real postings and each one represents jobs that
would otherwise be wrongly included or excluded.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: minimum-years extraction with real-phrasing test suite"
```

---

## Task 6: Skill extraction, hard filters and scoring

**Files:**
- Create: `src/score/extract.ts`, `src/score/filters.ts`, `src/score/score.ts`
- Create: `resume/skills.example.json`
- Test: `test/score/extract.test.ts`, `test/score/filters.test.ts`, `test/score/score.test.ts`

**Interfaces:**
- Consumes: `extractMinYears`, `normalizeTitle`, `normalizeLocation`, `titleSimilarity`, `Criteria`
- Produces:
  - `type SkillDict = Record<string, string[]>` (canonical → aliases)
  - `extractSkills(jdText: string, dict: SkillDict): string[]` (canonical names, deduped)
  - `hasFresherSignal(jdText: string): boolean`
  - `type FilterVerdict = { pass: true } | { pass: false; status: 'stale' | 'skipped'; reason: string }`
  - `applyHardFilters(input: FilterInput, criteria: Criteria, now: Date): FilterVerdict`
  - `scoreJob(input: ScoreInput, criteria: Criteria): number` (0–100)

- [ ] **Step 1: Write the failing extraction test**

`test/score/extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractSkills, hasFresherSignal } from '../../src/score/extract.js';

const dict = {
  python: ['python', 'py'],
  sql: ['sql', 'postgresql', 'mysql'],
  'machine learning': ['machine learning', 'ml'],
  pytorch: ['pytorch', 'torch'],
  tableau: ['tableau'],
  kubernetes: ['kubernetes', 'k8s'],
};

describe('extractSkills', () => {
  it('finds canonical names and aliases', () => {
    const jd = 'You will write Python and SQL, and deploy models with k8s.';
    expect(extractSkills(jd, dict).sort()).toEqual(['kubernetes', 'python', 'sql']);
  });

  it('deduplicates when several aliases of one skill appear', () => {
    expect(extractSkills('We use ML. Machine learning is core.', dict)).toEqual(['machine learning']);
  });

  it('matches whole words only', () => {
    expect(extractSkills('We use pythonic idioms and SQLite.', dict)).toEqual([]);
  });

  it('is case insensitive', () => {
    expect(extractSkills('PYTORCH and Tableau', dict).sort()).toEqual(['pytorch', 'tableau']);
  });

  it('returns an empty array for an empty JD', () => {
    expect(extractSkills('', dict)).toEqual([]);
  });
});

describe('hasFresherSignal', () => {
  it.each([
    'Freshers welcome',
    'This is an entry-level role',
    'New grad, 2026 batch',
    'Campus hire program',
    '0-1 years of experience',
    'Internship experience welcome',
  ])('detects "%s"', (jd) => expect(hasFresherSignal(jd)).toBe(true));

  it('returns false for a senior JD', () => {
    expect(hasFresherSignal('5+ years leading ML teams')).toBe(false);
  });
});
```

- [ ] **Step 2: Implement extraction**

`src/score/extract.ts`:

```ts
export type SkillDict = Record<string, string[]>;

const FRESHER_SIGNALS = [
  /\bfresher(s)?\b/i,
  /\bentry[- ]level\b/i,
  /\bnew grad(uate)?s?\b/i,
  /\brecent graduate(s)?\b/i,
  /\bcampus hire\b/i,
  /\b\d{4} batch\b/i,
  /\b0\s*(?:-|–|to)\s*[12]\s*(years?|yrs?)/i,
  /\binternship experience\b/i,
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractSkills(jdText: string, dict: SkillDict): string[] {
  if (!jdText) return [];
  const text = jdText.toLowerCase();
  const found = new Set<string>();

  for (const [canonical, aliases] of Object.entries(dict)) {
    for (const alias of [canonical, ...aliases]) {
      const re = new RegExp(`(?<![a-z0-9])${escapeRegex(alias.toLowerCase())}(?![a-z0-9])`);
      if (re.test(text)) {
        found.add(canonical);
        break;
      }
    }
  }
  return [...found];
}

export function hasFresherSignal(jdText: string): boolean {
  return FRESHER_SIGNALS.some((re) => re.test(jdText));
}
```

- [ ] **Step 3: Write the failing filter test**

`test/score/filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyHardFilters } from '../../src/score/filters.js';
import type { Criteria } from '../../src/config/schema.js';

const criteria: Criteria = {
  titles: { include: ['data analyst', 'machine learning engineer'], exclude: ['senior', 'principal', 'director'] },
  experience: { max_years_required: 0 },
  locations: { include: ['bengaluru', 'delhi', 'gurugram', 'noida', 'remote'] },
  freshness: { max_posted_age_days: 7, verify_open_before_submit: true },
  scoring: { threshold: 60 },
  limits: { daily_cap: 30, per_company_open_applications: 3, min_delay_seconds: 45, max_delay_seconds: 120 },
  submission: { dry_run: true },
};

const NOW = new Date('2026-08-01T00:00:00.000Z');
const base = {
  title: 'Data Analyst',
  location: 'Bangalore, India',
  postedAt: '2026-07-30T00:00:00.000Z',
  firstSeenAt: '2026-07-30T00:00:00.000Z',
  jdText: '0-2 years of experience with SQL',
};

describe('applyHardFilters', () => {
  it('passes a fresh, in-scope, fresher-eligible job', () => {
    expect(applyHardFilters(base, criteria, NOW)).toEqual({ pass: true });
  });

  it('rejects a posting older than max_posted_age_days as stale', () => {
    const v = applyHardFilters({ ...base, postedAt: '2026-07-01T00:00:00.000Z' }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'stale' });
  });

  it('falls back to firstSeenAt when postedAt is null', () => {
    const v = applyHardFilters(
      { ...base, postedAt: null, firstSeenAt: '2026-06-01T00:00:00.000Z' }, criteria, NOW,
    );
    expect(v).toMatchObject({ pass: false, status: 'stale' });
  });

  it('rejects a job whose minimum years exceeds the cap', () => {
    const v = applyHardFilters({ ...base, jdText: '2+ years of experience' }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'skipped' });
    expect(v).toHaveProperty('reason', expect.stringContaining('years'));
  });

  it('rejects an excluded title', () => {
    const v = applyHardFilters({ ...base, title: 'Senior Data Analyst' }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'skipped' });
  });

  it('rejects a title outside the include family', () => {
    const v = applyHardFilters({ ...base, title: 'Backend Engineer' }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'skipped' });
  });

  it('accepts a title matching an include term after normalization', () => {
    expect(applyHardFilters({ ...base, title: 'ML Engineer' }, criteria, NOW)).toEqual({ pass: true });
  });

  it('rejects an out-of-scope location', () => {
    const v = applyHardFilters({ ...base, location: 'Hyderabad' }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'skipped' });
  });

  it('accepts remote synonyms', () => {
    expect(applyHardFilters({ ...base, location: 'Anywhere' }, criteria, NOW)).toEqual({ pass: true });
  });

  it('rejects a job with no location when no include term matches', () => {
    const v = applyHardFilters({ ...base, location: null }, criteria, NOW);
    expect(v).toMatchObject({ pass: false, status: 'skipped' });
  });
});
```

- [ ] **Step 4: Implement the filters**

`src/score/filters.ts`:

```ts
import type { Criteria } from '../config/schema.js';
import { normalizeTitle } from '../normalize/title.js';
import { normalizeLocation } from '../normalize/location.js';
import { extractMinYears } from './years.js';

export interface FilterInput {
  title: string;
  location: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  jdText: string;
}

export type FilterVerdict =
  | { pass: true }
  | { pass: false; status: 'stale' | 'skipped'; reason: string };

const DAY_MS = 86_400_000;

export function applyHardFilters(input: FilterInput, criteria: Criteria, now: Date): FilterVerdict {
  const effectiveDate = new Date(input.postedAt ?? input.firstSeenAt);
  const ageDays = (now.getTime() - effectiveDate.getTime()) / DAY_MS;
  if (ageDays > criteria.freshness.max_posted_age_days) {
    return { pass: false, status: 'stale', reason: `posted ${Math.round(ageDays)}d ago` };
  }

  const minYears = extractMinYears(input.jdText);
  if (minYears > criteria.experience.max_years_required) {
    return { pass: false, status: 'skipped', reason: `requires ${minYears} years` };
  }

  const title = normalizeTitle(input.title);
  const excluded = criteria.titles.exclude.find((t) => title.includes(normalizeTitle(t)));
  if (excluded) {
    return { pass: false, status: 'skipped', reason: `excluded title term "${excluded}"` };
  }
  if (!criteria.titles.include.some((t) => title.includes(normalizeTitle(t)))) {
    return { pass: false, status: 'skipped', reason: `title "${input.title}" outside target family` };
  }

  const location = normalizeLocation(input.location);
  if (!criteria.locations.include.some((l) => location === normalizeLocation(l))) {
    return { pass: false, status: 'skipped', reason: `location "${input.location ?? 'unknown'}" out of scope` };
  }

  return { pass: true };
}
```

- [ ] **Step 5: Write the failing score test**

`test/score/score.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreJob } from '../../src/score/score.js';

const resumeSkills = ['python', 'sql', 'pandas', 'machine learning', 'tableau'];

const base = {
  title: 'Data Analyst',
  jdSkills: ['python', 'sql', 'tableau'],
  jdText: 'Analyse data with Python and SQL.',
  targetTitles: ['data analyst', 'data engineer'],
};

describe('scoreJob', () => {
  it('scores full skill overlap and an exact title match near 100', () => {
    expect(scoreJob({ ...base, resumeSkills }, 60)).toBeGreaterThanOrEqual(90);
  });

  it('scores zero skill overlap low', () => {
    const s = scoreJob({ ...base, jdSkills: ['rust', 'kubernetes', 'terraform'], resumeSkills }, 60);
    expect(s).toBeLessThan(60);
  });

  it('adds weight for an explicit fresher signal', () => {
    const plain = scoreJob({ ...base, resumeSkills }, 60);
    const fresher = scoreJob({ ...base, resumeSkills, jdText: 'Freshers welcome. Python and SQL.' }, 60);
    expect(fresher).toBeGreaterThan(plain);
  });

  it('never exceeds 100', () => {
    expect(scoreJob({
      ...base, resumeSkills, jdText: 'Freshers welcome, entry level, new grad. Python SQL Tableau.',
    }, 60)).toBeLessThanOrEqual(100);
  });

  it('never returns a negative score', () => {
    expect(scoreJob({
      title: 'Quantum Chemist', jdSkills: [], jdText: '', targetTitles: ['data analyst'], resumeSkills: [],
    }, 60)).toBeGreaterThanOrEqual(0);
  });

  it('rewards a closer title match', () => {
    const near = scoreJob({ ...base, resumeSkills, title: 'Data Analyst' }, 60);
    const far = scoreJob({ ...base, resumeSkills, title: 'Data Analyst Intern Trainee Associate' }, 60);
    expect(near).toBeGreaterThan(far);
  });
});
```

- [ ] **Step 6: Implement scoring**

`src/score/score.ts`:

```ts
import { titleSimilarity } from '../normalize/title.js';
import { hasFresherSignal } from './extract.js';

export interface ScoreInput {
  title: string;
  jdSkills: string[];
  jdText: string;
  resumeSkills: string[];
  targetTitles: string[];
}

const WEIGHT_SKILLS = 60;
const WEIGHT_TITLE = 30;
const WEIGHT_FRESHER = 10;

export function scoreJob(input: ScoreInput, _threshold: number): number {
  const resume = new Set(input.resumeSkills.map((s) => s.toLowerCase()));
  const overlap = input.jdSkills.filter((s) => resume.has(s.toLowerCase())).length;
  const skillScore = input.jdSkills.length === 0 ? 0 : (overlap / input.jdSkills.length) * WEIGHT_SKILLS;

  const bestTitle = input.targetTitles.reduce(
    (best, t) => Math.max(best, titleSimilarity(input.title, t)), 0,
  );
  const titleScore = bestTitle * WEIGHT_TITLE;

  const fresherScore = hasFresherSignal(input.jdText) ? WEIGHT_FRESHER : 0;

  return Math.max(0, Math.min(100, Math.round(skillScore + titleScore + fresherScore)));
}
```

- [ ] **Step 7: Create the example skills file**

`resume/skills.example.json`:

```json
{
  "python": ["python", "py"],
  "sql": ["sql", "postgresql", "mysql", "t-sql"],
  "pandas": ["pandas"],
  "numpy": ["numpy"],
  "scikit-learn": ["scikit-learn", "sklearn"],
  "machine learning": ["machine learning", "ml"],
  "deep learning": ["deep learning", "dl"],
  "pytorch": ["pytorch", "torch"],
  "tensorflow": ["tensorflow", "tf"],
  "nlp": ["nlp", "natural language processing"],
  "llm": ["llm", "large language model", "gpt", "transformers"],
  "power bi": ["power bi", "powerbi"],
  "tableau": ["tableau"],
  "excel": ["excel", "advanced excel"],
  "git": ["git", "github"],
  "docker": ["docker"],
  "aws": ["aws", "amazon web services"],
  "airflow": ["airflow", "apache airflow"],
  "spark": ["spark", "pyspark", "apache spark"]
}
```

- [ ] **Step 8: Run the whole score suite**

Run: `npx vitest run test/score`
Expected: PASS — years, extract, filters and score tests

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: skill extraction, hard filters and weighted scoring"
```

---

## Task 7: Resume model and deterministic bullet preselection

**Files:**
- Create: `src/tailor/resume.ts`, `src/tailor/select.ts`
- Create: `resume/profile.example.json`, `resume/experience.example.json`, `resume/education.example.json`
- Test: `test/tailor/select.test.ts`

**Interfaces:**
- Consumes: `SkillDict`
- Produces:
  - `interface Bullet { id: string; text: string; skills: string[] }`
  - `interface ExperienceEntry { id: string; kind: 'internship' | 'project' | 'work' | 'coursework'; org: string; role: string; start: string; end: string; bullets: Bullet[] }`
  - `interface Profile { name, email, phone, location, links }`
  - `loadResume(dir: string): { profile: Profile; experience: ExperienceEntry[]; skills: SkillDict; education: EducationEntry[] }`
  - `selectEntries(experience: ExperienceEntry[], jdSkills: string[], limit: number): ExperienceEntry[]`
  - `selectBullets(entry: ExperienceEntry, jdSkills: string[], limit: number): Bullet[]`

- [ ] **Step 1: Write the example resume files**

`resume/profile.example.json`:

```json
{
  "name": "Example Candidate",
  "email": "example.apply@gmail.com",
  "phone": "+91 90000 00000",
  "location": "Bengaluru, India",
  "links": { "linkedin": "https://linkedin.com/in/example", "github": "https://github.com/example" }
}
```

`resume/experience.example.json` — note `kind` distinguishes internships and
projects, both of which are first-class here:

```json
[
  {
    "id": "intern-acme",
    "kind": "internship",
    "org": "Acme Analytics",
    "role": "Data Analyst Intern",
    "start": "2025-06",
    "end": "2025-12",
    "bullets": [
      { "id": "a1", "text": "Built SQL pipelines aggregating 12M rows of transaction data into daily reporting tables", "skills": ["sql"] },
      { "id": "a2", "text": "Automated a weekly Excel report in Python, cutting manual effort from 6 hours to 10 minutes", "skills": ["python", "excel"] },
      { "id": "a3", "text": "Built Tableau dashboards tracking retention across 4 customer segments", "skills": ["tableau"] },
      { "id": "a4", "text": "Wrote pandas transformations to clean and deduplicate a 2M-row customer table", "skills": ["python", "pandas"] },
      { "id": "a5", "text": "Investigated a reporting discrepancy and traced it to a timezone bug in the ETL job", "skills": ["sql"] },
      { "id": "a6", "text": "Presented weekly findings to a team of 8 including two product managers", "skills": [] },
      { "id": "a7", "text": "Documented 15 recurring queries into a shared runbook used by the analytics team", "skills": ["sql"] },
      { "id": "a8", "text": "Added data quality checks that caught 3 upstream schema changes before release", "skills": ["python"] }
    ]
  },
  {
    "id": "proj-churn",
    "kind": "project",
    "org": "Personal Project",
    "role": "Churn Prediction Model",
    "start": "2025-01",
    "end": "2025-04",
    "bullets": [
      { "id": "b1", "text": "Trained a gradient boosting churn classifier reaching 0.87 ROC-AUC on held-out data", "skills": ["machine learning", "scikit-learn"] },
      { "id": "b2", "text": "Engineered 24 behavioural features from raw event logs using pandas", "skills": ["python", "pandas"] },
      { "id": "b3", "text": "Compared logistic regression, random forest and XGBoost across 5-fold cross-validation", "skills": ["machine learning", "scikit-learn"] },
      { "id": "b4", "text": "Deployed the model behind a FastAPI endpoint containerised with Docker", "skills": ["python", "docker"] },
      { "id": "b5", "text": "Wrote a SHAP-based explanation layer surfacing the top 5 drivers per prediction", "skills": ["machine learning"] },
      { "id": "b6", "text": "Set up MLflow to track 40+ experiment runs and their hyperparameters", "skills": ["machine learning"] },
      { "id": "b7", "text": "Documented the full pipeline in a README with reproducible setup steps", "skills": ["git"] },
      { "id": "b8", "text": "Reduced inference latency from 340ms to 45ms by batching feature lookups", "skills": ["python"] }
    ]
  }
]
```

`resume/education.example.json`:

```json
[
  {
    "id": "btech",
    "institution": "Example Institute of Technology",
    "degree": "B.Tech, Computer Science",
    "start": "2021",
    "end": "2025",
    "detail": "CGPA 8.4/10"
  }
]
```

- [ ] **Step 2: Write the failing test**

`test/tailor/select.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectEntries, selectBullets } from '../../src/tailor/select.js';
import type { ExperienceEntry } from '../../src/tailor/resume.js';

const entries: ExperienceEntry[] = [
  {
    id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
    start: '2025-06', end: '2025-12',
    bullets: [
      { id: 'a1', text: 'SQL pipelines', skills: ['sql'] },
      { id: 'a2', text: 'Python automation', skills: ['python'] },
      { id: 'a3', text: 'Tableau dashboards', skills: ['tableau'] },
      { id: 'a4', text: 'Stakeholder updates', skills: [] },
    ],
  },
  {
    id: 'e2', kind: 'project', org: 'Personal', role: 'Churn Model',
    start: '2025-01', end: '2025-04',
    bullets: [
      { id: 'b1', text: 'Gradient boosting classifier', skills: ['machine learning'] },
      { id: 'b2', text: 'Feature engineering', skills: ['pandas'] },
      { id: 'b3', text: 'Docker deployment', skills: ['docker'] },
    ],
  },
];

describe('selectEntries', () => {
  it('ranks the entry with more JD-relevant skills first', () => {
    const picked = selectEntries(entries, ['machine learning', 'docker'], 2);
    expect(picked[0].id).toBe('e2');
  });

  it('honours the limit', () => {
    expect(selectEntries(entries, ['sql'], 1)).toHaveLength(1);
  });

  it('returns entries even when nothing matches, so the resume is never empty', () => {
    const picked = selectEntries(entries, ['rust'], 2);
    expect(picked).toHaveLength(2);
  });

  it('treats projects and internships equally when ranking', () => {
    expect(selectEntries(entries, ['docker'], 1)[0].kind).toBe('project');
  });
});

describe('selectBullets', () => {
  it('puts JD-matching bullets first', () => {
    const picked = selectBullets(entries[0], ['tableau'], 4);
    expect(picked[0].id).toBe('a3');
  });

  it('honours the limit', () => {
    expect(selectBullets(entries[0], ['sql'], 2)).toHaveLength(2);
  });

  it('includes non-matching bullets as filler when the limit allows', () => {
    expect(selectBullets(entries[0], ['sql'], 4).map((b) => b.id)).toContain('a4');
  });

  it('never returns more bullets than the entry has', () => {
    expect(selectBullets(entries[1], ['docker'], 99)).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run test/tailor/select.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement the resume model**

`src/tailor/resume.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { SkillDict } from '../score/extract.js';

export const BulletSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  skills: z.array(z.string()).default([]),
});
export type Bullet = z.infer<typeof BulletSchema>;

export const ExperienceEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['internship', 'project', 'work', 'coursework']),
  org: z.string(),
  role: z.string(),
  start: z.string(),
  end: z.string(),
  bullets: z.array(BulletSchema).min(1),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

export const ProfileSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  phone: z.string(),
  location: z.string(),
  links: z.record(z.string(), z.string()).default({}),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const EducationEntrySchema = z.object({
  id: z.string(),
  institution: z.string(),
  degree: z.string(),
  start: z.string(),
  end: z.string(),
  detail: z.string().default(''),
});
export type EducationEntry = z.infer<typeof EducationEntrySchema>;

export interface Resume {
  profile: Profile;
  experience: ExperienceEntry[];
  skills: SkillDict;
  education: EducationEntry[];
}

function readJson<T>(dir: string, file: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  if (!parsed.success) {
    throw new Error(`Invalid ${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

export function loadResume(dir = 'resume'): Resume {
  return {
    profile: readJson(dir, 'profile.json', ProfileSchema),
    experience: readJson(dir, 'experience.json', z.array(ExperienceEntrySchema).min(1)),
    skills: readJson(dir, 'skills.json', z.record(z.string(), z.array(z.string()))),
    education: readJson(dir, 'education.json', z.array(EducationEntrySchema)),
  };
}

/** Every bullet across every entry — used by the anti-fabrication gate. */
export function allBullets(experience: ExperienceEntry[]): Bullet[] {
  return experience.flatMap((e) => e.bullets);
}
```

- [ ] **Step 5: Implement selection**

`src/tailor/select.ts`:

```ts
import type { Bullet, ExperienceEntry } from './resume.js';

function relevance(skills: string[], jdSkills: string[]): number {
  const wanted = new Set(jdSkills.map((s) => s.toLowerCase()));
  return skills.filter((s) => wanted.has(s.toLowerCase())).length;
}

export function selectEntries(
  experience: ExperienceEntry[], jdSkills: string[], limit: number,
): ExperienceEntry[] {
  return [...experience]
    .map((entry, index) => ({
      entry,
      index,
      score: entry.bullets.reduce((sum, b) => sum + relevance(b.skills, jdSkills), 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.entry);
}

export function selectBullets(
  entry: ExperienceEntry, jdSkills: string[], limit: number,
): Bullet[] {
  return [...entry.bullets]
    .map((bullet, index) => ({ bullet, index, score: relevance(bullet.skills, jdSkills) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.bullet);
}
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `npx vitest run test/tailor/select.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 7: Copy the examples into working resume files**

These are placeholders so the pipeline runs end-to-end before the real
resume arrives. They are replaced wholesale in Task 16.

```bash
cp resume/profile.example.json resume/profile.json
cp resume/experience.example.json resume/experience.json
cp resume/education.example.json resume/education.json
cp resume/skills.example.json resume/skills.json
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: resume model and deterministic bullet preselection"
```

---

## Task 8: Gemini tailoring call and anti-fabrication gate

**Files:**
- Create: `src/tailor/llm.ts`, `src/tailor/verify.ts`
- Test: `test/tailor/llm.test.ts`, `test/tailor/verify.test.ts`

**Interfaces:**
- Consumes: `Bullet`, `ExperienceEntry`, `selectEntries`, `selectBullets`
- Produces:
  - `interface TailorRequest { jdSkills: string[]; jobTitle: string; entries: ExperienceEntry[] }`
  - `interface TailoredEntry { id: string; bullets: { id: string; text: string }[] }`
  - `interface TailorResponse { entries: TailoredEntry[]; summary: string }`
  - `buildPrompt(req: TailorRequest): string`
  - `tailor(req: TailorRequest, deps?: { call?: LlmCall }): Promise<TailorResponse>` — validates, retries once, throws `TailorError` on second failure
  - `type LlmCall = (prompt: string) => Promise<string>`
  - `verifyNoFabrication(res: TailorResponse, source: ExperienceEntry[]): { ok: boolean; offending: string[] }`

- [ ] **Step 1: Write the failing verify test**

The gate is written first because it is the hard safety boundary.

`test/tailor/verify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { verifyNoFabrication } from '../../src/tailor/verify.js';
import type { ExperienceEntry } from '../../src/tailor/resume.js';

const source: ExperienceEntry[] = [
  {
    id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
    start: '2025-06', end: '2025-12',
    bullets: [
      { id: 'a1', text: 'Built SQL pipelines aggregating 12M rows of transaction data', skills: ['sql'] },
      { id: 'a2', text: 'Automated a weekly Excel report in Python, cutting 6 hours to 10 minutes', skills: ['python'] },
    ],
  },
];

describe('verifyNoFabrication', () => {
  it('accepts verbatim bullets', () => {
    const res = { entries: [{ id: 'e1', bullets: [{ id: 'a1', text: source[0].bullets[0].text }] }], summary: '' };
    expect(verifyNoFabrication(res, source).ok).toBe(true);
  });

  it('accepts light rewording that preserves the substance', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL data pipelines aggregating 12M rows of transaction data' }] }],
      summary: '',
    };
    expect(verifyNoFabrication(res, source).ok).toBe(true);
  });

  it('rejects an invented bullet', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Led a team of 12 engineers at Google for three years' }] }],
      summary: '',
    };
    const v = verifyNoFabrication(res, source);
    expect(v.ok).toBe(false);
    expect(v.offending[0]).toContain('Led a team');
  });

  it('rejects a bullet whose id does not exist in the source', () => {
    const res = { entries: [{ id: 'e1', bullets: [{ id: 'ZZZ', text: 'Anything at all' }] }], summary: '' };
    expect(verifyNoFabrication(res, source).ok).toBe(false);
  });

  it('rejects an entry id that does not exist in the source', () => {
    const res = { entries: [{ id: 'ghost', bullets: [{ id: 'a1', text: source[0].bullets[0].text }] }], summary: '' };
    expect(verifyNoFabrication(res, source).ok).toBe(false);
  });

  it('rejects an inflated metric', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL pipelines aggregating 12B rows of transaction data' }] }],
      summary: '',
    };
    expect(verifyNoFabrication(res, source).ok).toBe(false);
  });

  it('lists every offending bullet, not just the first', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [
        { id: 'a1', text: 'Completely unrelated claim about rocket engines' },
        { id: 'a2', text: 'Another entirely invented achievement in finance' },
      ] }],
      summary: '',
    };
    expect(verifyNoFabrication(res, source).offending).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Implement the gate**

`src/tailor/verify.ts`:

```ts
import type { ExperienceEntry } from './resume.js';
import type { TailorResponse } from './llm.js';

const SIMILARITY_FLOOR = 0.6;

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection++;
  return intersection / (A.size + B.size - intersection);
}

/** Every number in the text, so an inflated metric can be caught. */
function numbers(s: string): string[] {
  return (s.match(/\d+(?:\.\d+)?\s*[kmb%]?/gi) ?? []).map((n) => n.toLowerCase().replace(/\s+/g, ''));
}

export function verifyNoFabrication(
  res: TailorResponse, source: ExperienceEntry[],
): { ok: boolean; offending: string[] } {
  const entryById = new Map(source.map((e) => [e.id, e]));
  const offending: string[] = [];

  for (const entry of res.entries) {
    const sourceEntry = entryById.get(entry.id);
    if (!sourceEntry) {
      offending.push(`unknown entry id "${entry.id}"`);
      continue;
    }
    const bulletById = new Map(sourceEntry.bullets.map((b) => [b.id, b]));

    for (const bullet of entry.bullets) {
      const sourceBullet = bulletById.get(bullet.id);
      if (!sourceBullet) {
        offending.push(`unknown bullet id "${bullet.id}"`);
        continue;
      }
      if (jaccard(bullet.text, sourceBullet.text) < SIMILARITY_FLOOR) {
        offending.push(bullet.text);
        continue;
      }
      const sourceNumbers = new Set(numbers(sourceBullet.text));
      const invented = numbers(bullet.text).filter((n) => !sourceNumbers.has(n));
      if (invented.length) {
        offending.push(`${bullet.text} (invented figures: ${invented.join(', ')})`);
      }
    }
  }

  return { ok: offending.length === 0, offending };
}
```

- [ ] **Step 3: Run the verify test and confirm it passes**

Run: `npx vitest run test/tailor/verify.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 4: Write the failing LLM test**

`test/tailor/llm.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildPrompt, tailor, TailorError } from '../../src/tailor/llm.js';
import type { ExperienceEntry } from '../../src/tailor/resume.js';

const entries: ExperienceEntry[] = [
  {
    id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
    start: '2025-06', end: '2025-12',
    bullets: [
      { id: 'a1', text: 'Built SQL pipelines aggregating 12M rows', skills: ['sql'] },
      { id: 'a2', text: 'Automated a weekly report in Python', skills: ['python'] },
    ],
  },
];

const req = { jdSkills: ['sql', 'python'], jobTitle: 'Data Analyst', entries };

const validResponse = JSON.stringify({
  entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL pipelines aggregating 12M rows' }] }],
  summary: 'Data analyst with SQL and Python experience.',
});

describe('buildPrompt', () => {
  it('includes the JD keywords and the candidate bullets', () => {
    const p = buildPrompt(req);
    expect(p).toContain('sql');
    expect(p).toContain('Built SQL pipelines aggregating 12M rows');
  });

  it('states the no-fabrication constraint', () => {
    expect(buildPrompt(req).toLowerCase()).toContain('may not invent');
  });

  it('never contains the full JD text', () => {
    expect(buildPrompt(req)).not.toContain('jdText');
  });
});

describe('tailor', () => {
  it('parses a valid response', async () => {
    const call = vi.fn(async () => validResponse);
    const res = await tailor(req, { call });
    expect(res.entries[0].bullets[0].id).toBe('a1');
    expect(call).toHaveBeenCalledOnce();
  });

  it('strips markdown code fences before parsing', async () => {
    const call = vi.fn(async () => '```json\n' + validResponse + '\n```');
    await expect(tailor(req, { call })).resolves.toBeTruthy();
  });

  it('retries once on invalid JSON, then succeeds', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(validResponse);
    await expect(tailor(req, { call })).resolves.toBeTruthy();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('retries once on schema violation, then succeeds', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ entries: 'wrong type' }))
      .mockResolvedValueOnce(validResponse);
    await expect(tailor(req, { call })).resolves.toBeTruthy();
  });

  it('throws TailorError after two failures', async () => {
    const call = vi.fn(async () => 'still not json');
    await expect(tailor(req, { call })).rejects.toBeInstanceOf(TailorError);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 5: Implement the LLM module**

`src/tailor/llm.ts`:

```ts
import { z } from 'zod';
import type { ExperienceEntry } from './resume.js';
import { selectBullets } from './select.js';

export type LlmCall = (prompt: string) => Promise<string>;

export class TailorError extends Error {}

export interface TailorRequest {
  jdSkills: string[];
  jobTitle: string;
  entries: ExperienceEntry[];
}

const TailorResponseSchema = z.object({
  entries: z.array(z.object({
    id: z.string(),
    bullets: z.array(z.object({ id: z.string(), text: z.string().min(1) })).min(1),
  })).min(1),
  summary: z.string().default(''),
});
export type TailorResponse = z.infer<typeof TailorResponseSchema>;

const MAX_BULLETS_PER_ENTRY = 8;

export function buildPrompt(req: TailorRequest): string {
  const entries = req.entries.map((e) => ({
    id: e.id,
    role: e.role,
    org: e.org,
    bullets: selectBullets(e, req.jdSkills, MAX_BULLETS_PER_ENTRY)
      .map((b) => ({ id: b.id, text: b.text })),
  }));

  return `You are tailoring an existing resume to a job posting.

TARGET ROLE: ${req.jobTitle}
JOB KEYWORDS: ${req.jdSkills.join(', ')}

CANDIDATE BULLETS (the only material you may use):
${JSON.stringify(entries, null, 2)}

YOUR TASK
Select and order the bullets that best match the job keywords, and reword them
to surface that terminology naturally.

YOU MAY: reorder bullets, choose which to include, reword for keyword alignment.
YOU MAY NOT invent employers, job titles, dates, metrics, numbers, or skills.
Every bullet you return must keep the id of the bullet it came from and must
remain a faithful restatement of that bullet. Do not change any number.

Return ONLY valid JSON in exactly this shape, with no markdown fences:
{"entries":[{"id":"<entry id>","bullets":[{"id":"<bullet id>","text":"<reworded>"}]}],"summary":"<2-line professional summary built only from the above>"}`;
}

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TailorError('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    },
  );
  if (!res.ok) throw new TailorError(`Gemini HTTP ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new TailorError('Gemini returned no text');
  return text;
}

export async function tailor(
  req: TailorRequest, deps: { call?: LlmCall } = {},
): Promise<TailorResponse> {
  const call = deps.call ?? callGemini;
  const prompt = buildPrompt(req);
  let lastError = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await call(attempt === 1 ? prompt : `${prompt}\n\nYour previous reply was rejected: ${lastError}\nReturn ONLY the JSON object.`);
    try {
      const parsed = TailorResponseSchema.safeParse(JSON.parse(stripFences(raw)));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new TailorError(`Tailoring failed after 2 attempts: ${lastError}`);
}
```

- [ ] **Step 6: Run the LLM test and confirm it passes**

Run: `npx vitest run test/tailor`
Expected: PASS — select, verify and llm tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: gemini tailoring with schema validation and anti-fabrication gate"
```

---

## Task 9: Typst rendering

**Files:**
- Create: `src/tailor/template.typ`, `src/tailor/render.ts`
- Test: `test/tailor/render.test.ts`

**Interfaces:**
- Consumes: `Profile`, `EducationEntry`, `TailorResponse`, `ExperienceEntry`
- Produces:
  - `interface RenderInput { profile: Profile; summary: string; entries: RenderEntry[]; education: EducationEntry[]; skills: string[] }`
  - `buildRenderInput(profile, tailored, source, education, skills): RenderInput`
  - `resumePath(baseDir: string, company: string, role: string, when: Date): string`
  - `renderPdf(input: RenderInput, outPath: string): Promise<void>`

- [ ] **Step 1: Write the Typst template**

`src/tailor/template.typ` — reads a JSON sidecar so no string interpolation
into Typst source is ever needed:

```typst
#let data = json("data.json")

#set page(margin: (x: 1.6cm, y: 1.4cm))
#set text(font: "Helvetica", size: 10pt)
#show heading: set text(weight: "bold")

#align(center)[
  #text(size: 17pt, weight: "bold")[#data.profile.name]
  #linebreak()
  #text(size: 9pt)[
    #data.profile.email · #data.profile.phone · #data.profile.location
    #for (_, url) in data.profile.links [ · #link(url)[#url] ]
  ]
]

#v(6pt)

#if data.summary != "" [
  == Summary
  #data.summary
  #v(4pt)
]

== Experience
#for entry in data.entries [
  *#entry.role* — #entry.org #h(1fr) #entry.start – #entry.end
  #list(..entry.bullets)
  #v(2pt)
]

== Skills
#data.skills.join(" · ")

#if data.education.len() > 0 [
  == Education
  #for e in data.education [
    *#e.degree*, #e.institution #h(1fr) #e.start – #e.end
    #if e.detail != "" [ #linebreak() #text(size: 9pt)[#e.detail] ]
  ]
]
```

- [ ] **Step 2: Write the failing test**

`test/tailor/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRenderInput, resumePath, renderPdf } from '../../src/tailor/render.js';
import type { ExperienceEntry } from '../../src/tailor/resume.js';

const profile = {
  name: 'Example Candidate', email: 'e@example.com', phone: '+91 90000 00000',
  location: 'Bengaluru, India', links: { github: 'https://github.com/example' },
};

const source: ExperienceEntry[] = [{
  id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
  start: '2025-06', end: '2025-12',
  bullets: [
    { id: 'a1', text: 'Built SQL pipelines', skills: ['sql'] },
    { id: 'a2', text: 'Automated reporting in Python', skills: ['python'] },
  ],
}];

const tailored = {
  entries: [{ id: 'e1', bullets: [{ id: 'a2', text: 'Automated reporting in Python' }] }],
  summary: 'Data analyst.',
};

describe('resumePath', () => {
  it('builds the archive path from company, role and date', () => {
    const p = resumePath('/base', 'Acme Corp', 'Data Analyst', new Date('2026-08-01T00:00:00Z'));
    expect(p).toBe(join('/base', '2026-08', 'Acme_Corp_Data_Analyst_20260801.pdf'));
  });

  it('strips characters that are illegal in Windows filenames', () => {
    const p = resumePath('/base', 'A/B:C*Corp', 'Data? Analyst', new Date('2026-08-01T00:00:00Z'));
    expect(p).not.toMatch(/[/\\:*?"<>|]/g.source ? /[:*?"<>|]/ : /$^/);
  });
});

describe('buildRenderInput', () => {
  it('keeps only the bullets the tailoring selected, in order', () => {
    const input = buildRenderInput(profile, tailored, source, [], ['python', 'sql']);
    expect(input.entries[0].bullets).toEqual(['Automated reporting in Python']);
  });

  it('carries entry metadata across from the source resume', () => {
    const input = buildRenderInput(profile, tailored, source, [], []);
    expect(input.entries[0]).toMatchObject({ role: 'Data Analyst Intern', org: 'Acme', start: '2025-06' });
  });
});

describe('renderPdf', () => {
  it('produces a non-empty PDF file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-'));
    const out = join(dir, 'out.pdf');
    await renderPdf(buildRenderInput(profile, tailored, source, [], ['python']), out);

    expect(existsSync(out)).toBe(true);
    const bytes = readFileSync(out);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run test/tailor/render.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement rendering**

`src/tailor/render.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, copyFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EducationEntry, ExperienceEntry, Profile } from './resume.js';
import type { TailorResponse } from './llm.js';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export interface RenderEntry {
  role: string;
  org: string;
  start: string;
  end: string;
  bullets: string[];
}

export interface RenderInput {
  profile: Profile;
  summary: string;
  entries: RenderEntry[];
  education: EducationEntry[];
  skills: string[];
}

export function buildRenderInput(
  profile: Profile,
  tailored: TailorResponse,
  source: ExperienceEntry[],
  education: EducationEntry[],
  skills: string[],
): RenderInput {
  const byId = new Map(source.map((e) => [e.id, e]));
  const entries: RenderEntry[] = [];

  for (const entry of tailored.entries) {
    const src = byId.get(entry.id);
    if (!src) continue;
    entries.push({
      role: src.role,
      org: src.org,
      start: src.start,
      end: src.end,
      bullets: entry.bullets.map((b) => b.text),
    });
  }

  return { profile, summary: tailored.summary, entries, education, skills };
}

function safeSegment(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

export function resumePath(baseDir: string, company: string, role: string, when: Date): string {
  const yyyy = when.getUTCFullYear();
  const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(when.getUTCDate()).padStart(2, '0');
  return join(baseDir, `${yyyy}-${mm}`, `${safeSegment(company)}_${safeSegment(role)}_${yyyy}${mm}${dd}.pdf`);
}

export async function renderPdf(input: RenderInput, outPath: string): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'typst-'));
  try {
    writeFileSync(join(work, 'data.json'), JSON.stringify(input), 'utf8');
    copyFileSync(join(here, 'template.typ'), join(work, 'template.typ'));

    const built = join(work, 'out.pdf');
    await execFileAsync('typst', ['compile', join(work, 'template.typ'), built], { timeout: 20_000 });

    mkdirSync(dirname(outPath), { recursive: true });
    copyFileSync(built, outPath);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Verify Typst is installed, then run the test**

```bash
typst --version
```

If this fails, install it (`winget install --id Typst.Typst`) and reopen the
shell. Then:

Run: `npx vitest run test/tailor/render.test.ts`
Expected: PASS — 5 tests, including a real PDF on disk starting with `%PDF`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: typst resume rendering and archive paths"
```

---

## Task 10: Lever, Ashby and Workable sources

**Files:**
- Create: `src/sources/lever.ts`, `src/sources/ashby.ts`, `src/sources/workable.ts`, `src/sources/index.ts`
- Create: `test/fixtures/{lever-board,ashby-board,workable-board}.json`
- Test: `test/sources/lever.test.ts`, `test/sources/ashby.test.ts`, `test/sources/workable.test.ts`

**Interfaces:**
- Consumes: `JobSource`, `RawJob`, `SourceResult`, `fetchJson`, `htmlToText`
- Produces: `leverSource`, `ashbySource`, `workableSource`, and
  `sourceFor(platform: AtsPlatform): JobSource`

- [ ] **Step 1: Save the fixtures**

`test/fixtures/lever-board.json` (`api.lever.co/v0/postings/{token}?mode=json`):

```json
[
  {
    "id": "abc-123",
    "text": "Machine Learning Engineer",
    "hostedUrl": "https://jobs.lever.co/beta/abc-123",
    "createdAt": 1753900000000,
    "categories": { "location": "Bengaluru, India", "team": "Engineering" },
    "descriptionPlain": "Join us. 0-2 years of experience. Python, PyTorch."
  }
]
```

`test/fixtures/ashby-board.json` (`api.ashbyhq.com/posting-api/job-board/{token}`):

```json
{
  "jobs": [
    {
      "id": "job_01",
      "title": "Data Engineer",
      "jobUrl": "https://jobs.ashbyhq.com/gamma/job_01",
      "publishedAt": "2026-07-29T10:00:00.000Z",
      "location": "Remote",
      "descriptionPlain": "Build pipelines. Freshers welcome. SQL, Airflow."
    }
  ]
}
```

`test/fixtures/workable-board.json` (`{token}.workable.com/spi/v3/jobs`):

```json
{
  "results": [
    {
      "shortcode": "ABC123",
      "title": "Data Analyst",
      "url": "https://delta.workable.com/j/ABC123",
      "published_on": "2026-07-31",
      "location": { "city": "Gurgaon", "country": "India" },
      "description": "<p>Analyse data. 0-1 years. SQL, Excel.</p>"
    }
  ]
}
```

- [ ] **Step 2: Write the failing Lever test**

`test/sources/lever.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { leverSource } from '../../src/sources/lever.js';
import type { BoardRow } from '../../src/db/types.js';

const board: BoardRow = {
  id: 1, ats_platform: 'lever', board_token: 'beta', company_name: 'Beta',
  discovered_via: 'manual', discovered_at: '2026-08-01T00:00:00.000Z',
  last_polled_at: null, active: 1,
};

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}
afterEach(() => vi.unstubAllGlobals());

describe('leverSource', () => {
  it('maps the array response into RawJobs', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/lever-board.json', 'utf8')));
    const { jobs, ok } = await leverSource.fetchJobs(board);
    expect(ok).toBe(true);
    expect(jobs[0]).toMatchObject({
      sourceJobId: 'abc-123',
      url: 'https://jobs.lever.co/beta/abc-123',
      title: 'Machine Learning Engineer',
      location: 'Bengaluru, India',
      atsPlatform: 'lever',
    });
  });

  it('converts the epoch-millisecond createdAt to ISO', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/lever-board.json', 'utf8')));
    const { jobs } = await leverSource.fetchJobs(board);
    expect(jobs[0].postedAt).toBe(new Date(1753900000000).toISOString());
  });

  it('reports failure without throwing on 404', async () => {
    mockFetch([], 404);
    const result = await leverSource.fetchJobs(board);
    expect(result.ok).toBe(false);
    expect(result.jobs).toEqual([]);
  });
});
```

- [ ] **Step 3: Implement the three sources**

`src/sources/lever.ts`:

```ts
import { fetchJson, htmlToText } from './http.js';
import type { JobSource, RawJob, SourceResult } from './types.js';
import type { BoardRow } from '../db/types.js';

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: { location?: string };
  descriptionPlain?: string;
  description?: string;
}

export const leverSource: JobSource = {
  name: 'lever',
  platform: 'lever',

  async fetchJobs(board: BoardRow): Promise<SourceResult> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(board.board_token)}?mode=json`;
    try {
      const body = (await fetchJson(url)) as LeverPosting[];
      const jobs: RawJob[] = (body ?? []).map((p) => ({
        sourceJobId: p.id,
        url: p.hostedUrl,
        company: board.company_name,
        title: p.text,
        location: p.categories?.location ?? null,
        postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
        jdText: p.descriptionPlain ?? htmlToText(p.description ?? ''),
        atsPlatform: 'lever',
      }));
      return { jobs, ok: true };
    } catch (err) {
      return { jobs: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
```

`src/sources/ashby.ts`:

```ts
import { fetchJson, htmlToText } from './http.js';
import type { JobSource, RawJob, SourceResult } from './types.js';
import type { BoardRow } from '../db/types.js';

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  publishedAt?: string;
  location?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
}

export const ashbySource: JobSource = {
  name: 'ashby',
  platform: 'ashby',

  async fetchJobs(board: BoardRow): Promise<SourceResult> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.board_token)}?includeCompensation=false`;
    try {
      const body = (await fetchJson(url)) as { jobs?: AshbyJob[] };
      const jobs: RawJob[] = (body.jobs ?? []).map((j) => ({
        sourceJobId: j.id,
        url: j.jobUrl,
        company: board.company_name,
        title: j.title,
        location: j.location ?? null,
        postedAt: j.publishedAt ? new Date(j.publishedAt).toISOString() : null,
        jdText: j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? ''),
        atsPlatform: 'ashby',
      }));
      return { jobs, ok: true };
    } catch (err) {
      return { jobs: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
```

`src/sources/workable.ts`:

```ts
import { fetchJson, htmlToText } from './http.js';
import type { JobSource, RawJob, SourceResult } from './types.js';
import type { BoardRow } from '../db/types.js';

interface WorkableJob {
  shortcode: string;
  title: string;
  url: string;
  published_on?: string;
  location?: { city?: string; country?: string };
  description?: string;
}

export const workableSource: JobSource = {
  name: 'workable',
  platform: 'workable',

  async fetchJobs(board: BoardRow): Promise<SourceResult> {
    const url = `https://${encodeURIComponent(board.board_token)}.workable.com/spi/v3/jobs`;
    try {
      const body = (await fetchJson(url)) as { results?: WorkableJob[] };
      const jobs: RawJob[] = (body.results ?? []).map((j) => ({
        sourceJobId: j.shortcode,
        url: j.url,
        company: board.company_name,
        title: j.title,
        location: [j.location?.city, j.location?.country].filter(Boolean).join(', ') || null,
        postedAt: j.published_on ? new Date(`${j.published_on}T00:00:00Z`).toISOString() : null,
        jdText: htmlToText(j.description ?? ''),
        atsPlatform: 'workable',
      }));
      return { jobs, ok: true };
    } catch (err) {
      return { jobs: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
```

`src/sources/index.ts`:

```ts
import type { AtsPlatform } from '../config/schema.js';
import type { JobSource } from './types.js';
import { greenhouseSource } from './greenhouse.js';
import { leverSource } from './lever.js';
import { ashbySource } from './ashby.js';
import { workableSource } from './workable.js';

const SOURCES: Record<AtsPlatform, JobSource> = {
  greenhouse: greenhouseSource,
  lever: leverSource,
  ashby: ashbySource,
  workable: workableSource,
};

export function sourceFor(platform: AtsPlatform): JobSource {
  return SOURCES[platform];
}

export const ALL_SOURCES = Object.values(SOURCES);
```

- [ ] **Step 4: Write the Ashby and Workable tests**

Copy the structure of `test/sources/lever.test.ts` exactly, substituting the
module, board token, fixture file and expectations:

- `test/sources/ashby.test.ts` — board token `gamma`, platform `ashby`,
  asserts `sourceJobId === 'job_01'`, `location === 'Remote'`,
  `postedAt === '2026-07-29T10:00:00.000Z'`, and a 404 producing `ok: false`.
- `test/sources/workable.test.ts` — board token `delta`, platform `workable`,
  asserts `sourceJobId === 'ABC123'`, `location === 'Gurgaon, India'`,
  `postedAt === '2026-07-31T00:00:00.000Z'`, that `jdText` contains
  `'0-1 years'` and not `'<p>'`, and a 404 producing `ok: false`.

- [ ] **Step 5: Run the full source suite**

Run: `npx vitest run test/sources`
Expected: PASS — greenhouse, lever, ashby and workable tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: lever, ashby and workable board sources"
```

---

## Task 11: Company name → board token resolver

**Files:**
- Create: `src/resolve/slug.ts`, `src/resolve/resolver.ts`
- Test: `test/resolve/slug.test.ts`, `test/resolve/resolver.test.ts`

**Interfaces:**
- Consumes: `CompanyEntry`, `AtsPlatform`, `HttpError`, `upsertBoard`, `boardExists`
- Produces:
  - `candidateSlugs(name: string): string[]` (ordered, most likely first)
  - `interface Resolution { name: string; ats: AtsPlatform | null; token: string | null }`
  - `resolveCompany(name: string, deps?: { probe?: Probe }): Promise<Resolution>`
  - `resolveAll(db, entries: CompanyEntry[], deps?): Promise<{ resolved: Resolution[]; unresolved: string[] }>`
  - `type Probe = (ats: AtsPlatform, token: string) => Promise<boolean>`

- [ ] **Step 1: Write the failing slug test**

`test/resolve/slug.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { candidateSlugs } from '../../src/resolve/slug.js';

describe('candidateSlugs', () => {
  it('produces the lowercase concatenation first', () => {
    expect(candidateSlugs('Acme Corp')[0]).toBe('acmecorp');
  });

  it('includes a hyphenated variant', () => {
    expect(candidateSlugs('Acme Corp')).toContain('acme-corp');
  });

  it('includes a variant with the legal suffix dropped', () => {
    expect(candidateSlugs('Acme Technologies Pvt Ltd')).toContain('acme');
  });

  it('strips punctuation and diacritics', () => {
    expect(candidateSlugs("O'Reilly & Co.")).toContain('oreilly');
  });

  it('deduplicates', () => {
    const slugs = candidateSlugs('Acme');
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('never returns an empty slug', () => {
    expect(candidateSlugs('!!!')).not.toContain('');
  });
});
```

- [ ] **Step 2: Implement slug generation**

`src/resolve/slug.ts`:

```ts
const LEGAL_SUFFIXES = [
  'inc', 'llc', 'ltd', 'limited', 'pvt', 'private', 'corp', 'corporation',
  'co', 'gmbh', 'technologies', 'technology', 'labs', 'software', 'solutions', 'systems',
];

function words(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function candidateSlugs(name: string): string[] {
  const all = words(name);
  const core = all.filter((w) => !LEGAL_SUFFIXES.includes(w));
  const base = core.length ? core : all;

  const candidates = [
    base.join(''),
    base.join('-'),
    all.join(''),
    all.join('-'),
    base[0] ?? '',
    base.slice(0, 2).join(''),
  ];

  return [...new Set(candidates)].filter((s) => s.length > 0);
}
```

- [ ] **Step 3: Write the failing resolver test**

`test/resolve/resolver.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { listActiveBoards } from '../../src/db/boards.js';
import { resolveCompany, resolveAll } from '../../src/resolve/resolver.js';
import type { AtsPlatform } from '../../src/config/schema.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

/** Probe that only "finds" the given ats+token pairs. */
function probeFor(known: [AtsPlatform, string][]) {
  const set = new Set(known.map(([a, t]) => `${a}:${t}`));
  return vi.fn(async (ats: AtsPlatform, token: string) => set.has(`${ats}:${token}`));
}

describe('resolveCompany', () => {
  it('returns the ats and token when a board is found', async () => {
    const probe = probeFor([['lever', 'acme']]);
    expect(await resolveCompany('Acme Corp', { probe })).toEqual({
      name: 'Acme Corp', ats: 'lever', token: 'acme',
    });
  });

  it('returns nulls when nothing is found', async () => {
    const probe = probeFor([]);
    expect(await resolveCompany('Nowhere Inc', { probe })).toEqual({
      name: 'Nowhere Inc', ats: null, token: null,
    });
  });

  it('stops probing as soon as a board is found', async () => {
    const probe = probeFor([['greenhouse', 'acmecorp']]);
    await resolveCompany('Acme Corp', { probe });
    const calls = probe.mock.calls.map(([a, t]) => `${a}:${t}`);
    expect(calls[calls.length - 1]).toBe('greenhouse:acmecorp');
  });

  it('tries every platform before giving up', async () => {
    const probe = probeFor([]);
    await resolveCompany('Acme', { probe });
    const platforms = new Set(probe.mock.calls.map(([a]) => a));
    expect(platforms).toEqual(new Set(['greenhouse', 'lever', 'ashby', 'workable']));
  });
});

describe('resolveAll', () => {
  it('registers resolved companies as boards', async () => {
    const probe = probeFor([['lever', 'acme']]);
    const result = await resolveAll(db, [{ name: 'Acme Corp', paused: false }], { probe });

    expect(result.unresolved).toEqual([]);
    const boards = listActiveBoards(db);
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ ats_platform: 'lever', board_token: 'acme', discovered_via: 'companies.yaml' });
  });

  it('honours a manual ats/token override without probing', async () => {
    const probe = probeFor([]);
    await resolveAll(db, [{ name: 'Gamma', paused: false, ats: 'ashby', token: 'gamma' }], { probe });

    expect(probe).not.toHaveBeenCalled();
    expect(listActiveBoards(db)[0].board_token).toBe('gamma');
  });

  it('skips paused companies entirely', async () => {
    const probe = probeFor([['lever', 'acme']]);
    await resolveAll(db, [{ name: 'Acme', paused: true }], { probe });

    expect(probe).not.toHaveBeenCalled();
    expect(listActiveBoards(db)).toHaveLength(0);
  });

  it('reports names it could not resolve', async () => {
    const probe = probeFor([]);
    const result = await resolveAll(db, [{ name: 'Ghost Ltd', paused: false }], { probe });
    expect(result.unresolved).toEqual(['Ghost Ltd']);
  });

  it('does not re-probe a company already registered', async () => {
    const probe = probeFor([['lever', 'acme']]);
    await resolveAll(db, [{ name: 'Acme Corp', paused: false }], { probe });
    probe.mockClear();
    await resolveAll(db, [{ name: 'Acme Corp', paused: false }], { probe });
    expect(probe).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Implement the resolver**

`src/resolve/resolver.ts`:

```ts
import type { Database } from 'better-sqlite3';
import type { AtsPlatform, CompanyEntry } from '../config/schema.js';
import { boardExists, upsertBoard } from '../db/boards.js';
import { candidateSlugs } from './slug.js';

export type Probe = (ats: AtsPlatform, token: string) => Promise<boolean>;

export interface Resolution {
  name: string;
  ats: AtsPlatform | null;
  token: string | null;
}

const PLATFORMS: AtsPlatform[] = ['greenhouse', 'lever', 'ashby', 'workable'];

const PROBE_URLS: Record<AtsPlatform, (token: string) => string> = {
  greenhouse: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
  lever: (t) => `https://api.lever.co/v0/postings/${t}?mode=json&limit=1`,
  ashby: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
  workable: (t) => `https://${t}.workable.com/spi/v3/jobs`,
};

/** A board exists if the endpoint answers 2xx. Network errors count as "not found". */
async function httpProbe(ats: AtsPlatform, token: string): Promise<boolean> {
  try {
    const res = await fetch(PROBE_URLS[ats](token), {
      headers: { accept: 'application/json', 'user-agent': 'job-pipeline/1.0' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveCompany(
  name: string, deps: { probe?: Probe } = {},
): Promise<Resolution> {
  const probe = deps.probe ?? httpProbe;
  for (const token of candidateSlugs(name)) {
    for (const ats of PLATFORMS) {
      if (await probe(ats, token)) return { name, ats, token };
    }
  }
  return { name, ats: null, token: null };
}

export async function resolveAll(
  db: Database,
  entries: CompanyEntry[],
  deps: { probe?: Probe } = {},
): Promise<{ resolved: Resolution[]; unresolved: string[] }> {
  const resolved: Resolution[] = [];
  const unresolved: string[] = [];

  for (const entry of entries) {
    if (entry.paused) continue;

    if (entry.ats && entry.token) {
      upsertBoard(db, {
        atsPlatform: entry.ats, boardToken: entry.token,
        companyName: entry.name, discoveredVia: 'companies.yaml',
      });
      resolved.push({ name: entry.name, ats: entry.ats, token: entry.token });
      continue;
    }

    const already = PLATFORMS
      .flatMap((ats) => candidateSlugs(entry.name).map((token) => ({ ats, token })))
      .find(({ ats, token }) => boardExists(db, ats, token));
    if (already) {
      resolved.push({ name: entry.name, ats: already.ats, token: already.token });
      continue;
    }

    const resolution = await resolveCompany(entry.name, deps);
    if (resolution.ats && resolution.token) {
      upsertBoard(db, {
        atsPlatform: resolution.ats, boardToken: resolution.token,
        companyName: entry.name, discoveredVia: 'companies.yaml',
      });
      resolved.push(resolution);
    } else {
      unresolved.push(entry.name);
    }
  }

  return { resolved, unresolved };
}
```

- [ ] **Step 5: Run the resolver suite**

Run: `npx vitest run test/resolve`
Expected: PASS — 12 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: company name to board token resolver"
```

---

## Task 12: Apply-URL parser and token registration

**Files:**
- Create: `src/discovery/urlparse.ts`, `src/discovery/register.ts`
- Test: `test/discovery/urlparse.test.ts`, `test/discovery/register.test.ts`

**Interfaces:**
- Consumes: `AtsPlatform`, `upsertBoard`, `boardExists`
- Produces:
  - `interface ParsedApplyUrl { ats: AtsPlatform; token: string; sourceJobId: string | null }`
  - `parseApplyUrl(url: string): ParsedApplyUrl | null`
  - `registerDiscovered(db, hits: DiscoveryHit[]): { registered: number; skipped: number }`
  - `interface DiscoveryHit { applyUrl: string; company: string; via: string }`

- [ ] **Step 1: Write the failing test**

`test/discovery/urlparse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseApplyUrl } from '../../src/discovery/urlparse.js';

describe('parseApplyUrl — greenhouse', () => {
  it.each([
    'https://boards.greenhouse.io/acme/jobs/4012345',
    'https://boards.greenhouse.io/acme/jobs/4012345?gh_src=abc',
    'https://job-boards.greenhouse.io/acme/jobs/4012345',
  ])('parses %s', (url) => {
    expect(parseApplyUrl(url)).toEqual({ ats: 'greenhouse', token: 'acme', sourceJobId: '4012345' });
  });

  it('parses an embedded greenhouse url without a job id', () => {
    expect(parseApplyUrl('https://boards.greenhouse.io/acme'))
      .toEqual({ ats: 'greenhouse', token: 'acme', sourceJobId: null });
  });
});

describe('parseApplyUrl — lever', () => {
  it('parses a hosted posting url', () => {
    expect(parseApplyUrl('https://jobs.lever.co/beta/abc-123'))
      .toEqual({ ats: 'lever', token: 'beta', sourceJobId: 'abc-123' });
  });

  it('parses an apply sub-path', () => {
    expect(parseApplyUrl('https://jobs.lever.co/beta/abc-123/apply'))
      .toEqual({ ats: 'lever', token: 'beta', sourceJobId: 'abc-123' });
  });
});

describe('parseApplyUrl — ashby', () => {
  it('parses a job board url', () => {
    expect(parseApplyUrl('https://jobs.ashbyhq.com/gamma/job_01'))
      .toEqual({ ats: 'ashby', token: 'gamma', sourceJobId: 'job_01' });
  });
});

describe('parseApplyUrl — workable', () => {
  it('parses a subdomain url', () => {
    expect(parseApplyUrl('https://delta.workable.com/j/ABC123'))
      .toEqual({ ats: 'workable', token: 'delta', sourceJobId: 'ABC123' });
  });

  it('parses an apply.workable.com url', () => {
    expect(parseApplyUrl('https://apply.workable.com/delta/j/ABC123/'))
      .toEqual({ ats: 'workable', token: 'delta', sourceJobId: 'ABC123' });
  });
});

describe('parseApplyUrl — rejections', () => {
  it.each([
    'https://www.linkedin.com/jobs/view/12345',
    'https://example.com/careers',
    'https://boards.greenhouse.io/',
    'not a url at all',
    '',
  ])('returns null for %s', (url) => {
    expect(parseApplyUrl(url)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement the parser**

`src/discovery/urlparse.ts`:

```ts
import type { AtsPlatform } from '../config/schema.js';

export interface ParsedApplyUrl {
  ats: AtsPlatform;
  token: string;
  sourceJobId: string | null;
}

const RESERVED = new Set(['www', 'apply', 'jobs', 'careers', 'help', 'support', 'account']);

export function parseApplyUrl(raw: string): ParsedApplyUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (host.endsWith('greenhouse.io')) {
    const token = segments[0];
    if (!token) return null;
    const jobIndex = segments.indexOf('jobs');
    return { ats: 'greenhouse', token, sourceJobId: jobIndex >= 0 ? segments[jobIndex + 1] ?? null : null };
  }

  if (host.endsWith('lever.co')) {
    const [token, id] = segments;
    if (!token) return null;
    return { ats: 'lever', token, sourceJobId: id ?? null };
  }

  if (host.endsWith('ashbyhq.com')) {
    const [token, id] = segments;
    if (!token) return null;
    return { ats: 'ashby', token, sourceJobId: id ?? null };
  }

  if (host.endsWith('workable.com')) {
    if (host.startsWith('apply.')) {
      const [token, , id] = segments;   // /{token}/j/{id}
      if (!token) return null;
      return { ats: 'workable', token, sourceJobId: id ?? null };
    }
    const token = host.split('.')[0];
    if (!token || RESERVED.has(token)) return null;
    const jIndex = segments.indexOf('j');
    return { ats: 'workable', token, sourceJobId: jIndex >= 0 ? segments[jIndex + 1] ?? null : null };
  }

  return null;
}
```

- [ ] **Step 3: Write the registration test**

`test/discovery/register.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { listActiveBoards } from '../../src/db/boards.js';
import { registerDiscovered } from '../../src/discovery/register.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

describe('registerDiscovered', () => {
  it('registers a board from a parseable apply url', () => {
    const r = registerDiscovered(db, [
      { applyUrl: 'https://jobs.lever.co/beta/abc-123', company: 'Beta', via: 'adzuna' },
    ]);
    expect(r.registered).toBe(1);
    expect(listActiveBoards(db)[0]).toMatchObject({
      ats_platform: 'lever', board_token: 'beta', company_name: 'Beta', discovered_via: 'adzuna',
    });
  });

  it('skips urls it cannot parse', () => {
    const r = registerDiscovered(db, [
      { applyUrl: 'https://example.com/careers', company: 'Example', via: 'adzuna' },
    ]);
    expect(r).toEqual({ registered: 0, skipped: 1 });
    expect(listActiveBoards(db)).toHaveLength(0);
  });

  it('does not double-register the same board', () => {
    const hit = { applyUrl: 'https://jobs.lever.co/beta/abc-123', company: 'Beta', via: 'adzuna' };
    registerDiscovered(db, [hit]);
    const second = registerDiscovered(db, [hit]);
    expect(second.registered).toBe(0);
    expect(listActiveBoards(db)).toHaveLength(1);
  });

  it('registers several distinct boards in one call', () => {
    const r = registerDiscovered(db, [
      { applyUrl: 'https://jobs.lever.co/beta/1', company: 'Beta', via: 'hn' },
      { applyUrl: 'https://boards.greenhouse.io/acme/jobs/2', company: 'Acme', via: 'hn' },
    ]);
    expect(r.registered).toBe(2);
    expect(listActiveBoards(db)).toHaveLength(2);
  });
});
```

`src/discovery/register.ts`:

```ts
import type { Database } from 'better-sqlite3';
import { boardExists, upsertBoard } from '../db/boards.js';
import { parseApplyUrl } from './urlparse.js';

export interface DiscoveryHit {
  applyUrl: string;
  company: string;
  via: string;
}

export function registerDiscovered(
  db: Database, hits: DiscoveryHit[],
): { registered: number; skipped: number } {
  let registered = 0;
  let skipped = 0;

  for (const hit of hits) {
    const parsed = parseApplyUrl(hit.applyUrl);
    if (!parsed) {
      skipped++;
      continue;
    }
    if (boardExists(db, parsed.ats, parsed.token)) continue;

    upsertBoard(db, {
      atsPlatform: parsed.ats,
      boardToken: parsed.token,
      companyName: hit.company,
      discoveredVia: hit.via,
    });
    registered++;
  }

  return { registered, skipped };
}
```

- [ ] **Step 4: Run the discovery suite**

Run: `npx vitest run test/discovery`
Expected: PASS — 16 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: apply-url parsing and automatic board registration"
```

---

## Task 13: Discovery sources

Every discovery source returns `DiscoveryHit[]`. They exist only to surface
apply URLs, from which Task 12 harvests board tokens. Full JDs always come
from board polling afterwards, never from these.

**Files:**
- Create: `src/discovery/types.ts`, `src/discovery/adzuna.ts`, `src/discovery/hn.ts`, `src/discovery/remotive.ts`, `src/discovery/linkedin.ts`, `src/discovery/index.ts`
- Create: `test/fixtures/{adzuna-search,hn-algolia,remotive-search}.json`, `test/fixtures/linkedin-guest.html`
- Test: `test/discovery/adzuna.test.ts`, `test/discovery/hn.test.ts`, `test/discovery/remotive.test.ts`, `test/discovery/linkedin.test.ts`

**Interfaces:**
- Consumes: `DiscoveryHit`, `fetchJson`, `fetchText`, `Criteria`
- Produces:
  - `interface DiscoverySource { name: string; search(queries: string[], criteria: Criteria): Promise<DiscoveryResult> }`
  - `interface DiscoveryResult { hits: DiscoveryHit[]; ok: boolean; error?: string }`
  - `adzunaSource`, `hnSource`, `remotiveSource`, `linkedinSource`, `ALL_DISCOVERY`

- [ ] **Step 1: Define the contract**

`src/discovery/types.ts`:

```ts
import type { Criteria } from '../config/schema.js';
import type { DiscoveryHit } from './register.js';

export interface DiscoveryResult {
  hits: DiscoveryHit[];
  ok: boolean;
  error?: string;
}

export interface DiscoverySource {
  name: string;
  search(queries: string[], criteria: Criteria): Promise<DiscoveryResult>;
}
```

- [ ] **Step 2: Save the fixtures**

`test/fixtures/adzuna-search.json`:

```json
{
  "count": 2,
  "results": [
    {
      "id": "1",
      "title": "Data Analyst",
      "company": { "display_name": "Beta Inc" },
      "redirect_url": "https://jobs.lever.co/beta/abc-123",
      "location": { "display_name": "Bengaluru, Karnataka" },
      "created": "2026-07-30T10:00:00Z"
    },
    {
      "id": "2",
      "title": "Backend Engineer",
      "company": { "display_name": "Unknown Co" },
      "redirect_url": "https://example.com/careers/2",
      "location": { "display_name": "Pune" },
      "created": "2026-07-29T10:00:00Z"
    }
  ]
}
```

`test/fixtures/hn-algolia.json`:

```json
{
  "hits": [
    {
      "objectID": "40001",
      "comment_text": "Acme Corp | ML Engineer | Bengaluru | Apply at https://boards.greenhouse.io/acme/jobs/999",
      "created_at": "2026-07-30T10:00:00.000Z"
    },
    {
      "objectID": "40002",
      "comment_text": "Some general comment with no link at all.",
      "created_at": "2026-07-30T11:00:00.000Z"
    }
  ]
}
```

`test/fixtures/remotive-search.json`:

```json
{
  "jobs": [
    {
      "id": 900,
      "title": "Data Engineer",
      "company_name": "Gamma",
      "url": "https://jobs.ashbyhq.com/gamma/job_01",
      "candidate_required_location": "Anywhere",
      "publication_date": "2026-07-31T08:00:00"
    }
  ]
}
```

`test/fixtures/linkedin-guest.html`:

```html
<ul>
  <li>
    <a class="base-card__full-link" href="https://in.linkedin.com/jobs/view/data-analyst-at-beta-inc-4012345?trk=guest">
      <span class="sr-only">Data Analyst</span>
    </a>
    <h4 class="base-search-card__subtitle"><a>Beta Inc</a></h4>
    <span class="job-search-card__location">Bengaluru, Karnataka, India</span>
  </li>
</ul>
```

- [ ] **Step 3: Write the failing Adzuna test**

`test/discovery/adzuna.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { adzunaSource } from '../../src/discovery/adzuna.js';
import type { Criteria } from '../../src/config/schema.js';

const criteria = {
  titles: { include: ['data analyst'], exclude: [] },
  experience: { max_years_required: 0 },
  locations: { include: ['bengaluru', 'remote'] },
  freshness: { max_posted_age_days: 7, verify_open_before_submit: true },
  scoring: { threshold: 60 },
  limits: { daily_cap: 30, per_company_open_applications: 3, min_delay_seconds: 45, max_delay_seconds: 120 },
  submission: { dry_run: true },
} as Criteria;

beforeEach(() => {
  process.env.ADZUNA_APP_ID = 'id';
  process.env.ADZUNA_APP_KEY = 'key';
});
afterEach(() => vi.unstubAllGlobals());

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

describe('adzunaSource', () => {
  it('returns a hit for every result, including unparseable urls', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/adzuna-search.json', 'utf8')));
    const { hits, ok } = await adzunaSource.search(['data analyst'], criteria);
    expect(ok).toBe(true);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      applyUrl: 'https://jobs.lever.co/beta/abc-123', company: 'Beta Inc', via: 'adzuna',
    });
  });

  it('reports failure without throwing on a non-200', async () => {
    mockFetch({}, 429);
    const result = await adzunaSource.search(['data analyst'], criteria);
    expect(result.ok).toBe(false);
    expect(result.hits).toEqual([]);
  });

  it('fails cleanly when credentials are missing', async () => {
    delete process.env.ADZUNA_APP_ID;
    const result = await adzunaSource.search(['data analyst'], criteria);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ADZUNA');
  });

  it('issues one request per query', async () => {
    mockFetch(JSON.parse(readFileSync('test/fixtures/adzuna-search.json', 'utf8')));
    await adzunaSource.search(['data analyst', 'ml engineer'], criteria);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4: Implement the discovery sources**

`src/discovery/adzuna.ts`:

```ts
import { fetchJson } from '../sources/http.js';
import type { DiscoverySource, DiscoveryResult } from './types.js';
import type { DiscoveryHit } from './register.js';
import type { Criteria } from '../config/schema.js';

interface AdzunaResult {
  title: string;
  company?: { display_name?: string };
  redirect_url: string;
}

const MAX_DAYS_OLD = 7;

export const adzunaSource: DiscoverySource = {
  name: 'adzuna',

  async search(queries: string[], criteria: Criteria): Promise<DiscoveryResult> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    if (!appId || !appKey) {
      return { hits: [], ok: false, error: 'ADZUNA_APP_ID / ADZUNA_APP_KEY not set' };
    }

    const hits: DiscoveryHit[] = [];
    try {
      for (const query of queries) {
        const url = new URL('https://api.adzuna.com/v1/api/jobs/in/search/1');
        url.searchParams.set('app_id', appId);
        url.searchParams.set('app_key', appKey);
        url.searchParams.set('what', query);
        url.searchParams.set('results_per_page', '50');
        url.searchParams.set('max_days_old', String(Math.min(MAX_DAYS_OLD, criteria.freshness.max_posted_age_days)));
        url.searchParams.set('content-type', 'application/json');

        const body = (await fetchJson(url.toString())) as { results?: AdzunaResult[] };
        for (const r of body.results ?? []) {
          hits.push({
            applyUrl: r.redirect_url,
            company: r.company?.display_name ?? 'Unknown',
            via: 'adzuna',
          });
        }
      }
      return { hits, ok: true };
    } catch (err) {
      return { hits: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
```

`src/discovery/hn.ts`:

```ts
import { fetchJson } from '../sources/http.js';
import type { DiscoverySource, DiscoveryResult } from './types.js';
import type { DiscoveryHit } from './register.js';
import type { Criteria } from '../config/schema.js';

interface AlgoliaHit {
  objectID: string;
  comment_text?: string;
}

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;
const ATS_HOSTS = /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com)/i;

/** "Acme Corp | ML Engineer | Bengaluru | ..." — the company is the first field. */
function companyFrom(comment: string): string {
  const first = comment.split('|')[0]?.trim() ?? '';
  return first.slice(0, 80) || 'Unknown';
}

export const hnSource: DiscoverySource = {
  name: 'hn-whoishiring',

  async search(queries: string[], _criteria: Criteria): Promise<DiscoveryResult> {
    const hits: DiscoveryHit[] = [];
    try {
      for (const query of queries) {
        const url = new URL('https://hn.algolia.com/api/v1/search_by_date');
        url.searchParams.set('query', query);
        url.searchParams.set('tags', 'comment');
        url.searchParams.set('hitsPerPage', '100');

        const body = (await fetchJson(url.toString())) as { hits?: AlgoliaHit[] };
        for (const hit of body.hits ?? []) {
          const text = hit.comment_text ?? '';
          for (const found of text.match(URL_RE) ?? []) {
            if (ATS_HOSTS.test(found)) {
              hits.push({ applyUrl: found, company: companyFrom(text), via: 'hn-whoishiring' });
            }
          }
        }
      }
      return { hits, ok: true };
    } catch (err) {
      return { hits: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
```

`src/discovery/remotive.ts`:

```ts
import { fetchJson } from '../sources/http.js';
import type { DiscoverySource, DiscoveryResult } from './types.js';
import type { DiscoveryHit } from './register.js';
import type { Criteria } from '../config/schema.js';

interface RemotiveJob {
  title: string;
  company_name: string;
  url: string;
}

export const remotiveSource: DiscoverySource = {
  name: 'remotive',

  async search(queries: string[], _criteria: Criteria): Promise<DiscoveryResult> {
    const hits: DiscoveryHit[] = [];
    try {
      for (const query of queries) {
        const url = new URL('https://remotive.com/api/remote-jobs');
        url.searchParams.set('search', query);
        url.searchParams.set('limit', '50');

        const body = (await fetchJson(url.toString())) as { jobs?: RemotiveJob[] };
        for (const job of body.jobs ?? []) {
          hits.push({ applyUrl: job.url, company: job.company_name, via: 'remotive' });
        }
      }
      return { hits, ok: true };
    } catch (err) {
      return { hits: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
```

`src/discovery/linkedin.ts` — deliberately rate-limited per spec §1 of the
roadmap (1 request per 3–5s):

```ts
import { fetchText } from '../sources/http.js';
import type { DiscoverySource, DiscoveryResult } from './types.js';
import type { DiscoveryHit } from './register.js';
import type { Criteria } from '../config/schema.js';

const LINK_RE = /<a[^>]+class="[^"]*base-card__full-link[^"]*"[^>]+href="([^"]+)"/g;
const COMPANY_RE = /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>\s*<a[^>]*>([^<]+)</g;

const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const linkedinSource: DiscoverySource = {
  name: 'linkedin-guest',

  async search(queries: string[], criteria: Criteria): Promise<DiscoveryResult> {
    const hits: DiscoveryHit[] = [];
    try {
      for (const [index, query] of queries.entries()) {
        if (index > 0) {
          await sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
        }

        const url = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
        url.searchParams.set('keywords', query);
        url.searchParams.set('location', criteria.locations.include[0] ?? 'India');
        url.searchParams.set('f_TPR', 'r604800');   // last 7 days
        url.searchParams.set('start', '0');

        const html = await fetchText(url.toString());
        const links = [...html.matchAll(LINK_RE)].map((m) => m[1]);
        const companies = [...html.matchAll(COMPANY_RE)].map((m) => m[1].trim());

        links.forEach((link, i) => {
          hits.push({
            applyUrl: link.split('?')[0],
            company: companies[i] ?? 'Unknown',
            via: 'linkedin-guest',
          });
        });
      }
      return { hits, ok: true };
    } catch (err) {
      return { hits: [], ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
```

`src/discovery/index.ts`:

```ts
import type { DiscoverySource } from './types.js';
import { adzunaSource } from './adzuna.js';
import { hnSource } from './hn.js';
import { remotiveSource } from './remotive.js';
import { linkedinSource } from './linkedin.js';

export const ALL_DISCOVERY: DiscoverySource[] = [
  adzunaSource, hnSource, remotiveSource, linkedinSource,
];
```

- [ ] **Step 5: Write the remaining discovery tests**

Mirror `test/discovery/adzuna.test.ts` for each:

- `test/discovery/hn.test.ts` — asserts one hit is extracted from
  `hn-algolia.json` (`https://boards.greenhouse.io/acme/jobs/999`, company
  `Acme Corp`), that the comment with no link yields nothing, and that a
  non-200 gives `ok: false`.
- `test/discovery/remotive.test.ts` — asserts the Ashby URL is returned with
  company `Gamma` and `via: 'remotive'`, and that a non-200 gives `ok: false`.
- `test/discovery/linkedin.test.ts` — stubs `fetch` to return
  `linkedin-guest.html`, asserts the hit's `applyUrl` has the query string
  stripped and `company === 'Beta Inc'`. Pass a single query so no sleep runs.

**Note:** LinkedIn hits are almost never parseable by `parseApplyUrl` — they
point at `linkedin.com/jobs/view/...`, so Task 12 will skip them. That is
expected and correct; LinkedIn contributes board tokens only when a posting
happens to link out. It earns its place fully in slice 3.

- [ ] **Step 6: Run the discovery suite**

Run: `npx vitest run test/discovery`
Expected: PASS — urlparse, register, adzuna, hn, remotive and linkedin tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: adzuna, hn, remotive and linkedin discovery sources"
```

---

## Task 14: Submission guards

Nine guards, evaluated in the exact order of spec §5.5. This is the safety
boundary of the whole system.

**Files:**
- Create: `src/submit/guards.ts`
- Test: `test/submit/guards.test.ts`

**Interfaces:**
- Consumes: `JobRow`, `Criteria`, `BlockedCompany`, `normalizeCompany`, `titleSimilarity`, application queries
- Produces:
  - `type GuardOutcome = { allow: true } | { allow: false; status: JobStatus; reason: string } | { allow: false; status: 'dry-run'; reason: string }`
  - `runGuards(ctx: GuardContext): Promise<GuardOutcome>`
  - `interface GuardContext { db; job: JobRow; criteria: Criteria; blocklist: BlockedCompany[]; now: Date; projectRoot: string; submittedThisRun: number; isStillOpen?: (job: JobRow) => Promise<boolean> }`
  - `randomDelayMs(criteria: Criteria): number`

- [ ] **Step 1: Write the failing test**

`test/submit/guards.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { insertJob, getJobByFingerprint } from '../../src/db/jobs.js';
import { insertApplication } from '../../src/db/applications.js';
import { runGuards, randomDelayMs } from '../../src/submit/guards.js';
import type { Criteria } from '../../src/config/schema.js';
import type { JobRow } from '../../src/db/types.js';

const criteria: Criteria = {
  titles: { include: ['data analyst'], exclude: [] },
  experience: { max_years_required: 0 },
  locations: { include: ['remote'] },
  freshness: { max_posted_age_days: 7, verify_open_before_submit: true },
  scoring: { threshold: 60 },
  limits: { daily_cap: 2, per_company_open_applications: 2, min_delay_seconds: 45, max_delay_seconds: 120 },
  submission: { dry_run: false },
};

let db: Database;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'guards-'));
});

function makeJob(overrides: Partial<Record<string, unknown>> = {}): JobRow {
  const id = insertJob(db, {
    fingerprint: String(overrides.fingerprint ?? 'fp1'),
    boardId: null, source: 'greenhouse', sourceJobId: '1',
    url: 'https://x/1', company: String(overrides.company ?? 'Acme'),
    title: String(overrides.title ?? 'Data Analyst'), normTitle: 'data analyst',
    location: 'Remote', normLocation: 'remote',
    postedAt: '2026-07-30T00:00:00.000Z', jdText: 'jd', atsPlatform: 'greenhouse',
  })!;
  return getJobByFingerprint(db, String(overrides.fingerprint ?? 'fp1'))!;
}

const ctx = (over: Partial<Parameters<typeof runGuards>[0]> = {}) => ({
  db, criteria, blocklist: [], now: new Date('2026-08-01T00:00:00.000Z'),
  projectRoot: root, submittedThisRun: 0,
  isStillOpen: async () => true,
  job: makeJob(),
  ...over,
});

describe('runGuards — ordering and outcomes', () => {
  it('allows a clean job', async () => {
    expect(await runGuards(ctx())).toEqual({ allow: true });
  });

  it('blocks on dry-run before anything else', async () => {
    const result = await runGuards(ctx({
      criteria: { ...criteria, submission: { dry_run: true } },
    }));
    expect(result).toMatchObject({ allow: false, status: 'dry-run' });
  });

  it('blocks when the PAUSE file exists', async () => {
    writeFileSync(join(root, 'PAUSE'), '');
    const result = await runGuards(ctx());
    expect(result).toMatchObject({ allow: false, status: 'deferred' });
    expect(result).toHaveProperty('reason', expect.stringContaining('PAUSE'));
  });

  it('blocks a blocklisted company regardless of spelling', async () => {
    const result = await runGuards(ctx({
      blocklist: [{ name: 'ACME Corp Pvt Ltd', reason: 'current employer' }],
    }));
    expect(result).toMatchObject({ allow: false, status: 'skipped' });
    expect(result).toHaveProperty('reason', expect.stringContaining('blocklist'));
  });

  it('blocks a job that already has an application', async () => {
    const job = makeJob();
    insertApplication(db, { jobId: job.id, company: 'Acme', title: 'Data Analyst', method: 'api', emailUsed: null });
    const result = await runGuards(ctx({ job }));
    expect(result).toMatchObject({ allow: false, status: 'skipped' });
  });

  it('holds a near-duplicate title at the same company', async () => {
    const first = makeJob({ fingerprint: 'fp1', title: 'Data Analyst' });
    insertApplication(db, { jobId: first.id, company: 'Acme', title: 'Data Analyst', method: 'api', emailUsed: null });

    const second = makeJob({ fingerprint: 'fp2', title: 'Data Analyst II' });
    const result = await runGuards(ctx({ job: second }));
    expect(result).toMatchObject({ allow: false, status: 'held' });
  });

  it('allows a genuinely different role at the same company', async () => {
    const first = makeJob({ fingerprint: 'fp1', title: 'Data Analyst' });
    insertApplication(db, { jobId: first.id, company: 'Acme', title: 'Data Analyst', method: 'api', emailUsed: null });

    const second = makeJob({ fingerprint: 'fp2', title: 'Machine Learning Engineer' });
    expect(await runGuards(ctx({ job: second }))).toEqual({ allow: true });
  });

  it('defers when the per-company cap is reached', async () => {
    for (const [i, title] of ['Data Analyst', 'Data Engineer'].entries()) {
      const j = makeJob({ fingerprint: `seed${i}`, title });
      insertApplication(db, { jobId: j.id, company: 'Acme', title, method: 'api', emailUsed: null });
    }
    const result = await runGuards(ctx({ job: makeJob({ fingerprint: 'fp9', title: 'Business Analyst' }) }));
    expect(result).toMatchObject({ allow: false, status: 'deferred' });
    expect(result).toHaveProperty('reason', expect.stringContaining('per-company'));
  });

  it('defers when the daily cap is reached', async () => {
    const result = await runGuards(ctx({ submittedThisRun: 2 }));
    expect(result).toMatchObject({ allow: false, status: 'deferred' });
    expect(result).toHaveProperty('reason', expect.stringContaining('daily cap'));
  });

  it('closes a job that is no longer open', async () => {
    const result = await runGuards(ctx({ isStillOpen: async () => false }));
    expect(result).toMatchObject({ allow: false, status: 'closed' });
  });

  it('skips the liveness check when verify_open_before_submit is false', async () => {
    const isStillOpen = vi.fn(async () => false);
    const result = await runGuards(ctx({
      isStillOpen,
      criteria: { ...criteria, freshness: { ...criteria.freshness, verify_open_before_submit: false } },
    }));
    expect(isStillOpen).not.toHaveBeenCalled();
    expect(result).toEqual({ allow: true });
  });
});

describe('randomDelayMs', () => {
  it('stays within the configured bounds', () => {
    for (let i = 0; i < 50; i++) {
      const ms = randomDelayMs(criteria);
      expect(ms).toBeGreaterThanOrEqual(45_000);
      expect(ms).toBeLessThanOrEqual(120_000);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/submit/guards.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the guards**

`src/submit/guards.ts`:

```ts
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
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run test/submit/guards.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: nine ordered submission guards"
```

---

## Task 15: Submit adapters, liveness check and router

**Files:**
- Create: `src/submit/types.ts`, `src/submit/liveness.ts`, `src/submit/greenhouse.ts`, `src/submit/lever.ts`, `src/submit/ashby.ts`, `src/submit/workable.ts`, `src/submit/router.ts`
- Test: `test/submit/payloads.test.ts`, `test/submit/liveness.test.ts`

**Interfaces:**
- Consumes: `JobRow`, `Profile`, `AtsPlatform`, `parseApplyUrl`, `HttpError`
- Produces:
  - `interface SubmitPayload { endpoint: string; method: 'POST'; fields: Record<string, string>; files: { field: string; path: string }[] }`
  - `interface SubmitAdapter { platform: AtsPlatform; buildPayload(job, profile, resumePath): SubmitPayload; submit(payload): Promise<void> }`
  - `adapterFor(platform: AtsPlatform): SubmitAdapter | null`
  - `isStillOpen(job: JobRow): Promise<boolean>`

- [ ] **Step 1: Define the contract**

`src/submit/types.ts`:

```ts
import type { AtsPlatform } from '../config/schema.js';
import type { JobRow } from '../db/types.js';
import type { Profile } from '../tailor/resume.js';

export interface SubmitPayload {
  endpoint: string;
  method: 'POST';
  fields: Record<string, string>;
  files: { field: string; path: string }[];
}

export interface SubmitAdapter {
  platform: AtsPlatform;
  buildPayload(job: JobRow, profile: Profile, resumePath: string): SubmitPayload;
  submit(payload: SubmitPayload): Promise<void>;
}

export class SubmitError extends Error {}
```

- [ ] **Step 2: Write the failing payload test**

`test/submit/payloads.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { adapterFor } from '../../src/submit/router.js';
import type { JobRow } from '../../src/db/types.js';
import type { Profile } from '../../src/tailor/resume.js';

const profile: Profile = {
  name: 'Example Candidate', email: 'example.apply@gmail.com',
  phone: '+91 90000 00000', location: 'Bengaluru, India',
  links: { linkedin: 'https://linkedin.com/in/example' },
};

function job(over: Partial<JobRow>): JobRow {
  return {
    id: 1, fingerprint: 'fp', board_id: 1, source: 'greenhouse', source_job_id: '4012345',
    url: 'https://boards.greenhouse.io/acme/jobs/4012345', company: 'Acme',
    title: 'Data Analyst', norm_title: 'data analyst', location: 'Remote', norm_location: 'remote',
    posted_at: null, first_seen_at: '2026-08-01T00:00:00.000Z', jd_text: 'jd',
    ats_platform: 'greenhouse', min_years: 0, match_score: 80, status: 'tailored',
    status_reason: null, resume_path: 'C:/resumes/a.pdf', submitted_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    ...over,
  } as JobRow;
}

describe('greenhouse payload', () => {
  const payload = adapterFor('greenhouse')!.buildPayload(job({}), profile, 'C:/resumes/a.pdf');

  it('targets the job-board application endpoint', () => {
    expect(payload.endpoint).toContain('greenhouse.io');
    expect(payload.endpoint).toContain('4012345');
  });

  it('splits the name into first and last', () => {
    expect(payload.fields.first_name).toBe('Example');
    expect(payload.fields.last_name).toBe('Candidate');
  });

  it('carries the applicant email and phone', () => {
    expect(payload.fields.email).toBe('example.apply@gmail.com');
    expect(payload.fields.phone).toBe('+91 90000 00000');
  });

  it('attaches the tailored resume', () => {
    expect(payload.files).toEqual([{ field: 'resume', path: 'C:/resumes/a.pdf' }]);
  });
});

describe('lever payload', () => {
  const leverJob = job({
    ats_platform: 'lever', source_job_id: 'abc-123',
    url: 'https://jobs.lever.co/beta/abc-123',
  });
  const payload = adapterFor('lever')!.buildPayload(leverJob, profile, 'C:/resumes/a.pdf');

  it('targets the lever apply endpoint for the posting', () => {
    expect(payload.endpoint).toBe('https://jobs.lever.co/beta/abc-123/apply');
  });

  it('uses lever field names', () => {
    expect(payload.fields.name).toBe('Example Candidate');
    expect(payload.fields.email).toBe('example.apply@gmail.com');
  });
});

describe('adapterFor', () => {
  it('returns an adapter for each supported platform', () => {
    for (const p of ['greenhouse', 'lever', 'ashby', 'workable'] as const) {
      expect(adapterFor(p)).not.toBeNull();
    }
  });

  it('returns null for an unsupported platform', () => {
    expect(adapterFor('taleo' as never)).toBeNull();
  });
});

describe('every adapter', () => {
  it('never emits an empty email field', () => {
    for (const p of ['greenhouse', 'lever', 'ashby', 'workable'] as const) {
      const payload = adapterFor(p)!.buildPayload(job({ ats_platform: p }), profile, 'C:/r.pdf');
      expect(payload.fields.email ?? payload.fields['cards[0][fields][0][value]']).toBeTruthy();
    }
  });

  it('always attaches exactly one resume file', () => {
    for (const p of ['greenhouse', 'lever', 'ashby', 'workable'] as const) {
      expect(adapterFor(p)!.buildPayload(job({ ats_platform: p }), profile, 'C:/r.pdf').files).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 3: Implement the adapters**

`src/submit/greenhouse.ts`:

```ts
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { SubmitAdapter, SubmitPayload } from './types.js';
import { SubmitError } from './types.js';
import type { JobRow } from '../db/types.js';
import type { Profile } from '../tailor/resume.js';
import { parseApplyUrl } from '../discovery/urlparse.js';

export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') || parts[0] || '' };
}

/** Shared by all adapters: POST multipart/form-data built from the payload. */
export async function postMultipart(payload: SubmitPayload): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload.fields)) form.append(key, value);
  for (const file of payload.files) {
    form.append(file.field, new Blob([readFileSync(file.path)], { type: 'application/pdf' }), basename(file.path));
  }

  const res = await fetch(payload.endpoint, { method: 'POST', body: form });
  if (!res.ok) throw new SubmitError(`${payload.endpoint} returned HTTP ${res.status}`);
}

export const greenhouseAdapter: SubmitAdapter = {
  platform: 'greenhouse',

  buildPayload(job: JobRow, profile: Profile, resumePath: string): SubmitPayload {
    const parsed = parseApplyUrl(job.url);
    const token = parsed?.token ?? '';
    const jobId = job.source_job_id ?? parsed?.sourceJobId ?? '';
    const { first, last } = splitName(profile.name);

    return {
      endpoint: `https://boards.greenhouse.io/${token}/jobs/${jobId}`,
      method: 'POST',
      fields: {
        id: jobId,
        first_name: first,
        last_name: last,
        email: profile.email,
        phone: profile.phone,
        ...(profile.links.linkedin ? { 'job_application[answers_attributes][0][text_value]': profile.links.linkedin } : {}),
      },
      files: [{ field: 'resume', path: resumePath }],
    };
  },

  submit: postMultipart,
};
```

`src/submit/lever.ts`:

```ts
import type { SubmitAdapter, SubmitPayload } from './types.js';
import { postMultipart } from './greenhouse.js';
import type { JobRow } from '../db/types.js';
import type { Profile } from '../tailor/resume.js';
import { parseApplyUrl } from '../discovery/urlparse.js';

export const leverAdapter: SubmitAdapter = {
  platform: 'lever',

  buildPayload(job: JobRow, profile: Profile, resumePath: string): SubmitPayload {
    const parsed = parseApplyUrl(job.url);
    const token = parsed?.token ?? '';
    const postingId = job.source_job_id ?? parsed?.sourceJobId ?? '';

    return {
      endpoint: `https://jobs.lever.co/${token}/${postingId}/apply`,
      method: 'POST',
      fields: {
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
        ...(profile.links.linkedin ? { 'urls[LinkedIn]': profile.links.linkedin } : {}),
        ...(profile.links.github ? { 'urls[GitHub]': profile.links.github } : {}),
      },
      files: [{ field: 'resume', path: resumePath }],
    };
  },

  submit: postMultipart,
};
```

`src/submit/ashby.ts`:

```ts
import type { SubmitAdapter, SubmitPayload } from './types.js';
import { postMultipart } from './greenhouse.js';
import type { JobRow } from '../db/types.js';
import type { Profile } from '../tailor/resume.js';
import { parseApplyUrl } from '../discovery/urlparse.js';

export const ashbyAdapter: SubmitAdapter = {
  platform: 'ashby',

  buildPayload(job: JobRow, profile: Profile, resumePath: string): SubmitPayload {
    const parsed = parseApplyUrl(job.url);
    const jobId = job.source_job_id ?? parsed?.sourceJobId ?? '';

    return {
      endpoint: `https://jobs.ashbyhq.com/api/non-user-graphql?op=ApplyToJob`,
      method: 'POST',
      fields: {
        jobPostingId: jobId,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        ...(profile.links.linkedin ? { linkedin: profile.links.linkedin } : {}),
      },
      files: [{ field: 'resume', path: resumePath }],
    };
  },

  submit: postMultipart,
};
```

`src/submit/workable.ts`:

```ts
import type { SubmitAdapter, SubmitPayload } from './types.js';
import { postMultipart, splitName } from './greenhouse.js';
import type { JobRow } from '../db/types.js';
import type { Profile } from '../tailor/resume.js';
import { parseApplyUrl } from '../discovery/urlparse.js';

export const workableAdapter: SubmitAdapter = {
  platform: 'workable',

  buildPayload(job: JobRow, profile: Profile, resumePath: string): SubmitPayload {
    const parsed = parseApplyUrl(job.url);
    const token = parsed?.token ?? '';
    const shortcode = job.source_job_id ?? parsed?.sourceJobId ?? '';
    const { first, last } = splitName(profile.name);

    return {
      endpoint: `https://${token}.workable.com/api/v1/candidates/${shortcode}`,
      method: 'POST',
      fields: {
        firstname: first,
        lastname: last,
        email: profile.email,
        phone: profile.phone,
        address: profile.location,
      },
      files: [{ field: 'resume', path: resumePath }],
    };
  },

  submit: postMultipart,
};
```

`src/submit/router.ts`:

```ts
import type { AtsPlatform } from '../config/schema.js';
import type { SubmitAdapter } from './types.js';
import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import { ashbyAdapter } from './ashby.js';
import { workableAdapter } from './workable.js';

const ADAPTERS: Partial<Record<AtsPlatform, SubmitAdapter>> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  workable: workableAdapter,
};

export function adapterFor(platform: AtsPlatform): SubmitAdapter | null {
  return ADAPTERS[platform] ?? null;
}
```

**Endpoint caveat, read before flipping `dry_run` to false:** these endpoints
and field names are the documented/observable shapes, but each ATS varies per
tenant. Task 16 step 7 is a manual capture step that verifies them against a
real form before any live submission. Until that is done, dry-run logs are the
only output, which is exactly the intent.

- [ ] **Step 4: Write the liveness test**

`test/submit/liveness.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isStillOpen } from '../../src/submit/liveness.js';
import type { JobRow } from '../../src/db/types.js';

const job = {
  url: 'https://boards.greenhouse.io/acme/jobs/4012345',
  source_job_id: '4012345',
  ats_platform: 'greenhouse',
} as JobRow;

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}
afterEach(() => vi.unstubAllGlobals());

describe('isStillOpen', () => {
  it('returns true when the posting is present on the board', async () => {
    mockFetch({ jobs: [{ id: 4012345 }] });
    expect(await isStillOpen(job)).toBe(true);
  });

  it('returns false when the posting is gone from the board', async () => {
    mockFetch({ jobs: [{ id: 9999999 }] });
    expect(await isStillOpen(job)).toBe(false);
  });

  it('returns false when the board 404s', async () => {
    mockFetch({}, 404);
    expect(await isStillOpen(job)).toBe(false);
  });

  it('returns false on a network error rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    expect(await isStillOpen(job)).toBe(false);
  });

  it('returns false when the ats platform is unsupported', async () => {
    expect(await isStillOpen({ ...job, ats_platform: null } as JobRow)).toBe(false);
  });
});
```

`src/submit/liveness.ts`:

```ts
import type { JobRow } from '../db/types.js';
import { sourceFor } from '../sources/index.js';
import type { BoardRow } from '../db/types.js';
import { parseApplyUrl } from '../discovery/urlparse.js';

/**
 * Re-fetches the job's board and confirms the posting is still listed.
 * Any failure — 404, network error, unsupported platform — is treated as
 * "not open", because submitting into uncertainty is the worse outcome.
 */
export async function isStillOpen(job: JobRow): Promise<boolean> {
  if (!job.ats_platform) return false;

  const parsed = parseApplyUrl(job.url);
  if (!parsed) return false;

  const board: BoardRow = {
    id: job.board_id ?? 0,
    ats_platform: job.ats_platform,
    board_token: parsed.token,
    company_name: job.company,
    discovered_via: null,
    discovered_at: job.created_at,
    last_polled_at: null,
    active: 1,
  };

  const result = await sourceFor(job.ats_platform).fetchJobs(board);
  if (!result.ok) return false;

  const wanted = job.source_job_id ?? parsed.sourceJobId;
  if (!wanted) return false;

  return result.jobs.some((j) => j.sourceJobId === wanted);
}
```

- [ ] **Step 5: Run the submit suite**

Run: `npx vitest run test/submit`
Expected: PASS — guards, payload and liveness tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: tier a submit adapters, router and liveness check"
```

---

## Task 16: Orchestrator, run report and scheduling

**Files:**
- Create: `src/run/report.ts`, `src/run/daily.ts`
- Test: `test/run/report.test.ts`, `test/run/daily.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `interface RunReport { startedAt, finishedAt, boardsPolled, sourceFailures, discovered, fetched, deduped, filtered, scored, tailored, submitted, outcomes, unresolvedCompanies, unknownLocations }`
  - `writeReport(report: RunReport, dir: string): string` (returns path)
  - `formatReport(report: RunReport): string`
  - `runDaily(deps: RunDeps): Promise<RunReport>`

- [ ] **Step 1: Write the failing report test**

`test/run/report.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Implement the report**

`src/run/report.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  boardsPolled: number;
  discovered: number;
  fetched: number;
  deduped: number;
  filtered: Record<string, number>;
  scored: number;
  tailored: number;
  submitted: number;
  outcomes: Record<string, number>;
  sourceFailures: { source: string; error: string }[];
  unresolvedCompanies: string[];
  unknownLocations: string[];
}

export function emptyReport(startedAt: string): RunReport {
  return {
    startedAt, finishedAt: '', boardsPolled: 0, discovered: 0, fetched: 0,
    deduped: 0, filtered: {}, scored: 0, tailored: 0, submitted: 0,
    outcomes: {}, sourceFailures: [], unresolvedCompanies: [], unknownLocations: [],
  };
}

function section(title: string, lines: string[]): string {
  return lines.length ? `\n${title}\n${lines.map((l) => `  ${l}`).join('\n')}\n` : '';
}

export function formatReport(r: RunReport): string {
  const filtered = Object.entries(r.filtered).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';
  const outcomes = Object.entries(r.outcomes).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';

  return [
    `Run ${r.startedAt} → ${r.finishedAt}`,
    '',
    `  boards polled : ${r.boardsPolled}`,
    `  new boards    : ${r.discovered}`,
    `  fetched       : ${r.fetched}`,
    `  duplicates    : ${r.deduped}`,
    `  filtered out  : ${filtered}`,
    `  scored        : ${r.scored}`,
    `  tailored      : ${r.tailored}`,
    `  submitted     : ${r.submitted}`,
    `  outcomes      : ${outcomes}`,
    section('Source failures:', r.sourceFailures.map((f) => `${f.source}: ${f.error}`)),
    section('Companies that could not be resolved (add ats/token by hand):', r.unresolvedCompanies),
    section('Unrecognised locations (consider adding to the alias map):', r.unknownLocations),
  ].join('\n');
}

export function writeReport(r: RunReport, dir = 'runs'): string {
  mkdirSync(dir, { recursive: true });
  const stamp = r.startedAt.replace(/[:.]/g, '-');
  const path = join(dir, `run-${stamp}.txt`);
  writeFileSync(path, formatReport(r), 'utf8');
  return path;
}
```

- [ ] **Step 3: Write the failing orchestrator test**

`test/run/daily.test.ts` — the orchestrator is tested with every external
dependency injected, so the test is fully offline:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { upsertBoard } from '../../src/db/boards.js';
import { listJobsByStatus } from '../../src/db/jobs.js';
import { runDaily } from '../../src/run/daily.js';
import type { Criteria } from '../../src/config/schema.js';
import type { ExperienceEntry, Profile } from '../../src/tailor/resume.js';

const criteria: Criteria = {
  titles: { include: ['data analyst'], exclude: ['senior'] },
  experience: { max_years_required: 0 },
  locations: { include: ['bengaluru', 'remote'] },
  freshness: { max_posted_age_days: 7, verify_open_before_submit: true },
  scoring: { threshold: 40 },
  limits: { daily_cap: 30, per_company_open_applications: 3, min_delay_seconds: 0, max_delay_seconds: 0 },
  submission: { dry_run: true },
};

const profile: Profile = {
  name: 'Example Candidate', email: 'e@example.com', phone: '+91 90000 00000',
  location: 'Bengaluru', links: {},
};

const experience: ExperienceEntry[] = [{
  id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
  start: '2025-06', end: '2025-12',
  bullets: [{ id: 'a1', text: 'Built SQL pipelines', skills: ['sql'] }],
}];

let db: Database;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'daily-'));
  upsertBoard(db, { atsPlatform: 'greenhouse', boardToken: 'acme', companyName: 'Acme', discoveredVia: 'manual' });
});

function deps(over: Record<string, unknown> = {}) {
  return {
    db, criteria, blocklist: [], companies: [], projectRoot: root,
    resume: { profile, experience, education: [], skills: { sql: ['sql'], python: ['python'] } },
    now: new Date('2026-08-01T00:00:00.000Z'),
    fetchBoard: async () => ({
      ok: true,
      jobs: [{
        sourceJobId: '1', url: 'https://boards.greenhouse.io/acme/jobs/1',
        company: 'Acme', title: 'Data Analyst', location: 'Bengaluru',
        postedAt: '2026-07-31T00:00:00.000Z',
        jdText: 'Fresher role. SQL required. 0-2 years.', atsPlatform: 'greenhouse' as const,
      }],
    }),
    runDiscovery: async () => ({ hits: [], failures: [] }),
    resolveCompanies: async () => ({ resolved: [], unresolved: [] }),
    callLlm: async () => JSON.stringify({
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL pipelines' }] }],
      summary: 'Analyst.',
    }),
    render: vi.fn(async () => undefined),
    submit: vi.fn(async () => undefined),
    isStillOpen: async () => true,
    ...over,
  };
}

describe('runDaily', () => {
  it('runs the full funnel and reports each stage', async () => {
    const report = await runDaily(deps());
    expect(report.boardsPolled).toBe(1);
    expect(report.fetched).toBe(1);
    expect(report.tailored).toBe(1);
  });

  it('does not submit when dry_run is enabled', async () => {
    const d = deps();
    const report = await runDaily(d);
    expect(d.submit).not.toHaveBeenCalled();
    expect(report.outcomes['dry-run']).toBe(1);
    expect(report.submitted).toBe(0);
  });

  it('submits when dry_run is disabled', async () => {
    const d = deps({ criteria: { ...criteria, submission: { dry_run: false } } });
    const report = await runDaily(d);
    expect(d.submit).toHaveBeenCalledOnce();
    expect(report.submitted).toBe(1);
  });

  it('filters out a job requiring too many years before tailoring', async () => {
    const d = deps({
      fetchBoard: async () => ({
        ok: true,
        jobs: [{
          sourceJobId: '2', url: 'https://boards.greenhouse.io/acme/jobs/2',
          company: 'Acme', title: 'Data Analyst', location: 'Bengaluru',
          postedAt: '2026-07-31T00:00:00.000Z',
          jdText: 'Requires 3+ years of experience.', atsPlatform: 'greenhouse' as const,
        }],
      }),
      callLlm: vi.fn(),
    });
    const report = await runDaily(d);
    expect(report.tailored).toBe(0);
    expect(d.callLlm).not.toHaveBeenCalled();
    expect(listJobsByStatus(db, 'skipped')).toHaveLength(1);
  });

  it('does not re-insert a job seen on a previous run', async () => {
    await runDaily(deps());
    const second = await runDaily(deps());
    expect(second.deduped).toBe(1);
  });

  it('records source failures without aborting the run', async () => {
    const report = await runDaily(deps({
      runDiscovery: async () => ({ hits: [], failures: [{ source: 'adzuna', error: 'HTTP 429' }] }),
    }));
    expect(report.sourceFailures).toHaveLength(1);
    expect(report.fetched).toBe(1);
  });

  it('marks a job closed when it disappears from the board', async () => {
    await runDaily(deps());
    await runDaily(deps({ fetchBoard: async () => ({ ok: true, jobs: [] }) }));
    expect(listJobsByStatus(db, 'closed')).toHaveLength(1);
  });

  it('fails the job rather than rendering when the LLM fabricates', async () => {
    const d = deps({
      callLlm: async () => JSON.stringify({
        entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Led a team of 40 at Google for six years' }] }],
        summary: 'x',
      }),
    });
    await runDaily(d);
    expect(d.render).not.toHaveBeenCalled();
    expect(listJobsByStatus(db, 'failed')).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Implement the orchestrator**

`src/run/daily.ts`:

```ts
import { join } from 'node:path';
import { homedir } from 'node:os';
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
  for (const job of listJobsByStatus(db, 'tailored')) {
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

/** CLI entrypoint: `npm run daily` */
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
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
```

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — every test across config, db, normalize, sources, score,
tailor, resolve, discovery, submit and run.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: daily orchestrator and run report"
```

- [ ] **Step 7: First real dry run**

```bash
cp .env.example .env
```

Fill in `GEMINI_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` and
`APPLICANT_EMAIL`. Add at least five companies to `config/companies.yaml`.
Then:

```bash
npm run daily
```

Confirm from the printed report:
- boards resolved and polled without failures
- jobs fetched, filtered, and a plausible number tailored
- PDFs exist under `~/job-applications/<YYYY-MM>/`
- every submission shows outcome `dry-run` and nothing was sent

Open three of the generated PDFs and check every bullet against
`resume/experience.json`. If anything does not trace back, stop and fix the
anti-fabrication gate before going further.

- [ ] **Step 8: Verify the submit payloads against a real form**

For each of the four ATSes, open one real application form in a browser,
submit a test application to your own address, and capture the multipart POST
in DevTools (Network → the POST request → Payload). Compare field names
against `src/submit/*.ts` and correct any mismatch, updating
`test/submit/payloads.test.ts` to match. Do not skip this — the adapters
encode observed shapes, and tenants vary.

- [ ] **Step 9: Swap in the real resume**

Replace `resume/profile.json`, `resume/experience.json`, `resume/skills.json`
and `resume/education.json` with the real data. Then:

```bash
npx vitest run
npm run daily
```

Re-read three generated PDFs before continuing.

- [ ] **Step 10: Schedule the daily run**

```powershell
$action  = New-ScheduledTaskAction -Execute "npm" -Argument "run daily" -WorkingDirectory "C:\Users\Samiksha Batra\Desktop\Job_Automation"
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00am
Register-ScheduledTask -TaskName "JobPipelineDaily" -Action $action -Trigger $trigger -Description "Daily job application pipeline"
```

- [ ] **Step 11: Go live, deliberately**

Only after steps 7–9 look right on at least three consecutive dry runs:
set `submission.dry_run: false` in `config/criteria.yaml`, and lower
`limits.daily_cap` to `5` for the first live day. Raise it once you have seen
five real submissions land correctly.

Create a `PAUSE` file in the project root at any time to halt all submission
without stopping the fetch/tailor pipeline.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: live configuration and scheduled task"
```

---

## Task 17: Source health tracking and escalation

Spec §5.6 requires that a source failing three consecutive runs is escalated
in the run report. Per-run failures alone do not satisfy this — a source that
has been dead for a week must read differently from one that hiccupped once.

**Sequencing:** complete this task's code steps (1–9) before Task 16 steps
7–12. Task 16's code lands first, but its live-run steps should have health
escalation in place, since a silently dead adapter is exactly what you need
flagged during the first week of real runs.

**Files:**
- Modify: `src/db/schema.sql` (append the new table), `src/run/report.ts`, `src/run/daily.ts`
- Create: `src/db/health.ts`
- Test: `test/db/health.test.ts`

**Interfaces:**
- Consumes: `Database`
- Produces:
  - `recordSourceOutcome(db, source: string, ok: boolean): void`
  - `listUnhealthySources(db, threshold: number): { source: string; consecutive_failures: number; last_error_at: string }[]`
  - `RunReport.unhealthySources: { source: string; consecutiveFailures: number }[]`

- [ ] **Step 1: Append the table to `src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS source_health (
  source               TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_ok_at           TEXT,
  last_error_at        TEXT
);
```

- [ ] **Step 2: Write the failing test**

`test/db/health.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { recordSourceOutcome, listUnhealthySources } from '../../src/db/health.js';

let db: Database;
beforeEach(() => { db = openDb(':memory:'); });

describe('recordSourceOutcome', () => {
  it('counts consecutive failures', () => {
    for (let i = 0; i < 3; i++) recordSourceOutcome(db, 'adzuna', false);
    expect(listUnhealthySources(db, 3)[0].consecutive_failures).toBe(3);
  });

  it('resets the counter on a success', () => {
    recordSourceOutcome(db, 'adzuna', false);
    recordSourceOutcome(db, 'adzuna', false);
    recordSourceOutcome(db, 'adzuna', true);
    expect(listUnhealthySources(db, 1)).toEqual([]);
  });

  it('tracks sources independently', () => {
    for (let i = 0; i < 3; i++) recordSourceOutcome(db, 'adzuna', false);
    recordSourceOutcome(db, 'remotive', true);
    const unhealthy = listUnhealthySources(db, 3);
    expect(unhealthy).toHaveLength(1);
    expect(unhealthy[0].source).toBe('adzuna');
  });

  it('records timestamps for the last success and last failure', () => {
    recordSourceOutcome(db, 'hn', true);
    recordSourceOutcome(db, 'hn', false);
    const row = db.prepare('SELECT * FROM source_health WHERE source = ?').get('hn') as Record<string, string>;
    expect(row.last_ok_at).toMatch(/^\d{4}-/);
    expect(row.last_error_at).toMatch(/^\d{4}-/);
  });
});

describe('listUnhealthySources', () => {
  it('returns nothing below the threshold', () => {
    recordSourceOutcome(db, 'adzuna', false);
    recordSourceOutcome(db, 'adzuna', false);
    expect(listUnhealthySources(db, 3)).toEqual([]);
  });

  it('orders the worst offenders first', () => {
    for (let i = 0; i < 5; i++) recordSourceOutcome(db, 'adzuna', false);
    for (let i = 0; i < 3; i++) recordSourceOutcome(db, 'hn', false);
    expect(listUnhealthySources(db, 3).map((r) => r.source)).toEqual(['adzuna', 'hn']);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run test/db/health.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement health tracking**

`src/db/health.ts`:

```ts
import type { Database } from 'better-sqlite3';

export interface SourceHealthRow {
  source: string;
  consecutive_failures: number;
  last_ok_at: string | null;
  last_error_at: string | null;
}

export function recordSourceOutcome(db: Database, source: string, ok: boolean): void {
  const now = new Date().toISOString();
  if (ok) {
    db.prepare(
      `INSERT INTO source_health (source, consecutive_failures, last_ok_at)
       VALUES (?, 0, ?)
       ON CONFLICT(source) DO UPDATE SET consecutive_failures = 0, last_ok_at = excluded.last_ok_at`,
    ).run(source, now);
    return;
  }
  db.prepare(
    `INSERT INTO source_health (source, consecutive_failures, last_error_at)
     VALUES (?, 1, ?)
     ON CONFLICT(source) DO UPDATE SET
       consecutive_failures = source_health.consecutive_failures + 1,
       last_error_at = excluded.last_error_at`,
  ).run(source, now);
}

export function listUnhealthySources(db: Database, threshold: number): SourceHealthRow[] {
  return db
    .prepare(
      `SELECT * FROM source_health WHERE consecutive_failures >= ?
       ORDER BY consecutive_failures DESC, source ASC`,
    )
    .all(threshold) as SourceHealthRow[];
}
```

- [ ] **Step 5: Add the field to the report**

In `src/run/report.ts`, add to the `RunReport` interface:

```ts
  unhealthySources: { source: string; consecutiveFailures: number }[];
```

Add to `emptyReport`'s returned object: `unhealthySources: [],`

Add to `formatReport`, immediately after the source-failures section:

```ts
    section(
      'Sources failing repeatedly — investigate the adapter:',
      r.unhealthySources.map((s) => `${s.source}: ${s.consecutiveFailures} consecutive failures`),
    ),
```

- [ ] **Step 6: Wire it into the orchestrator**

In `src/run/daily.ts`, import:

```ts
import { recordSourceOutcome, listUnhealthySources } from '../db/health.js';
```

Add a constant beside the others:

```ts
const UNHEALTHY_AFTER_RUNS = 3;
```

In the board-polling loop, record the outcome for every board:

```ts
    const result = await fetchBoard(board);
    report.boardsPolled++;
    recordSourceOutcome(db, `${board.ats_platform}:${board.board_token}`, result.ok);
```

In the default discovery branch, record each discovery source likewise:

```ts
          const result = await source.search(queries, criteria);
          recordSourceOutcome(db, source.name, result.ok);
```

Immediately before `report.finishedAt` is set at the end of `runDaily`:

```ts
  report.unhealthySources = listUnhealthySources(db, UNHEALTHY_AFTER_RUNS)
    .map((s) => ({ source: s.source, consecutiveFailures: s.consecutive_failures }));
```

- [ ] **Step 7: Add an orchestrator test**

Append to `test/run/daily.test.ts`:

```ts
it('escalates a board that has failed three consecutive runs', async () => {
  const failing = deps({ fetchBoard: async () => ({ ok: false, jobs: [], error: 'HTTP 500' }) });
  await runDaily(failing);
  await runDaily(failing);
  const third = await runDaily(failing);

  expect(third.unhealthySources).toHaveLength(1);
  expect(third.unhealthySources[0]).toMatchObject({
    source: 'greenhouse:acme', consecutiveFailures: 3,
  });
});

it('clears the escalation once the board recovers', async () => {
  const failing = deps({ fetchBoard: async () => ({ ok: false, jobs: [], error: 'HTTP 500' }) });
  for (let i = 0; i < 3; i++) await runDaily(failing);

  const recovered = await runDaily(deps());
  expect(recovered.unhealthySources).toEqual([]);
});
```

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS — every test, including the two new escalation tests

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: source health tracking and repeated-failure escalation"
```

---

## Notes for the implementer

**Do not weaken a test to make it pass.** The years-extraction suite (Task 5)
and the anti-fabrication suite (Task 8) encode the two rules that determine
whether this system is useful and whether it is safe. If one fails, the
implementation is wrong.

**Sources break silently.** When a board returns zero jobs for several days,
suspect the adapter before concluding there are no jobs. The fixture tests
catch shape changes, not endpoint changes.

**Dry-run is the default for a reason.** Every guard has a test, but the
adapters post to real employers. Task 16 step 8 exists because the payload
shapes are the one part of this system that cannot be verified offline.

