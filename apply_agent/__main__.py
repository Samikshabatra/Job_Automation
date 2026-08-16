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
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from apply_agent.db import queued_jobs, record_submitted, mark_status, count_applied_today
from apply_agent.guards import preflight
from apply_agent.graph import decide, verify_submit

REPO_ROOT = Path(__file__).resolve().parents[1]

# preflight.status values that mean "held for later" vs. "skipped outright".
_HOLD_STATUSES = {"held", "deferred"}


@dataclass
class Summary:
    submitted: int = 0
    held: int = 0
    failed: int = 0
    skipped: int = 0


def _start_of_day_iso(now: datetime) -> str:
    return datetime(now.year, now.month, now.day, tzinfo=now.tzinfo).isoformat()


def run(conn, settings, profile, deps, now) -> Summary:
    """Process every queued job once, synchronously, through the safety
    gates described above. Returns a `Summary` of what happened."""
    s = Summary()
    # Seed today's submission count so the daily cap accounts for
    # applications already submitted earlier today (e.g. an earlier `run`
    # invocation), not just this call.
    submitted_this_run = count_applied_today(conn, _start_of_day_iso(now))

    for job in queued_jobs(conn):
        pre = preflight(conn, job, settings, submitted_this_run, now, deps.is_open)
        if not pre.allow:
            mark_status(conn, job.id, pre.status, pre.reason)
            if pre.status in _HOLD_STATUSES:
                s.held += 1
            else:
                s.skipped += 1
            continue

        form = deps.open_and_map(job, profile)  # -> object with .mapping, .html
        route = decide(form.mapping, deps.has_captcha(form.html), settings.dry_run, settings.confidence_threshold)
        if route == "manual":
            deps.screenshot(job)
            mark_status(conn, job.id, "held", "manual queue: low confidence / captcha / dry-run")
            s.held += 1
            continue

        outcome = verify_submit(deps.submit_and_read(job), deps.is_confirmation)
        if outcome == "submitted":
            record_submitted(conn, job, profile.email)
            s.submitted += 1
            submitted_this_run += 1
        else:
            mark_status(conn, job.id, "failed", "submit outcome uncertain")
            s.failed += 1
        deps.delay()

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
    model = genai.GenerativeModel(os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"))
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
    browser_obj = loop.run_until_complete(pw.chromium.launch())
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
                mapping.values.update(extra)
                mapping.unmapped = [name for name in mapping.unmapped if name not in extra]
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

    deps, close_deps = _build_real_deps(settings, _gemini_call)
    try:
        summary = run(conn, settings, profile, deps, datetime.now(timezone.utc))
    finally:
        close_deps()
        conn.close()

    print(
        f"submitted={summary.submitted} held={summary.held} "
        f"failed={summary.failed} skipped={summary.skipped}"
    )

    subprocess.run(["npm", "run", "track"], cwd=str(REPO_ROOT))


if __name__ == "__main__":
    main()
