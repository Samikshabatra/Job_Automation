"""Tier C -- the review queue.

Greenhouse forms carry required, company-specific questions (Current Industry,
Expected CTC, Notice Period, Employment and Education sub-forms) that no
profile can answer. A live PhonePe posting needed 22 of them. So the honest
ceiling for those forms is not auto-submit: it is *pre-filled, human submits*.

This module opens each queued job in a headed browser, fills everything the
field mapper can, and hands the keyboard over. The person answers what is left
and clicks Submit themselves.

**This module never clicks submit.** The `deps` interface it drives has no
submit capability at all, so an auto-submit regression cannot even be
expressed through it. That is also why the queue runs while `dry_run` is on:
dry_run exists to stop the MACHINE submitting, and here the machine does not.
Refusing to run under dry_run would make Tier C unusable in the only
configuration that is safe to leave switched on.
"""
from dataclasses import dataclass

from apply_agent.db import queued_jobs, record_submitted, mark_status, already_applied


@dataclass
class ReviewSummary:
    submitted: int = 0
    skipped: int = 0
    failed: int = 0


def review_queue(conn, settings, profile, deps, now, only_job_id=None) -> ReviewSummary:
    """Walk the queue, pre-filling each form for a human to finish.

    `deps.await_human(job)` returns one of "submitted", "skip" or "quit" --
    the person's verdict after they have dealt with the open browser.
    """
    s = ReviewSummary()

    for job in queued_jobs(conn, only_job_id):
        # The browser kill switch still governs: this opens real browsers.
        if not settings.browser_enabled:
            break
        # Never show a job we have already applied to, and never one whose
        # posting has closed since it was tailored. Both are the same guards
        # the unattended agent applies -- a human reviewer deserves them more,
        # not less, since they are the ones whose time is wasted.
        if already_applied(conn, job):
            s.skipped += 1
            continue
        if not deps.is_open(job.url):
            mark_status(conn, job.id, "skipped", "posting no longer open")
            s.skipped += 1
            continue

        try:
            form = deps.open_and_fill(job, profile)
            verdict = deps.await_human(job)

            if verdict == "submitted":
                record_submitted(conn, job, profile.email)
                s.submitted += 1
            elif verdict == "quit":
                # Leave the job queued: quitting is "not now", not "never".
                break
            else:
                # Skipping leaves jobs.status untouched so the job comes back
                # next session. A skip is a deferral, not a judgement.
                s.skipped += 1
        except Exception as exc:
            # Isolate per-job failures so one crashed page cannot end the
            # session. Terminal 'failed' -- never re-queued, because a job that
            # errored after the human clicked Submit must not reappear and
            # invite a second application.
            mark_status(conn, job.id, "failed", f"review error: {exc}")
            s.failed += 1
        finally:
            deps.cleanup(job)

    return s
