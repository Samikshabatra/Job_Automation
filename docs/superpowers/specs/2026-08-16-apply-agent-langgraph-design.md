# Apply-Agent — LangGraph Browser-Driven Submission

**Status:** approved design, not yet planned or implemented
**Date:** 2026-08-16
**Sub-project of:** LangGraph multi-agent rearchitecture (Apply-agent is the first
of three sub-projects; Resume-optimizer and Search agents follow, each with its
own spec).

## Purpose

Slice 1 submits through four ATS HTTP APIs by replaying a hand-built multipart
POST. Against live endpoints every one returns **HTTP 400**: the adapter posts
to the job *view* URL with guessed field names and no CSRF/authenticity token.
Auto-submit therefore does not work at all.

A browser driving the *real* application form fixes this at the root: the page
supplies the authenticity token, the correct field names, and the file-upload
widget for free. The Apply-agent is a Python LangGraph agent that consumes the
queue the TypeScript pipeline already produces and submits each job by filling
and (when confident) submitting the real form.

## Scope

**v1 targets:** ATS-hosted application forms (Greenhouse, Lever, Ashby,
Workable career pages) and bespoke company career-page forms (generic filler).

**Out of scope v1:** LinkedIn / Naukri Easy Apply (login + account-ban risk —
deferred to a later slice); referral or outreach automation; the top-level
supervisor graph that will chain all three agents; the Search and
Resume-optimizer agents.

## Relationship to the existing system

The Apply-agent does **not** rewrite any working code. It is a new Python
package that reuses the TypeScript pipeline through two shared surfaces:

- **The SQLite database** `data/pipeline.db` (WAL mode already on). The agent
  reads jobs in status `tailored` / `deferred` and writes `applications` rows
  and `jobs.status` back, using the existing schema unchanged.
- **The TS CLI** for the tracker refresh (`npm run track`), invoked as a
  subprocess so the Excel tracker stays the single renderer.

**Run model:** sequential and separate. `npm run daily` (TS) builds the queue;
then `python -m apply_agent` (Python) consumes it. The two never run
concurrently, so there is no cross-language write contention. A later
sub-project adds a LangGraph supervisor that chains the steps; until then each
side stays independently runnable and testable.

## Configuration

Read from the existing `config/criteria.yaml`:

- `submission.dry_run` — when true, the agent fills the form and screenshots it
  but never clicks final submit (full flow, zero real applications).
- `submission.browser_enabled` — kill switch for the whole agent (new key;
  defaults false so nothing submits until explicitly enabled).
- `limits.daily_cap`, `limits.per_company_open_applications`,
  `limits.min_delay_seconds`, `limits.max_delay_seconds` — reused as-is.
- `submission.confidence_threshold` — default 0.85. At or above it, and with no
  blocker, the agent auto-submits; below it, the job goes to the manual queue.

## LangGraph state

One state object flows per job:

```
JobState = {
  job, profile, resume_path,      # inputs
  page,                           # live Playwright page handle
  form_kind,                      # 'ats' | 'bespoke' | 'apply-button'
  mapping, confidence,            # field -> value plan and its score
  blockers,                       # ['captcha'] | ['unmapped-required'] | []
  outcome,                        # 'submitted' | 'held' | 'failed' | 'skipped'
  screenshot_path, reason,
}
```

## Graph nodes (per job)

1. **load_job** — pull the next queued job and `profile.json`.
2. **preflight** — guards. Fail any → `skipped`/`held` without opening a browser:
   `dry_run` note, per-run cap, per-company open-application cap, dedupe (never
   apply twice to a fingerprint), liveness (posting still open).
3. **open_page** — Playwright headed navigate to the apply URL. An off-site
   redirect (e.g. a LinkedIn link that bounces to a Greenhouse form) is followed
   to the real form; a bespoke URL is sniffed for an embedded ATS board first.
4. **classify_form** — `ats` (known embedded form) / `bespoke` (unknown form) /
   `apply-button` (a button that reveals the form). Route accordingly.
5. **map_fields** — heuristic `fieldmap` first (label / `name` / `id` /
   `aria-label`). Fields left unmapped go to a single Gemini fallback call.
   Confidence = heuristic match strength blended with LLM certainty.
6. **fill** — set inputs, upload the tailored resume PDF, attempt custom
   screening questions. Each unmapped required field lowers confidence.
7. **check_blockers** — detect captcha / challenge interstitials and any
   still-unmapped required field.
8. **decide** — branch:
   - blocker present, OR `confidence < threshold`, OR `dry_run` →
     screenshot + write to the manual queue (`held`), do **not** submit.
   - otherwise → **submit**.
9. **submit** — click final submit; verify success against a confirmation page /
   text. An uncertain or timed-out result is recorded as `failed`, **never**
   `applied` — an unknown outcome must not suppress a future retry.
10. **record** — real success → insert an `applications` row (`method='agent'`)
    and set `jobs.status='submitted'`; manual queue → `held` + screenshot path +
    reason; then refresh the tracker via `npm run track`.
11. **delay** — sleep a randomized `min..max` seconds, then loop to the next job.

## Modules

| Module | Responsibility |
|---|---|
| `apply_agent/graph.py` | LangGraph `StateGraph` wiring the nodes and branches |
| `apply_agent/browser.py` | Playwright headed context factory, navigation, screenshot |
| `apply_agent/fieldmap.py` | Heuristic form-input → profile-field mapping |
| `apply_agent/llm.py` | Gemini fallback mapping for unmapped fields (reuses `GEMINI_API_KEY`) |
| `apply_agent/detect.py` | Captcha / challenge / confirmation-page detection |
| `apply_agent/db.py` | Read/write `pipeline.db` on the existing schema |
| `apply_agent/guards.py` | Caps, delays, dry_run, dedupe, liveness from `criteria.yaml` + DB |
| `apply_agent/__main__.py` | CLI entrypoint: `python -m apply_agent` |

## Safety and blast radius

- **dry_run** fills and screenshots but never submits — the whole flow is
  exercisable with zero real applications.
- **browser_enabled** kill switch disables the agent entirely; defaults off.
- **Per-run and per-company caps** bound how many applications a single run can
  send.
- **Randomized inter-submit delays**, drawn from a range (fixed sleeps are
  themselves a signature).
- **Liveness pre-check** confirms the posting is open before filling.
- **Never mark applied on uncertainty** — the single most important rule; a
  timed-out or ambiguous submit is `failed`, so dedup will let it retry.
- **Captcha halts the run** and marks the source unhealthy (reusing slice 1's
  health tracking); retrying into a challenge only escalates a block.

## Error handling

| Condition | Behaviour |
|---|---|
| Posting closed at liveness | `skipped`, reason recorded; not applied |
| Field unmappable (required) | Screenshot, manual queue (`held`) |
| Confidence below threshold | Screenshot, manual queue (`held`) |
| Captcha / challenge | Halt run, mark source unhealthy |
| Playwright timeout / uncertain submit | `failed`, never `applied` |

## Testing

- Browser nodes run against **saved HTML fixtures** via Playwright route
  interception — a Greenhouse form, a Lever form, and a bespoke form (one cleanly
  mappable, one deliberately ambiguous). No test touches a live employer.
- `fieldmap.py` gets direct unit tests over fixture forms, including ambiguous
  ones.
- The confidence gate and the `decide` branch (submit vs manual queue vs
  skip) are unit-tested with the LLM fallback mocked.
- An **opt-in live smoke test** behind an environment flag runs against a
  self-owned test form only, matching the existing Gemini smoke-test convention.

## Known weaknesses

1. **Bespoke filler maintenance.** Unknown career-page forms drift and break;
   this is the highest-maintenance module, as the slice-2 design already warned.
2. **Custom screening questions.** Arbitrary employer questions will push a
   meaningful fraction of jobs to the manual queue regardless of filler quality.
   This is inherent, not a defect.
3. **Validating real submission.** The confidence gate and success-verification
   can only be fully proven against real forms; fixture tests keep passing when
   a live ATS changes its confirmation markup. The opt-in live smoke test is the
   only guard, and even it should target a self-owned form to avoid sending test
   applications to real employers.
