from dataclasses import dataclass

from apply_agent.db import open_apps_for_company, already_applied


@dataclass
class Decision:
    allow: bool
    status: str
    reason: str


def preflight(conn, job, settings, submitted_this_run, now, is_open) -> Decision:
    # Kill-switch: status "disabled" is a TRANSIENT skip -- the caller must
    # leave jobs.status untouched (still queued) so flipping browser_enabled
    # on later resubmits the same queue. It is NOT a terminal status write.
    if not settings.browser_enabled:
        return Decision(False, "disabled", "browser submission disabled")
    if submitted_this_run >= settings.daily_cap:
        return Decision(False, "deferred", f"daily cap {settings.daily_cap} reached")
    if open_apps_for_company(conn, job.company) >= settings.per_company_cap:
        return Decision(False, "deferred", f"per-company cap for {job.company}")
    # Dedupe: never apply twice to the same job or to a repost sharing its
    # fingerprint. Terminal "skipped" -- there is nothing left to do here.
    if already_applied(conn, job):
        return Decision(False, "skipped", "already applied")
    if not is_open(job.url):
        return Decision(False, "skipped", "posting no longer open")
    return Decision(True, "tailored", "")
