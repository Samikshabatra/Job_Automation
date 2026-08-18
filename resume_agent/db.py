"""Read/write helpers over the shared pipeline.db for the resume-optimizer.

Reads jobs the daily TS pipeline gave up on for a fabrication reason, and
writes the result of a repair back on the existing slice-1 schema.
"""
from dataclasses import dataclass

# The prefix `verifyNoFabrication` failures carry in `jobs.status_reason`
# (see src/run/daily.ts). Other 'failed' jobs (LLM/render/submit errors) are
# intentionally left alone.
_FABRICATION_PREFIX = "fabrication check failed%"


@dataclass
class Job:
    id: int
    company: str
    title: str


def failed_fabrication_jobs(conn) -> list[Job]:
    rows = conn.execute(
        "SELECT id, company, title FROM jobs "
        "WHERE status = 'failed' AND status_reason LIKE ? ORDER BY id",
        (_FABRICATION_PREFIX,),
    ).fetchall()
    return [Job(r["id"], r["company"], r["title"]) for r in rows]


def mark_tailored(conn, job_id: int, resume_path: str) -> None:
    """Repair succeeded: return the job to the submit queue with its PDF."""
    conn.execute(
        "UPDATE jobs SET status = 'tailored', resume_path = ?, status_reason = NULL WHERE id = ?",
        (resume_path, job_id),
    )
    conn.commit()


def set_reason(conn, job_id: int, reason: str) -> None:
    """Repair exhausted: leave the job 'failed' but record why."""
    conn.execute("UPDATE jobs SET status_reason = ? WHERE id = ?", (reason, job_id))
    conn.commit()
