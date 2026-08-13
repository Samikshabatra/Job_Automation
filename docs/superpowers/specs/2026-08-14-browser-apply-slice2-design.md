# Slice 2 — Browser-Driven Applying: LinkedIn, Naukri and Bespoke Career Pages

**Status:** approved design, not yet planned or implemented
**Depends on:** slice 1 complete (Tasks 1–17 of `2026-08-01-job-pipeline-slice1.md`)
**Date:** 2026-08-14

## Purpose

Slice 1 discovers jobs and submits them through four ATS HTTP APIs. That
covers most companies with an engineering-led hiring stack, and nothing
else. Slice 2 extends both ends: it discovers on LinkedIn and Naukri, and
it submits by driving a real logged-in browser where no ATS API exists.

## Accepted Risk

This slice automates logged-in sessions against LinkedIn and Naukri.
Both prohibit automated access in their terms, both run bot detection,
and enforcement is account-level — restriction or permanent ban on the
accounts Indian recruiters use to find the candidate.

This was raised explicitly and accepted. The design therefore treats
detection avoidance and blast-radius limits as first-class requirements
rather than polish, but it cannot make the risk zero, and no amount of
throttling makes it zero.

A safer path exists and was declined: discover on LinkedIn and Naukri but
submit only through the company's ATS, since most postings on both
platforms link out to one. That path remains available at any time by
setting `submission.browser_enabled: false`, which disables browser
submission without touching ATS submission.

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Sources | LinkedIn, Naukri, ATS-backed career pages, bespoke career pages | All four requested |
| Authentication | Saved `storageState` cookie files | Chosen over persistent profile and stored passwords |
| Sequencing | After slice 1 completes | Submission guards, dedup and the orchestrator must exist first |
| Browser driver | Playwright, Chromium, headed | Headless Chromium is independently detectable |

### Why storageState needs care

The chosen auth mechanism writes live session cookies to disk. That file
is a credential: whoever holds it is the candidate on LinkedIn, without a
password and without tripping 2FA. It therefore lives in `secrets/`,
which is gitignored as a directory, and is never read by any module other
than `src/browser/session.ts`.

## Architecture

### Contract change in slice 1 code

Submission currently dispatches on `AtsPlatform`, which presumes an HTTP
API. Slice 2 introduces:

```ts
type SubmitChannel = 'ats' | 'browser';
```

`adapterFor` dispatches on channel first, platform second. Existing ATS
adapters are untouched; they simply declare `channel: 'ats'`. This keeps
browser adapters from having to impersonate an ATS to reach the router.

### New modules

| Module | Responsibility | Depends on |
|---|---|---|
| `src/browser/session.ts` | Playwright context factory; loads storageState, detects login-wall redirects, throws `SessionExpiredError` | Playwright |
| `src/browser/login.ts` | Headed one-time login capture writing storageState; run as `npm run login -- <site>` | Playwright |
| `src/browser/detect.ts` | Recognises captcha and challenge interstitials from page content | — |
| `src/discovery/naukri.ts` | Naukri search results → `DiscoveryHit[]` | `DiscoverySource` |
| `src/submit/linkedin.ts` | Easy Apply wizard driver | `SubmitAdapter`, session |
| `src/submit/naukri.ts` | Naukri apply driver | `SubmitAdapter`, session |
| `src/submit/bespoke.ts` | Generic form filler over unknown career-page forms | `SubmitAdapter`, session |
| `src/submit/fieldmap.ts` | Maps a resume/profile field to a form input by label, `name`, `id` and `aria-label` heuristics | — |
| `src/sources/careerpage.ts` | Sniffs a careers URL for an embedded ATS board | Task 11 resolver |

### Data flow

```
DiscoveryHit (adzuna | hn | remotive | linkedin | naukri)
  → apply URL
  → parseApplyUrl (Task 12)
      ├─ known ATS token      → ATS adapter        (slice 1, unchanged)
      ├─ linkedin.com/jobs    → LinkedIn adapter   (browser)
      ├─ naukri.com           → Naukri adapter     (browser)
      └─ anything else        → careerpage sniff
              ├─ embedded ATS → ATS adapter
              └─ no ATS       → bespoke filler
                      └─ unmappable → manual queue
```

A LinkedIn posting that redirects to an external ATS is not applied to
through LinkedIn. The adapter detects the off-site redirect and hands the
job back to the ATS path, which is both more reliable and less risky.

### Manual queue

The bespoke filler fails often by design. Failure is not a dropped
application: the tailored PDF is already rendered, the form is
screenshotted to `runs/<date>/`, and the job is written to the queue with
its apply URL. Finishing by hand takes about thirty seconds.

## Detection and Blast Radius

- **Per-platform daily caps**, independent of the global `daily_cap`.
  LinkedIn's default is deliberately the lowest.
- **Randomised inter-action delays.** Fixed sleeps are themselves a bot
  signature; delays are drawn from a range.
- **Serial sessions.** Never more than one browser context per platform
  at a time.
- **Halt on challenge.** A captcha or challenge interstitial stops that
  platform for the remainder of the run and marks the source unhealthy
  through Task 17's health tracking. Retrying into a challenge escalates
  the block.
- **Kill switch.** `submission.browser_enabled: false` disables all
  browser submission, leaving ATS submission running.

## Error Handling

| Condition | Behaviour |
|---|---|
| `SessionExpiredError` | Pause that platform; run report prints the re-login command |
| Captcha or challenge detected | Pause that platform for the run; mark source unhealthy |
| Form field unmappable | Screenshot, render PDF, queue for manual completion |
| Playwright timeout | Treat as a failed submission, not a successful one; never mark applied on uncertainty |

The last row matters most. A submission whose outcome is unknown must
never be recorded as applied, or the dedup guard will suppress a retry
of a job that was never actually submitted.

## Testing

- Browser adapters run against saved HTML fixtures using Playwright route
  interception. No test touches live LinkedIn or Naukri.
- `fieldmap.ts` gets direct unit tests over fixture forms, including
  forms designed to be ambiguous.
- Session handling is tested with a fixture storageState and a simulated
  login-wall redirect.
- A live smoke test stays opt-in behind an environment flag, matching the
  Gemini smoke test convention.

## Known Weaknesses

1. **Easy Apply custom questions.** Employers attach arbitrary
   screening questions to Easy Apply. A meaningful fraction of postings
   will fall through to the manual queue regardless of filler quality.
   This is inherent, not a defect to engineer away.
2. **Bespoke filler maintenance.** This is the highest-maintenance
   module in the system. The roadmap's "~2 hours/month fixing adapters"
   estimate should be assumed to roughly double once it ships.
3. **Silent platform drift.** LinkedIn and Naukri change markup without
   notice, and fixture-based tests keep passing when they do. Only the
   opt-in live smoke test catches it. The same failure mode already
   applies to Gemini model retirement.

## Out of Scope

- Referral or outreach automation.
- Any attempt to evade a ban once one is issued.
- Applying to jobs the scoring layer rejected; browser channels reuse the
  same hard filters and thresholds as the ATS path.
