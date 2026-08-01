# Automated Job Application Pipeline — Build Roadmap

**Target:** ₹0/month running cost. Daily fetch → tailor → auto-apply → track in Gmail → log to Excel.
**Timeline:** 6 weeks part-time, useful output from week 2.

---

## 0. The honest constraint (read once, then we move on)

Everything you asked for is buildable except one thing: **100% auto-submit across all platforms is not achievable by anyone**, including paid services that claim it. The blockers are technical, not policy:

- Captchas that require a solve (hCaptcha/reCAPTCHA v2) cannot be bypassed without a paid solving service (~₹150 per 1000 solves — breaks your ₹0 target)
- Workday, iCIMS, Taleo and SuccessFactors have per-tenant form variants numbering in the thousands
- LinkedIn Easy Apply automation reliably ends in account restriction, which costs you more than it saves

So the system is designed as **auto-submit where the platform allows it, one-click-submit where it doesn't**. Realistic split: 40–55% fully automatic, the rest reduced to a single click from a pre-filled queue. That is still ~90% of the time saved, and it is the correct engineering answer, not a compromise.

Everything else — multi-source fetching, JD extraction, ATS-friendly tailoring, local PDF archiving, Gmail tracking, Excel logging — is fully automatic, exactly as specified.

---

## 1. Stack (chosen for ₹0)

| Layer | Choice | Why | Cost |
|---|---|---|---|
| Host | Oracle Cloud **Always Free** ARM VM (4 vCPU, 24GB RAM) | Permanently free, not a trial. Runs everything with room to spare. | ₹0 |
| Orchestration | n8n Community, Docker | Unlimited executions self-hosted | ₹0 |
| Database | Postgres container | Replaces Supabase; no free-tier row caps | ₹0 |
| Adapter service | Node 20 + TypeScript + Fastify | Where all scraping/submitting logic lives | ₹0 |
| LLM | Gemini Flash (free tier) | Free daily quota; verify current caps at aistudio.google.com | ₹0 |
| PDF render | Typst | 30MB binary, ~50ms compile. LaTeX is 4GB and slow. | ₹0 |
| Browser tier | Playwright + Chromium | Self-hosted, no Browserless subscription | ₹0 |
| Excel | `exceljs` writing a local `.xlsx` | No Google Sheets API quota to manage | ₹0 |
| Email | Gmail API | Free quota is far above our needs | ₹0 |
| Remote access | Tailscale free tier | No domain, no SSL cert, no public port | ₹0 |

**Skip these** (the article recommends them, they cost money and you don't need them):
Apify (credits burn fast — write your own fetchers), Hostinger VPS (Oracle free tier is better hardware), Supabase (local Postgres is fine), n8n Cloud.

**Only unavoidable cost:** residential proxies, *if* Naukri/LinkedIn start blocking your VM's IP. Budget ₹0 initially, ₹400–700/month only if you actually hit blocks. Try without first.

---

## 2. Data model

Design this before writing code — everything else hangs off it.

```sql
CREATE TABLE jobs (
  id              BIGSERIAL PRIMARY KEY,
  fingerprint     TEXT UNIQUE NOT NULL,   -- sha256(normalized_company + normalized_title + location)
  source          TEXT NOT NULL,          -- linkedin | naukri | greenhouse | lever | ashby | ycombinator | indeed
  source_job_id   TEXT,
  url             TEXT NOT NULL,
  company         TEXT NOT NULL,
  title           TEXT NOT NULL,
  location        TEXT,
  salary_min      INTEGER,                -- normalized to INR annual
  salary_max      INTEGER,
  salary_source   TEXT,                   -- 'posted' | 'inferred' | 'unknown'
  posted_at       TIMESTAMPTZ,
  jd_text         TEXT,
  jd_fetched_at   TIMESTAMPTZ,
  ats_platform    TEXT,                   -- detected from apply URL
  match_score     NUMERIC,
  status          TEXT NOT NULL DEFAULT 'new',
  -- new → scored → tailored → queued → submitted → failed → skipped
  resume_path     TEXT,
  submitted_at    TIMESTAMPTZ,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE applications (
  id            BIGSERIAL PRIMARY KEY,
  job_id        BIGINT REFERENCES jobs(id),
  applied_at    TIMESTAMPTZ,
  method        TEXT,        -- 'api' | 'agent' | 'manual'
  email_used    TEXT,
  outcome       TEXT DEFAULT 'awaiting',
  -- awaiting | acknowledged | rejected | screening | interview | offer | ghosted
  last_email_at TIMESTAMPTZ,
  thread_ids    TEXT[]
);

CREATE TABLE email_events (
  id            BIGSERIAL PRIMARY KEY,
  application_id BIGINT REFERENCES applications(id),
  gmail_msg_id  TEXT UNIQUE,
  received_at   TIMESTAMPTZ,
  from_domain   TEXT,
  subject       TEXT,
  classified_as TEXT,
  confidence    NUMERIC
);
```

**Fingerprint matters.** The same job appears on LinkedIn, Indeed, and the company's Greenhouse board. Dedupe on normalized company+title+location, not URL, or you will apply three times to one role.

**Resume as structured JSON**, not a PDF or text blob:

```
profile.json          # name, contact, links — never touched by the LLM
experience.json       # each role: company, dates, and 6-10 candidate bullets
skills.json           # canonical skill list, with aliases: {"k8s": ["kubernetes"]}
education.json
```

Tailoring then becomes *selecting and rewording existing bullets*, not generating new ones. This is both cheaper and structurally prevents fabrication.

---

## 3. Phases

### Phase 0 — Foundations (2–3 days)

1. Create Oracle Cloud Always Free account, provision Ampere A1 ARM instance (Ubuntu 22.04). Note: free ARM capacity is often exhausted in popular regions — retry, or pick a less busy region.
2. Install Tailscale. Do **not** open port 5678 to the internet.
3. `docker-compose.yml` with: n8n, postgres, adapter-service, playwright.
4. Create dedicated Gmail alias for applications (`yourname.apply@gmail.com`). Every application uses this. Keeps tracking clean and gives you a kill switch.
5. Convert your resume into the JSON files above. Write 8–10 candidate bullets per role — variety here is what makes tailoring work later.
6. Set up Google Cloud project → enable Gmail API → OAuth credentials (desktop app type).

**Done when:** n8n loads over Tailscale, Postgres accepts connections, resume JSON validates against a schema.

### Phase 1 — Ingestion (5–7 days)

Build one adapter interface, then implement per source:

```ts
interface JobSource {
  name: string;
  fetch(criteria: SearchCriteria): Promise<RawJob[]>;
  fetchJD(job: RawJob): Promise<string>;
}
```

Implement in this order — easiest and highest-signal first:

1. **Greenhouse** — `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`. Public, no auth, JD included in the response. Build a list of ~200 board tokens for companies you care about.
2. **Lever** — `api.lever.co/v0/postings/{company}?mode=json`. Same pattern.
3. **Ashby** — public GraphQL at `jobs.ashbyhq.com/api/non-user-graphql`. Capture the exact query from devtools; it changes occasionally.
4. **Y Combinator (Work at a Startup)** — `workatastartup.com` has an internal JSON API behind login. Playwright session, save cookies, reuse.
5. **Naukri** — their SPA calls an internal search API. Open devtools → Network → filter XHR → replay the request. Rotates auth headers periodically; expect maintenance.
6. **LinkedIn** — the guest job-search endpoint (`linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`) returns HTML without login. Rate-limit yourself hard: 1 request per 3–5s, max ~200/day.
7. **Indeed** — heavy bot detection. Attempt last, accept partial success.

Filtering happens in code, not the LLM: role keywords, location, `salary_min`, posted within 48h.

**Done when:** a daily cron populates `jobs` with 30–80 deduped rows and no duplicates across sources.

### Phase 2 — Scoring and tailoring (4–5 days)

The cost-minimization core. **Do not send the full resume and full JD to an LLM for every job** — that's what makes these systems expensive.

Three-step pipeline:

1. **Deterministic keyword extraction** (free, no LLM): tokenize JD, match against your canonical skill dictionary + a general tech-term list. Output: required skills, preferred skills, seniority signals.
2. **Match score** (free): weighted overlap between JD skills and your `skills.json`, plus title similarity and years-of-experience fit. Score 0–100. **Kill anything below your threshold here** — typically 60. This alone cuts LLM calls by 50–60%.
3. **LLM call, minimal payload** (only for survivors): send the ~15 extracted keywords, the 8 candidate bullets for the 2 most relevant roles, and ask for reordering + rewording. Roughly 800 tokens in, 400 out. Not the whole resume, not the whole JD.

Tailoring prompt must be constrained:
- May reorder bullets, reword them to surface JD terminology, and select which to include
- May **not** invent employers, titles, dates, metrics, or skills absent from `skills.json`
- Output must be strict JSON matching a schema — validate it, reject and retry on failure

Then render via Typst → PDF. Save to:
```
~/job-applications/{YYYY-MM}/{Company}_{Role}_{YYYYMMDD}.pdf
```

**Done when:** you get 20 tailored PDFs a morning and, spot-checking five, every claim traces to your base resume.

### Phase 3 — Submission (7–10 days, the hard part)

Router detects ATS from the apply URL, dispatches to an adapter, falls back gracefully.

**Tier A — API submission (fully automatic).** Greenhouse, Lever, Ashby, Workable. Method: open the real application form in a browser, submit a test application to your own email, capture the exact multipart POST in devtools, replay it from code. Each adapter is ~80 lines. Write a canary test per adapter that runs weekly against a known job — these endpoints break silently.

**Tier B — Agent submission (mostly automatic).** Playwright loads the page, extracts all form fields, a single LLM call maps fields to your profile schema, code fills and screenshots. Then:
- No captcha + confidence > 0.85 → submit automatically
- Otherwise → screenshot + pre-filled state into the review queue

**Tier C — Review queue.** A minimal local web page listing pending applications with screenshot, tailored PDF, and a Submit button that resumes the Playwright session. Target: under 5 seconds per application.

Hard safety rails, non-negotiable:
- Global daily cap (start at 15/day, raise slowly)
- 45–120s randomized delay between submissions
- Never submit twice to the same fingerprint
- Dry-run mode that logs the payload without sending — use this for the first week

**Done when:** Tier A submits reliably, Tier B clears >50% without intervention, and nothing has double-applied.

### Phase 4 — Gmail tracking and Excel logging (4–5 days)

Poll Gmail every 30 minutes (cheaper and simpler than Pub/Sub push, and 30-minute latency is irrelevant here).

Classification, cost-minimized — **rules first, LLM only for leftovers**:

1. Match sender domain against companies in `applications` → links email to the right application
2. Regex/keyword rules catch ~80%: "unfortunately", "not moving forward", "regret" → rejected; "schedule", "availability", "interview" → interview; "assessment", "coding challenge" → screening; "received your application" → acknowledged
3. Only ambiguous remainder goes to the LLM — roughly 3–5 calls a day

Update `applications.outcome`, write to `email_events`, then regenerate the Excel file.

**Excel sheet layout** (`~/job-applications/tracker.xlsx`, rewritten on every update):

| Column | Source |
|---|---|
| Applied date | `applications.applied_at` |
| Company | `jobs.company` |
| Role | `jobs.title` |
| Location | `jobs.location` |
| Salary (min–max) | `jobs.salary_min/max` |
| Source platform | `jobs.source` |
| Match score | `jobs.match_score` |
| Submit method | api / agent / manual |
| Resume file | hyperlink to local PDF |
| Job link | `jobs.url` |
| Status | `applications.outcome` |
| Last contact | `applications.last_email_at` |
| Latest email subject | most recent `email_events` row |
| Days since applied | computed |

Conditional formatting: red for rejected, amber for ghosted (>21 days silent), green for interview/offer.

**Done when:** an interview invite arriving at 2am shows up correctly in the sheet by 2:30am without you touching anything.

### Phase 5 — Hardening (ongoing)

- Weekly canary tests per adapter, alerting on failure
- Daily digest email: applied, queued, failed, replies received
- Auto-pause the whole pipeline if failure rate exceeds 30% in a run
- Quarterly: refresh base resume bullets from any new work

---

## 4. Cost summary

| Item | Monthly |
|---|---|
| Oracle Cloud Always Free VM | ₹0 |
| n8n, Postgres, Playwright, Typst | ₹0 |
| Gemini Flash (within free tier) | ₹0 |
| Gmail API | ₹0 |
| Tailscale | ₹0 |
| **Baseline total** | **₹0** |
| Proxies (only if blocked) | ₹0–700 |
| Captcha solving (optional, Tier B) | ₹0–200 |

Staying inside the Gemini free tier is the main thing to watch. At ~25 tailoring calls/day plus ~5 classification calls, with the small-payload design above, you should sit comfortably under the daily cap. Check current limits at aistudio.google.com before you scale up the daily job count.

---

## 5. Realistic expectations

- **Week 2:** tailored PDFs land in your folder every morning. Real value already.
- **Week 4:** Tier A auto-submits. Roughly 10–20 fully automatic applications/day.
- **Week 6:** tracking closes the loop; the Excel sheet becomes your single source of truth.
- **Maintenance:** expect ~2 hours/month fixing broken adapters. This is permanent, not a bug.

One strategic note worth keeping in view: response rate is driven far more by targeting and referrals than by volume. The system's real value is that it makes 20 well-matched applications cost you the effort of zero — not that it lets you fire off 200.
