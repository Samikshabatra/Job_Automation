"""Resume-optimizer agent: recover jobs the daily pipeline gave up on for a
fabrication reason by re-tailoring them with targeted repair hints.

Run after `npm run daily`:  python -m resume_agent

The fabrication gate itself is never weakened -- each attempt re-runs the same
TS tailor+verify (via `tailor-once`); a job that cannot pass stays 'failed'.
"""
from dataclasses import dataclass

from resume_agent.db import failed_fabrication_jobs, mark_tailored, set_reason
from resume_agent.repair import repair_hint


@dataclass
class Summary:
    repaired: int = 0
    exhausted: int = 0


def run(conn, run_once, max_attempts: int = 3) -> Summary:
    """Repair every fabrication-failed job. `run_once(job_id, hint) -> dict`
    performs one tailor+verify pass and returns {ok, offending, resumePath?}."""
    s = Summary()
    for job in failed_fabrication_jobs(conn):
        hint = ""
        for _ in range(max_attempts):
            result = run_once(job.id, hint)
            if result.get("ok"):
                mark_tailored(conn, job.id, result["resumePath"])
                s.repaired += 1
                break
            hint = repair_hint(result.get("offending", []))
        else:
            set_reason(conn, job.id, f"repair exhausted after {max_attempts} attempts")
            s.exhausted += 1
    return s


def main() -> None:  # untested wiring: real DB + npm subprocess
    import os
    import sqlite3
    import subprocess

    import yaml

    from resume_agent.runner import run_tailor_once

    repo_root = os.getcwd()
    criteria = yaml.safe_load(open("config/criteria.yaml", encoding="utf-8")) or {}
    max_attempts = int((criteria.get("optimizer") or {}).get("max_repair_attempts", 3))

    conn = sqlite3.connect("data/pipeline.db")
    conn.row_factory = sqlite3.Row
    try:
        summary = run(conn, lambda jid, hint: run_tailor_once(jid, hint, repo_root), max_attempts)
    finally:
        conn.close()

    print(f"Resume-optimizer: {summary.repaired} repaired, {summary.exhausted} exhausted")
    if summary.repaired:
        subprocess.run("npm run track", cwd=repo_root, shell=True)


if __name__ == "__main__":
    main()
