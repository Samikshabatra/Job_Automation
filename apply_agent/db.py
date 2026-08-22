from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class Job:
    id: int
    company: str
    title: str
    url: str
    ats_platform: str | None
    resume_path: str | None
    fingerprint: str | None


_OPEN = ("awaiting", "acknowledged", "screening", "interview")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def queued_jobs(conn, only_job_id: int | None = None) -> list[Job]:
    """The submission queue. `only_job_id` narrows it to a single job, which is
    how the first live browser run is kept to one form instead of the whole
    queue. It still has to be IN the queue -- this restricts the selection, it
    does not bypass the status filter or any downstream guard."""
    sql = (
        "SELECT id,company,title,url,ats_platform,resume_path,fingerprint FROM jobs "
        "WHERE status IN ('tailored','deferred')"
    )
    params: tuple = ()
    if only_job_id is not None:
        sql += " AND id = ?"
        params = (only_job_id,)
    rows = conn.execute(sql + " ORDER BY id", params).fetchall()
    return [
        Job(r["id"], r["company"], r["title"], r["url"], r["ats_platform"], r["resume_path"], r["fingerprint"])
        for r in rows
    ]


def open_apps_for_company(conn, company: str) -> int:
    q = ",".join("?" * len(_OPEN))
    return conn.execute(
        f"SELECT COUNT(*) n FROM applications WHERE company=? AND outcome IN ({q})",
        (company, *_OPEN),
    ).fetchone()["n"]


def already_applied(conn, job) -> bool:
    """Dedupe gate: True if we've already applied to this job or to any other
    job sharing its `fingerprint` (a repost with a new id, or a retry).

    Checks the direct `job_id` first, then joins `applications` back to `jobs`
    on `fingerprint` so a reposted listing (same fingerprint, new row id) is
    recognized as already-applied and never submitted a second time.
    """
    row = conn.execute(
        "SELECT 1 FROM applications WHERE job_id=? LIMIT 1", (job.id,)
    ).fetchone()
    if row is not None:
        return True
    fingerprint = getattr(job, "fingerprint", None)
    if fingerprint:
        row = conn.execute(
            "SELECT 1 FROM applications a JOIN jobs j ON a.job_id=j.id "
            "WHERE j.fingerprint=? LIMIT 1",
            (fingerprint,),
        ).fetchone()
        if row is not None:
            return True
    return False


def count_applied_today(conn, since_iso: str) -> int:
    return conn.execute(
        "SELECT COUNT(*) n FROM applications WHERE applied_at>=?", (since_iso,)
    ).fetchone()["n"]


def record_submitted(conn, job: Job, email: str) -> None:
    conn.execute(
        "INSERT INTO applications(job_id,company,title,applied_at,method,email_used) VALUES(?,?,?,?,?,?)",
        (job.id, job.company, job.title, _now(), "agent", email),
    )
    if _has_col_named(conn, "submitted_at"):
        conn.execute("UPDATE jobs SET status='submitted', submitted_at=? WHERE id=?", (_now(), job.id))
    else:
        conn.execute("UPDATE jobs SET status='submitted' WHERE id=?", (job.id,))
    conn.commit()


def mark_status(conn, job_id: int, status: str, reason: str) -> None:
    if _has_col_named(conn, "status_reason"):
        conn.execute("UPDATE jobs SET status=?, status_reason=? WHERE id=?", (status, reason, job_id))
    else:
        conn.execute("UPDATE jobs SET status=? WHERE id=?", (status, job_id))
    conn.commit()


def _has_col_named(conn, name: str) -> bool:
    return any(r["name"] == name for r in conn.execute("PRAGMA table_info(jobs)").fetchall())
