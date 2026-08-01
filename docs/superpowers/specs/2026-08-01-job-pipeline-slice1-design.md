# Job Application Pipeline — Slice 1 Design

**Date:** 2026-08-01
**Status:** Approved for planning
**Scope:** Slice 1 of 4. Derived from `job-automation-roadmap.md`.

---

## 1. Purpose

A locally-run pipeline that finds AI/ML/Data roles matching an entry-level (0–2 years) candidate targeting India and remote-global positions, tailors a resume to each, and submits automatically where the ATS allows it.

Success: tailored PDFs and submitted applications appear every morning without manual work, and nothing is ever submitted twice or sent to a blocked company.

---

## 2. Scope

### In scope
- Company registry driven by a user-editable file, plus automatic discovery of new companies
- Board polling for Greenhouse, Lever, Ashby, Workable
- Discovery via Adzuna, HN "Who is Hiring", Remotive, LinkedIn guest endpoint
- Deduplication, hard filtering, deterministic match scoring
- Freshness filtering and pre-submit verification that a posting is still open
- LLM-assisted resume tailoring with anti-fabrication constraints
- Typst PDF rendering and local archiving
- Tier A (API) submission with dry-run default and hard safety guards

### Out of scope (later slices)
- **Slice 2:** Gmail polling, email classification, Excel tracker
- **Slice 3:** Naukri, Indeed, expanded LinkedIn ingestion
- **Slice 4:** Tier B Playwright agent submission, Tier C review queue, Oracle Cloud deployment

---

## 3. Key decisions and rationale

| Decision | Choice | Rationale |
|---|---|---|
| Orchestration | Plain Node entrypoint + Windows Task Scheduler | The roadmap's n8n adds a container, UI, and credential store whose only job is invoking our own code on a schedule. Removed. |
| Host | Local Windows | Nothing in slice 1 needs a server. Keeps Oracle ARM capacity availability off the critical path. Deployment is slice 4. |
| Database | SQLite via `better-sqlite3` | Single-user, ~100 rows/day. Removes the Docker requirement entirely. All SQL confined to `src/db/` so the Postgres swap in slice 4 is contained. |
| LLM | Gemini Flash (free tier) | Free daily quota sufficient given the small-payload design. |
| PDF | Typst | ~30MB binary, ~50ms compile, vs LaTeX's 4GB. |
| Discovery | Enabled, discovered companies auto-apply | User decision. Maximises reach; mitigated by blocklist and per-company caps. |
| Submission | Tier A only, dry-run by default | Submission is the only irreversible action in the system. |

### Schema adaptations from the roadmap
- `TIMESTAMPTZ` → ISO-8601 `TEXT`
- `TEXT[]` (`applications.thread_ids`) → JSON `TEXT`
- `BIGSERIAL` → `INTEGER PRIMARY KEY AUTOINCREMENT`

---

## 4. Architecture

### 4.1 Company discovery model

Greenhouse, Lever and Ashby expose **no global search API** — a board can only be queried if its token is already known. The system therefore separates two concerns:

- **Discovery** (fragile, low-volume): search aggregators are queried by keyword and location. Each result's apply URL is parsed — `boards.greenhouse.io/{token}/...` yields the ATS platform and board token for free. New tokens are written to `company_boards`.
- **Harvesting** (reliable, high-volume): every active token in `company_boards` is polled daily through the official free API, returning full structured JDs with no bot detection or rate limiting.

The registry compounds: discovery matters most in week 1 and becomes a trickle as the registry fills. A discovery source failing degrades the rate of new company acquisition, never the daily job feed.

### 4.2 Configuration files

All user-editable, plain text, read fresh on every run. No restart or code change required.

**`config/companies.yaml`** — ships empty with format comments; the user populates it.
```yaml
companies:
  - name: Example Corp          # ats and token auto-resolved on first run
  - name: Another Startup
    paused: true                # remain listed, stop applying
  - name: Hard To Resolve Inc
    ats: lever                  # manual override when resolution fails
    token: hardtoresolve
```

**`config/blocklist.yaml`**
```yaml
blocked:
  - name: Current Employer Pvt Ltd
    reason: current employer
```

**`config/criteria.yaml`**
```yaml
titles:
  include: [ai engineer, ai automation engineer, ml engineer, machine learning engineer,
             data analyst, data engineer, data scientist, analytics engineer,
             applied scientist, nlp engineer, mlops engineer]
  exclude: [senior,principal,director]
experience:
  max_years_required: 0         # reject if the JD's MINIMUM stated years exceeds this;
                                # "0-2 years" has a minimum of 0 and passes
locations:
  include: [bengaluru,delhi, gurugram, noida, remote]
freshness:
  max_posted_age_days: 7        # older postings are never applied to
  verify_open_before_submit: true
scoring:
  threshold: 60
limits:
  daily_cap: 30
  per_company_open_applications: 3
  min_delay_seconds: 45
  max_delay_seconds: 120
submission:
  dry_run: true                 # must be flipped manually to go live
```

### 4.3 Module layout

Each module has one responsibility and is testable in isolation.

```
src/
  config/       load + schema-validate all YAML and .env; fail loudly on malformed input
  db/           schema, migrations, typed queries          [only location containing SQL]
  resolve/      company name → {ats, token}; emits an unresolved-names report
  sources/      types.ts, greenhouse.ts, lever.ts, ashby.ts, workable.ts
  discovery/    adzuna.ts, hn-whoishiring.ts, remotive.ts, linkedin-guest.ts,
                urlparse.ts   (apply URL → {ats, token, company})
  score/        extract.ts (JD → skills, seniority, years-required)
                score.ts   (hard filters, then weighted match)
  tailor/       select.ts  (deterministic bullet preselection)
                llm.ts     (Gemini call, strict JSON schema, validate + retry)
                render.ts  (Typst → PDF)
  submit/       router.ts, greenhouse.ts, lever.ts, ashby.ts, workable.ts,
                guards.ts  (all safety rails)
  run/          daily.ts   (orchestrator), report.ts
resume/         profile.json, experience.json, skills.json, education.json
```

### 4.4 Daily run sequence

1. Load and validate config; abort on malformed config
2. Resolve any unresolved company names → `company_boards`
3. Poll every active board (fault-isolated per source)
4. Run discovery sources; parse apply URLs; register newly found tokens
5. Normalize titles and locations, compute fingerprints, dedupe against `jobs`
6. Mark any previously-seen job now absent from its board as `closed`
7. Hard filters: posting age, years-required, title family, location
8. Weighted match score; drop below threshold
9. Tailor survivors: bullet preselect → LLM → schema validation → Typst PDF
10. Submit through guards
11. Write run report

---

## 5. Component detail

### 5.1 Title and location normalization, fingerprinting

Before fingerprinting, titles are normalized: lowercased, seniority prefixes and location/bracketed suffixes stripped, and a known alias map applied (`ml` → `machine learning`, `sr` → `senior`, `sde` → `software engineer`).

Locations are normalized against an alias map before being matched against `criteria.locations`, because job postings rarely use the same spelling as the config. At minimum: `bangalore | blr | bengaluru`, `gurgaon | gurugram`, `new delhi | delhi ncr | ncr | delhi`, `greater noida | noida`, `remote | anywhere | worldwide | work from home | remote - india`. Unmatched location strings are recorded in the run report so the map can be extended from real data rather than guesswork.

`fingerprint = sha256(normalized_company + normalized_title + normalized_location)`, `UNIQUE` in `jobs`. The same role found via multiple sources collapses to one row and one application.

### 5.2 Freshness and open-status verification

Only currently-open, recently-posted roles are applied to. This is enforced at two points.

**At filter time — posting age.** Each source maps its own field to `jobs.posted_at`: Greenhouse `updated_at`, Lever `createdAt`, Ashby `publishedAt`, Workable `published_on`. Discovery sources vary and some omit it entirely; when `posted_at` cannot be determined, the job's `first_seen_at` is used as a conservative substitute. Any job older than `freshness.max_posted_age_days` is marked `stale` and never scored or tailored, so no LLM spend is incurred on dead postings.

**At submit time — liveness re-check.** Board listings and aggregator results both go out of date between fetch and submission, and aggregators in particular surface roles that have already been filled. When `verify_open_before_submit` is set, the job is re-fetched from its ATS API immediately before submitting. If it returns 404, or is absent from the board's current listing, or is flagged closed, the job is marked `closed` and skipped. This is the last guard before the payload is sent.

Separately, any job in the database that disappears from its board on a subsequent poll is marked `closed`. This keeps the per-company open-application count honest — a closed application frees its slot under the per-company cap.

Status enum extends with `stale` and `closed`.

### 5.3 Scoring

Ordered so that free operations eliminate the majority before any paid one runs.

**Hard filters (free, reject outright):**
- Posting age exceeds `freshness.max_posted_age_days`
- The **minimum** years of experience the JD requires exceeds `experience.max_years_required`
- Normalized title matches an `exclude` term or matches no `include` term
- Normalized location matches no `include` term

**Extracting the years requirement.** The candidate has internship experience only and no full-time corporate experience, so `max_years_required` is 0 and this extraction determines almost the entire feed. It compares against the **lower bound** of whatever range the JD states, not the upper:

| JD phrasing | Extracted minimum | Passes at 0 |
|---|---|---|
| "0–2 years of experience" | 0 | yes |
| "0–1 years", "up to 2 years" | 0 | yes |
| "fresher", "new grad", "entry level", no statement at all | 0 | yes |
| "1+ years", "minimum 1 year" | 1 | no |
| "2–4 years" | 2 | no |
| "3 years preferred" | 3 | no |

Getting this wrong in either direction is costly — too strict and the feed is empty, too loose and it fills with roles that auto-reject. It therefore gets its own test suite of real posting phrasings (§6), and every extraction result is recorded so the rules can be corrected against actual data.

Internship experience counts as qualifying: JD text accepting or preferring internship experience is treated as satisfying the requirement, not as a demand for full-time years.

**Weighted score (free, 0–100):** skill overlap between JD-extracted skills and `skills.json` (with alias expansion), title similarity, and experience fit. Explicit fresher signals in the JD — "fresher", "new grad", "campus hire", "entry level", "0–1", "0–2", "internship experience welcome" — add a positive weight, since those postings are meaningfully more winnable for this candidate than ones that merely fail to state a requirement. Below `threshold`, the job is marked `skipped` and never reaches the LLM.

Expected survival to the LLM stage: 10–20% of fetched jobs. This is the primary mechanism keeping usage inside the Gemini free tier.

### 5.4 Tailoring

Payload is deliberately minimal: the ~15 extracted JD keywords, plus candidate bullets from the 2 most relevant roles in `experience.json`. Approximately 800 tokens in, 400 out. Neither the full resume nor the full JD is ever sent.

The model may reorder bullets, reword them to surface JD terminology, and select which to include. It may **not** invent employers, titles, dates, metrics, or any skill absent from `skills.json`. Output must satisfy a strict JSON schema; validation failure triggers one retry, then the job is marked `failed` and skipped.

A post-validation check confirms every returned bullet traces to a source bullet in `experience.json` by fuzzy match. This is a hard gate: fabricated content fails the job rather than reaching a PDF.

Rendered to `~/job-applications/{YYYY-MM}/{Company}_{Role}_{YYYYMMDD}.pdf`.

### 5.5 Submission guards

Every guard is evaluated immediately before each individual submission, in this order. Any failure skips the job with a recorded reason.

1. **Dry-run** — if enabled, the exact payload is written to the run log and nothing is sent
2. **Kill switch** — presence of a `PAUSE` file in the project root halts all submission
3. **Blocklist** — company matched against `blocklist.yaml`, re-read at submit time so late additions take effect on already-queued jobs
4. **Fingerprint dedupe** — a fingerprint with an existing `applications` row is never resubmitted
5. **Near-duplicate title** — fuzzy match ≥85% against prior applications at the same company sets status `held` rather than sending
6. **Per-company cap** — maximum 3 concurrently open applications per company (configurable); when exceeded, the highest-scoring roles take the slots and the remainder are set to `deferred`
7. **Daily cap** — 30 submissions per day; excess is set to `deferred`
8. **Still open** — the posting is re-fetched from its ATS API and confirmed live; a 404, absence from the board listing, or a closed flag marks the job `closed` and skips it (see §5.2)
9. **Jitter** — randomized 45–120s delay between submissions

Slice 1 has no review UI — that is slice 4. Held and deferred jobs are therefore surfaced in the run report with their reason, and their tailored PDFs remain on disk so they can be submitted manually. `deferred` jobs are automatically reconsidered on the next run; `held` jobs are not, and require the user to act.

This extends the roadmap's status enum to:
`new → scored → tailored → queued → submitted | failed | skipped | held | deferred | stale | closed`

A run whose failure rate exceeds 30% auto-pauses before the submission stage.

### 5.6 Error handling

Sources are independently fault-isolated: any source may fail without affecting others, and each reports partial success. A source failing three consecutive runs is escalated in the run report. All failures are recorded with a reason; nothing fails silently.

---

## 6. Testing strategy

| Component | Approach |
|---|---|
| Source and discovery parsers | Recorded-fixture tests against saved real API responses. Adapter breakage fails a test rather than producing a silent zero-results day. |
| URL parser | Table-driven tests across all four ATS URL shapes plus malformed input |
| Title normalization / fingerprint | Unit tests, including the near-duplicate cases the guard must catch |
| Location aliasing | Unit tests over real posting strings ("Bangalore, India", "Remote - India", "Gurgaon/Gurugram") |
| Freshness and liveness | Unit tests on the age filter incl. missing `posted_at`; mocked 404 / delisted / closed responses for the pre-submit re-check |
| Years-requirement extraction | Dedicated table-driven suite over real posting phrasings ("0-2 years", "1+ years", "minimum 2", "fresher", "recent graduate", unstated). Highest-consequence rule in the system — it alone determines feed size at `max_years_required: 0`. |
| Scorer | Unit tests against hand-labelled JDs with known expected outcomes, including fresher-signal weighting |
| Tailoring | Schema validation tests; anti-fabrication gate tested with a deliberately fabricating mock response |
| Submit adapters | Snapshot tests on generated payloads. Never tested against live endpoints outside the weekly canary. |
| Guards | Unit tests per guard, plus an integration test asserting ordering |

---

## 7. Build order

Value-first. Each step produces something usable.

1. Config loading, DB schema, resume JSON conversion
2. Greenhouse source + title normalization + fingerprinting + dedupe
3. Scoring (extract, hard filters, weighted score)
4. Tailoring + Typst rendering → **first real output: tailored PDFs**
5. Remaining sources (Lever, Ashby, Workable) + name resolver
6. Discovery sources + URL parser + token registration
7. Guards
8. Tier A submit adapters, dry-run
9. Run report + scheduled task

Steps 1–4 constitute the value spike and are useful before submission exists at all.

---

## 8. Prerequisites

- Gemini API key from aistudio.google.com
- Typst binary installed and on PATH
- Adzuna free API credentials (app id + key)
- Existing resume converted to `profile.json`, `experience.json`, `skills.json`, `education.json` — with 8–10 candidate bullets per entry, as bullet variety is what makes tailoring effective. Since the candidate's background is internships and projects rather than full-time roles, `experience.json` holds internships, significant projects, and coursework-derived work as first-class entries; projects carry as much tailoring weight as employment here.
- `config/companies.yaml` populated by the user

---

## 9. Accepted trade-offs

- **Discovered companies are applied to without review.** Chosen for reach. Mitigated by the blocklist, per-company cap, daily cap, and dry-run default.
- **Local execution means the pipeline runs only when the machine is on.** Accepted; deployment is slice 4.
- **Tier A coverage only.** ATSes outside Greenhouse/Lever/Ashby/Workable are recorded but not submitted to in slice 1.
- **Entry-level AI/ML/Data is a contested segment** and many roles titled "AI Engineer" require 3+ years. The system optimises targeting quality over volume.
- **`max_years_required: 0` is deliberately strict** and is the single biggest constraint on feed size. It admits only postings whose stated minimum is zero — fresher, new-grad, "0–1", "0–2", and postings stating no requirement at all. This is correct for a candidate with internship-only experience, but it means the daily cap of 30 will rarely be the binding limit; supply will be. If the feed proves thin after a week of real data, raising this to 1 is the first lever to pull, and the recorded extraction results will show exactly how many roles that would add.
