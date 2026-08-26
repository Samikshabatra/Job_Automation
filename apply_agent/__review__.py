"""CLI entrypoint for the Tier C review queue: `npm run review`.

NOT unit-tested, by the same convention as `apply_agent.__main__.main` -- it
opens a live database and drives a real browser. The decision logic it wires
up lives in `apply_agent.review.review_queue`, which is fully tested against
fakes.
"""
from __future__ import annotations

import asyncio
import sqlite3
import subprocess
import sys
import functools
from datetime import datetime, timezone
from pathlib import Path

from apply_agent.config import load_settings, load_profile
from apply_agent.review import review_queue
from apply_agent.urls import application_url

REPO_ROOT = Path(__file__).resolve().parents[1]

# The `npm run track` subprocess writes directly to the console; without
# flushing, our buffered prints surface after it and the transcript reads
# out of order.
print = functools.partial(__builtins__['print'] if isinstance(__builtins__, dict)
                          else __builtins__.print, flush=True)

_PROMPT = (
    "\n  Finish the form in the browser and click Submit.\n"
    "  Then: [enter] recorded as submitted  |  [s] skip  |  [q] quit\n  > "
)


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        import os
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _build_deps(settings, profile, total):
    from playwright.async_api import async_playwright
    from apply_agent import browser as browser_mod, detect, fieldmap

    loop = asyncio.new_event_loop()
    pw = loop.run_until_complete(async_playwright().start())
    # Always headed: the entire point is that a person works in this window.
    browser_obj = loop.run_until_complete(pw.chromium.launch(headless=False))
    context = loop.run_until_complete(browser_obj.new_context())
    pages: dict[int, object] = {}
    seen = {"n": 0}

    class ReviewDeps:
        def is_open(self, url: str) -> bool:
            try:
                page = loop.run_until_complete(context.new_page())
                try:
                    resp = loop.run_until_complete(page.goto(url, wait_until="domcontentloaded"))
                    return resp is None or resp.status < 400
                finally:
                    loop.run_until_complete(page.close())
            except Exception:
                # A liveness check that errors must not silently drop the job
                # from a human's queue -- let them look at it.
                return True

        def open_and_fill(self, job, profile):
            seen["n"] += 1
            print(f"\n  [{seen['n']}/{total}] {job.company} - {job.title}")
            page = loop.run_until_complete(
                browser_mod.open_form(context, application_url(job.url, job.ats_platform))
            )
            pages[job.id] = page
            # Give a client-rendered form time to hydrate before reading it.
            loop.run_until_complete(page.wait_for_timeout(3000))

            fields = loop.run_until_complete(browser_mod.read_fields(page))
            mapping = fieldmap.map_fields(fields, profile)
            loop.run_until_complete(
                browser_mod.fill_form(page, mapping.values, job.resume_path, profile.location)
            )

            print(f"        filled {len(mapping.values)}/{len(fields)} fields"
                  f", {len(mapping.unmapped)} still need you")
            if job.resume_path:
                print(f"        resume: {Path(job.resume_path).name}")
            return mapping

        def await_human(self, job) -> str:
            try:
                answer = input(_PROMPT).strip().lower()
            except EOFError:
                # No console attached (piped, scheduled, or run by tooling).
                # Treat it as "quit", never as a job failure: a failure here
                # would write a terminal status onto a job nobody has looked
                # at, silently dropping it out of the queue.
                print("")
                print("        no console attached - stopping")
                return "quit"
            if answer == "q":
                return "quit"
            if answer == "s":
                return "skip"

            # Trust, but check: read the page for a confirmation marker before
            # recording an application. A mistaken "yes" here writes a false
            # submission into the tracker and, worse, makes the dedupe guard
            # hide a job that was never actually applied to.
            page = pages.get(job.id)
            html = ""
            if page is not None:
                try:
                    html = loop.run_until_complete(page.content())
                except Exception:
                    html = ""
            if detect.is_confirmation(html):
                print("        confirmation page detected - recorded as submitted")
                return "submitted"

            again = input(
                "        No confirmation page detected. Record it as submitted anyway? [y/N] "
            ).strip().lower()
            if again == "y":
                return "submitted"
            print("        left in the queue")
            return "skip"

        def cleanup(self, job) -> None:
            page = pages.pop(job.id, None)
            if page is not None:
                try:
                    loop.run_until_complete(page.close())
                except Exception:
                    pass

    def close():
        loop.run_until_complete(context.close())
        loop.run_until_complete(browser_obj.close())
        loop.run_until_complete(pw.stop())
        loop.close()

    return ReviewDeps(), close


def main() -> None:
    _load_dotenv(REPO_ROOT / ".env")

    conn = sqlite3.connect(str(REPO_ROOT / "data" / "pipeline.db"))
    conn.row_factory = sqlite3.Row

    settings = load_settings(str(REPO_ROOT / "config" / "criteria.yaml"))
    profile = load_profile(str(REPO_ROOT / "resume" / "profile.json"))
    only_job_id = int(sys.argv[1]) if len(sys.argv) > 1 else None

    if not settings.browser_enabled:
        print("browser_enabled is false in config/criteria.yaml - nothing to review.")
        return

    # This command is a conversation: it opens a browser and waits for a person.
    # Refuse up front rather than launching browsers nobody can answer for.
    if not sys.stdin.isatty():
        print("Review needs an interactive terminal (stdin is not a TTY). "
              "Run `npm run review` directly in your shell.")
        return

    from apply_agent.db import queued_jobs
    total = len(queued_jobs(conn, only_job_id))
    if total == 0:
        print("Review queue is empty.")
        return
    print(f"Review queue: {total} job(s). The browser opens headed; you click Submit.")

    deps, close = _build_deps(settings, profile, total)
    try:
        s = review_queue(conn, settings, profile, deps, datetime.now(timezone.utc), only_job_id)
    finally:
        close()
        conn.close()

    print(f"\nsubmitted={s.submitted} skipped={s.skipped} failed={s.failed}")
    result = subprocess.run("npm run track", cwd=str(REPO_ROOT), shell=True)
    if result.returncode != 0:
        print(f"warning: 'npm run track' exited with code {result.returncode}")


if __name__ == "__main__":
    main()
