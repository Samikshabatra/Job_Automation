import sqlite3

from resume_agent.db import failed_fabrication_jobs, mark_tailored, set_reason

SCHEMA = (
    "CREATE TABLE jobs(id INTEGER PRIMARY KEY, company TEXT, title TEXT, "
    "status TEXT, status_reason TEXT, resume_path TEXT);"
)


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(SCHEMA)
    return c


def test_selects_only_fabrication_failures():
    c = _db()
    c.execute("INSERT INTO jobs(id,company,title,status,status_reason) "
              "VALUES(1,'Acme','DA','failed','fabrication check failed: x (invented names: Google)')")
    c.execute("INSERT INTO jobs(id,company,title,status,status_reason) "
              "VALUES(2,'X','Y','failed','submit outcome uncertain')")
    c.execute("INSERT INTO jobs(id,company,title,status,status_reason) VALUES(3,'Z','W','tailored',NULL)")
    c.commit()
    assert [j.id for j in failed_fabrication_jobs(c)] == [1]


def test_mark_tailored_sets_status_path_and_clears_reason():
    c = _db()
    c.execute("INSERT INTO jobs(id,company,title,status,status_reason) "
              "VALUES(1,'Acme','DA','failed','fabrication check failed: x')")
    c.commit()
    mark_tailored(c, 1, "/out/a.pdf")
    row = c.execute("SELECT status,resume_path,status_reason FROM jobs WHERE id=1").fetchone()
    assert row["status"] == "tailored"
    assert row["resume_path"] == "/out/a.pdf"
    assert row["status_reason"] is None


def test_set_reason_keeps_failed_status():
    c = _db()
    c.execute("INSERT INTO jobs(id,status,status_reason) VALUES(1,'failed','x')")
    c.commit()
    set_reason(c, 1, "repair exhausted after 3 attempts")
    row = c.execute("SELECT status,status_reason FROM jobs WHERE id=1").fetchone()
    assert row["status"] == "failed"
    assert "repair exhausted" in row["status_reason"]
