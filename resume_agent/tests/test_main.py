import sqlite3

from resume_agent.__main__ import run, Summary

SCHEMA = (
    "CREATE TABLE jobs(id INTEGER PRIMARY KEY, company TEXT, title TEXT, "
    "status TEXT, status_reason TEXT, resume_path TEXT);"
)


def _db(*reasons):
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(SCHEMA)
    for i, reason in enumerate(reasons, start=1):
        c.execute("INSERT INTO jobs(id,company,title,status,status_reason) VALUES(?,?,?,?,?)",
                  (i, f"Co{i}", "Data Analyst", "failed", reason))
    c.commit()
    return c


class _FakeRunner:
    """Returns queued results in order and records every (job_id, hint) call."""
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def __call__(self, job_id, hint):
        self.calls.append((job_id, hint))
        return self.results.pop(0)


def test_repairs_a_job_that_fails_once_then_passes():
    conn = _db("fabrication check failed: bad (invented names: Google)")
    runner = _FakeRunner([
        {"ok": False, "offending": ["bullet (invented names: Google)"]},
        {"ok": True, "offending": [], "resumePath": "/out/a.pdf"},
    ])
    summary = run(conn, runner, max_attempts=3)

    assert summary == Summary(repaired=1, exhausted=0)
    row = conn.execute("SELECT status, resume_path FROM jobs WHERE id=1").fetchone()
    assert row["status"] == "tailored" and row["resume_path"] == "/out/a.pdf"
    # second attempt carried a repair hint built from the first failure
    assert runner.calls[0][1] == ""
    assert "Google" in runner.calls[1][1]


def test_gives_up_after_max_attempts():
    conn = _db("fabrication check failed: bad (invented names: ETL)")
    runner = _FakeRunner([{"ok": False, "offending": ["b (invented names: ETL)"]}] * 3)
    summary = run(conn, runner, max_attempts=3)

    assert summary == Summary(repaired=0, exhausted=1)
    assert len(runner.calls) == 3
    row = conn.execute("SELECT status, status_reason FROM jobs WHERE id=1").fetchone()
    assert row["status"] == "failed" and "repair exhausted after 3" in row["status_reason"]


def test_passes_on_first_attempt_without_a_hint():
    conn = _db("fabrication check failed: x (invented figures: 9b)")
    runner = _FakeRunner([{"ok": True, "offending": [], "resumePath": "/out/z.pdf"}])
    summary = run(conn, runner, max_attempts=3)

    assert summary == Summary(repaired=1, exhausted=0)
    assert len(runner.calls) == 1 and runner.calls[0][1] == ""


def test_ignores_non_fabrication_failures():
    conn = _db("submit outcome uncertain")  # not a fabrication reason
    runner = _FakeRunner([])
    summary = run(conn, runner, max_attempts=3)
    assert summary == Summary(repaired=0, exhausted=0)
    assert runner.calls == []
