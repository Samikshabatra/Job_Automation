from dataclasses import dataclass

from apply_agent.db import open_apps_for_company


@dataclass
class Decision:
    allow: bool
    status: str
    reason: str


def preflight(conn, job, settings, submitted_this_run, now, is_open) -> Decision:
    if not settings.browser_enabled:
        return Decision(False, "held", "browser submission disabled")
    if submitted_this_run >= settings.daily_cap:
        return Decision(False, "deferred", f"daily cap {settings.daily_cap} reached")
    if open_apps_for_company(conn, job.company) >= settings.per_company_cap:
        return Decision(False, "deferred", f"per-company cap for {job.company}")
    if not is_open(job.url):
        return Decision(False, "skipped", "posting no longer open")
    return Decision(True, "tailored", "")
