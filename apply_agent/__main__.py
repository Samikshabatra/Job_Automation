# apply_agent/__main__.py
"""The run loop and CLI entrypoint for the apply agent.

`run(conn, settings, profile, deps, now) -> Summary` is the SAFETY-CRITICAL
synchronous orchestrator. It is a plain loop (not `graph.build_graph`'s
compiled, async-only graph from Task 8) so it can be driven directly and
tested with a fully synchronous fake `deps`. It enforces three guarantees:

1. **Preflight gate** -- every job is checked with `guards.preflight` before
   anything else happens. A disallowed job is marked with the preflight's
   status/reason and skipped; its browser/LLM deps are never touched.
2. **Dry-run never submits** -- `graph.decide` routes dry_run (along with
   captcha/low-confidence/unmapped-field forms) to the manual queue. The
   manual-queue branch below never calls `db.record_submitted`.
3. **Never applied on uncertainty** -- `db.record_submitted` is called ONLY
   when `graph.verify_submit` returns `"submitted"` (a positively recognized
   confirmation page). Any other outcome is recorded as `"failed"` via
   `db.mark_status`; no `applications` row is ever written for it.

`main()` is the thin, untested wiring: it opens the real `data/pipeline.db`,
loads real settings/profile, builds real Playwright + Gemini-backed `deps`,
calls `run`, prints the summary, and finally refreshes the tracker via
`npm run track`. Tests import and drive `run` only.
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from apply_agent.db import queued_jobs, record_submitted, mark_status, count_applied_today
from apply_agent.guards import preflight
from apply_agent.graph import decide, verify_submit

REPO_ROOT = Path(__file__).resolve().parents[1]

# preflight.status values that count as "held" (vs. "skipped") in the Summary.
_HOLD_STATUSES = {"held", "deferred"}
# Transient preflight skips: the job's jobs.status is LEFT UNCHANGED (it stays
# queued, 'tailored'/'deferred') so a later run re-attempts it. The kill-switch
# (browser_enabled false) uses this so "dry-run first, then flip to live" and
# "held while disabled, submit once enabled" are repeatable, not queue-draining.
_TRANSIENT_STATUSES = {"disabled"}


@dataclass
class Summary:
    submitted: int = 0
    held: int = 0
    failed: int = 0
    skipped: int = 0


def _start_of_day_iso(now: datetime) -> str:
    return datetime(now.year, now.month, now.day, tzinfo=now.tzinfo).isoformat()


def run(conn, settings, profile, deps, now, only_job_id=None) -> Summary:
    """Process every queued job once, synchronously, through the safety
    gates described above. Returns a `Summary` of what happened.

    `only_job_id` restricts the run to a single queued job -- used to keep a
    first live browser run to one form. It narrows the selection only; every
    preflight gate and the dry_run routing still apply to that job."""
    s = Summary()
    # Seed today's submission count so the daily cap accounts for
    # applications already submitted earlier today (e.g. an earlier `run`
    # invocation), not just this call.
    submitted_this_run = count_applied_today(conn, _start_of_day_iso(now))

    for job in queued_jobs(conn, only_job_id):
        # Set once a submit was actually attempted, so pacing happens only after
        # a real browser submission -- and OUTSIDE the guarded region below, so a
        # delay() error can never overwrite an already-committed submit outcome.
        submit_attempted = False
        # `deps.cleanup(job)` runs exactly once per job, on every branch --
        # including the preflight-blocked branch (where it's a safe no-op,
        # since no page was ever opened) -- so a real Playwright page never
        # stays open past this iteration, no matter which branch we take.
        try:
            pre = preflight(conn, job, settings, submitted_this_run, now, deps.is_open)
            if not pre.allow:
                if pre.status in _TRANSIENT_STATUSES:
                    # Transient skip (kill-switch): do NOT write jobs.status --
                    # leave the job queued so a later run picks it up. Still
                    # count it in the Summary so the operator sees it was held.
                    s.held += 1
                    continue
                mark_status(conn, job.id, pre.status, pre.reason)
                if pre.status in _HOLD_STATUSES:
                    s.held += 1
                else:
                    s.skipped += 1
                continue

            form = deps.open_and_map(job, profile)  # -> object with .mapping, .html
            route = decide(
                form.mapping, deps.has_captcha(form.html), settings.dry_run, settings.confidence_threshold
            )
            if route == "manual":
                deps.screenshot(job)
                if settings.dry_run:
                    # Dry-run is a transient skip too: preview/fill the form and
                    # screenshot it, but leave jobs.status queued so flipping to
                    # live later re-attempts it. No terminal status write.
                    s.held += 1
                    continue
                mark_status(conn, job.id, "held", "manual queue: low confidence / captcha")
                s.held += 1
                continue

            outcome = verify_submit(deps.submit_and_read(job), deps.is_confirmation)
            submit_attempted = True
            if outcome == "submitted":
                record_submitted(conn, job, profile.email)
                s.submitted += 1
                submitted_this_run += 1
            else:
                mark_status(conn, job.id, "failed", "submit outcome uncertain")
                s.failed += 1
        except Exception as exc:
            # Isolate per-job failures: any error in open/map/submit/db for one
            # job must not abort the batch. Mark it failed (a terminal status --
            # NOT re-queued, so a job that errored after a real submit click is
            # never retried into a double-submit) and move on to the next job.
            mark_status(conn, job.id, "failed", f"unhandled error: {exc}")
            s.failed += 1
            continue
        finally:
            deps.cleanup(job)

        # Pace AFTER the outcome is durably recorded and outside the try/except,
        # so a delay() error cannot mislabel the job or abort the batch. delay()
        # is a sleep and should never raise, but we isolate it regardless.
        if submit_attempted:
            try:
                deps.delay()
            except Exception:
                pass

    return s


# --------------------------------------------------------------------------
# main() -- real wiring. NOT unit-tested: opens a live DB, launches a real
# Playwright browser, and calls the real Gemini API. Kept thin and separate
# from `run` so tests never import anything below this point transitively.
# --------------------------------------------------------------------------


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (no python-dotenv dependency in this venv).
    Only fills in variables not already set in the environment."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def _gemini_call(prompt: str) -> str:
    import google.generativeai as genai

    genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
    model = genai.GenerativeModel(os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"))
    response = model.generate_content(prompt)
    return response.text


def _build_real_deps(settings, gemini_call):
    """Build a synchronous `deps` facade over the async Playwright adapter
    in `apply_agent.browser`, driven by a single dedicated event loop so the
    same browser/context/page objects stay valid across calls."""
    import asyncio
    import random
    import time

    from playwright.async_api import async_playwright

    from apply_agent import browser as browser_mod, detect, fieldmap, llm as llm_mod

    loop = asyncio.new_event_loop()
    pw = loop.run_until_complete(async_playwright().start())
    # Headed on request so a first live run can actually be watched; slow_mo
    # makes the fill steps followable by eye. Headless stays the default, so
    # nothing about an unattended run changes.
    headed = os.environ.get("APPLY_AGENT_HEADED", "").strip().lower() in ("1", "true", "yes")
    browser_obj = loop.run_until_complete(
        pw.chromium.launch(headless=not headed, slow_mo=250 if headed else 0)
    )
    context = loop.run_until_complete(browser_obj.new_context())
    pages: dict[int, Any] = {}

    class RealDeps:
        def is_open(self, url: str) -> bool:
            try:
                page = loop.run_until_complete(context.new_page())
                try:
                    resp = loop.run_until_complete(page.goto(url, wait_until="domcontentloaded"))
                    return resp is None or resp.status < 400
                finally:
                    loop.run_until_complete(page.close())
            except Exception:
                return False

        def open_and_map(self, job, profile):
            page = loop.run_until_complete(browser_mod.open_form(context, job.url))
            pages[job.id] = page
            fields = loop.run_until_complete(browser_mod.read_fields(page))
            mapping = fieldmap.map_fields(fields, profile)
            if mapping.unmapped:
                remaining = [f for f in fields if f.name in mapping.unmapped]
                extra = llm_mod.map_unmapped(remaining, profile, gemini_call)
                # Re-blend confidence so a form the heuristic scored low but the
                # LLM then fully mapped is no longer routed to manual (F4).
                fieldmap.merge_llm_mapping(mapping, fields, extra)
            loop.run_until_complete(browser_mod.fill_form(page, mapping.values, job.resume_path))
            html = loop.run_until_complete(page.content())
            return SimpleNamespace(mapping=mapping, html=html)

        def has_captcha(self, html: str) -> bool:
            return detect.has_captcha(html)

        def is_confirmation(self, html: str) -> bool:
            return detect.is_confirmation(html)

        def submit_and_read(self, job) -> str:
            page = pages[job.id]
            loop.run_until_complete(browser_mod.submit_form(page))
            return loop.run_until_complete(page.content())

        def screenshot(self, job) -> None:
            page = pages.get(job.id)
            if page is None:
                return
            out_dir = REPO_ROOT / "data" / "screenshots"
            out_dir.mkdir(parents=True, exist_ok=True)
            loop.run_until_complete(browser_mod.screenshot(page, str(out_dir / f"job_{job.id}.png")))

        def delay(self) -> None:
            time.sleep(random.uniform(settings.min_delay, settings.max_delay))

        def cleanup(self, job) -> None:
            """Close and discard this job's page, if one was ever opened.
            Called once per job by `run()` regardless of outcome, so pages
            for manual/failed jobs don't accumulate as open tabs across a
            real queue. A no-op (no KeyError) for a job that never reached
            `open_and_map`, e.g. one blocked by the preflight gate."""
            page = pages.pop(job.id, None)
            if page is not None:
                loop.run_until_complete(page.close())

    def _close():
        loop.run_until_complete(browser_obj.close())
        loop.run_until_complete(pw.stop())
        loop.close()

    return RealDeps(), _close


def main() -> None:
    from apply_agent.config import load_settings, load_profile

    _load_dotenv(REPO_ROOT / ".env")

    conn = sqlite3.connect(str(REPO_ROOT / "data" / "pipeline.db"))
    conn.row_factory = sqlite3.Row

    settings = load_settings(str(REPO_ROOT / "config" / "criteria.yaml"))
    profile = load_profile(str(REPO_ROOT / "resume" / "profile.json"))

    # Optional single-job argument: `python -m apply_agent 46` runs just that
    # queued job. No argument keeps the previous behaviour, the whole queue.
    only_job_id = int(sys.argv[1]) if len(sys.argv) > 1 else None

    deps, close_deps = _build_real_deps(settings, _gemini_call)
    try:
        summary = run(conn, settings, profile, deps, datetime.now(timezone.utc), only_job_id)
    finally:
        close_deps()
        conn.close()

    print(
        f"submitted={summary.submitted} held={summary.held} "
        f"failed={summary.failed} skipped={summary.skipped}"
    )

    # On Windows `npm` is `npm.cmd`, not a bare executable on PATH, so a plain
    # list-form subprocess.run raises FileNotFoundError. shell=True lets the
    # shell resolve the .cmd shim. Log a non-zero exit rather than swallowing it.
    result = subprocess.run("npm run track", cwd=str(REPO_ROOT), shell=True)
    if result.returncode != 0:
        print(f"warning: 'npm run track' exited with code {result.returncode}")


if __name__ == "__main__":
    main()
