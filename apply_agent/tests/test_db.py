import sqlite3
from apply_agent.db import queued_jobs, record_submitted, mark_status, open_apps_for_company

SCHEMA = """
CREATE TABLE jobs(id INTEGER PRIMARY KEY, fingerprint TEXT, company TEXT, title TEXT,
  url TEXT, ats_platform TEXT, resume_path TEXT, status TEXT, first_seen_at TEXT, created_at TEXT);
CREATE TABLE applications(id INTEGER PRIMARY KEY, job_id INTEGER, company TEXT, title TEXT,
  applied_at TEXT, method TEXT, email_used TEXT, outcome TEXT DEFAULT 'awaiting');
"""

def _db():
    c = sqlite3.connect(":memory:"); c.row_factory = sqlite3.Row; c.executescript(SCHEMA); return c

def test_queued_returns_tailored_and_deferred():
    c = _db()
    c.execute("INSERT INTO jobs(company,title,url,ats_platform,resume_path,status) VALUES('Acme','DA','u','greenhouse','/r.pdf','tailored')")
    c.execute("INSERT INTO jobs(company,title,url,status) VALUES('X','Y','u2','skipped')")
    c.commit()
    jobs = queued_jobs(c)
    assert [j.company for j in jobs] == ['Acme']

def test_record_submitted_writes_application_and_status():
    c = _db()
    c.execute("INSERT INTO jobs(id,company,title,url,resume_path,status) VALUES(7,'Acme','DA','u','/r.pdf','tailored')"); c.commit()
    jobs = queued_jobs(c)
    record_submitted(c, jobs[0], "me@x.com")
    row = c.execute("SELECT method,email_used FROM applications WHERE job_id=7").fetchone()
    assert row["method"] == "agent" and row["email_used"] == "me@x.com"
    assert c.execute("SELECT status FROM jobs WHERE id=7").fetchone()["status"] == "submitted"
