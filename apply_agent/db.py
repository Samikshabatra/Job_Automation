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


def queued_jobs(conn) -> list[Job]:
    rows = conn.execute(
        "SELECT id,company,title,url,ats_platform,resume_path,fingerprint FROM jobs "
        "WHERE status IN ('tailored','deferred') ORDER BY id"
    ).fetchall()
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
