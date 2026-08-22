"""Tier C review queue: the agent pre-fills a real form, a human finishes and
clicks Submit.

The invariant these tests exist to protect: the review queue NEVER clicks
submit. `deps` here has no submit capability at all, so a regression that
tried to auto-submit could not even be expressed through this interface.
"""
import sqlite3
from dataclasses import dataclass, field

import pytest

from apply_agent.config import Profile, Settings
from apply_agent.review import review_queue


def _conn(*extra_jobs):
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(
        "CREATE TABLE jobs(id INTEGER PRIMARY KEY, fingerprint TEXT, company TEXT, title TEXT, url TEXT,"
        " ats_platform TEXT, resume_path TEXT, status TEXT, status_reason TEXT, submitted_at TEXT,"
        " match_score REAL);"
        "CREATE TABLE applications(id INTEGER PRIMARY KEY, job_id INTEGER, company TEXT, title TEXT,"
        " applied_at TEXT, method TEXT, email_used TEXT, outcome TEXT DEFAULT 'awaiting');"
    )
    c.execute(
        "INSERT INTO jobs(id,company,title,url,ats_platform,resume_path,status,match_score) "
        "VALUES(1,'Acme','DA','http://acme/apply','greenhouse','/r.pdf','tailored',88)"
    )
    for jid, company in extra_jobs:
        c.execute(
            "INSERT INTO jobs(id,company,title,url,ats_platform,resume_path,status,match_score) "
            f"VALUES({jid},'{company}','T','http://x/{jid}','greenhouse','/r.pdf','tailored',70)"
        )
    c.commit()
    return c


def _settings(**kw):
    base = dict(dry_run=True, browser_enabled=True, confidence_threshold=0.85,
                daily_cap=30, per_company_cap=3, min_delay=0, max_delay=0)
    base.update(kw)
    return Settings(**base)


def _profile():
    return Profile("Samiksha Batra", "me@x.com", "999", "http://li/x")


@dataclass
class _Filled:
    filled: int = 5
    total: int = 38
    needs_attention: int = 22


@dataclass
class _FakeDeps:
    """No submit method exists here, by design."""
    answers: list = field(default_factory=list)
    opened: list = field(default_factory=list)
    cleaned: list = field(default_factory=list)
    is_open_result: bool = True

    def is_open(self, url):
        return self.is_open_result

    def open_and_fill(self, job, profile):
        self.opened.append(job.id)
        return _Filled()

    def await_human(self, job):
        return self.answers.pop(0) if self.answers else "skip"

    def cleanup(self, job):
        self.cleaned.append(job.id)


NOW = __import__("datetime").datetime(2026, 8, 22, tzinfo=__import__("datetime").timezone.utc)


def test_records_an_application_when_the_human_submits():
    c, d = _conn(), _FakeDeps(answers=["submitted"])
    s = review_queue(c, _settings(), _profile(), d, NOW)
    assert s.submitted == 1
    row = c.execute("SELECT method,email_used FROM applications WHERE job_id=1").fetchone()
    assert row["method"] == "agent" and row["email_used"] == "me@x.com"
    assert c.execute("SELECT status FROM jobs WHERE id=1").fetchone()["status"] == "submitted"


def test_skipping_leaves_the_job_queued_for_next_time():
    c, d = _conn(), _FakeDeps(answers=["skip"])
    s = review_queue(c, _settings(), _profile(), d, NOW)
    assert s.skipped == 1
    assert c.execute("SELECT status FROM jobs WHERE id=1").fetchone()["status"] == "tailored"
    assert c.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"] == 0


def test_quit_stops_before_opening_the_next_job():
    c, d = _conn((2, "Beta")), _FakeDeps(answers=["quit"])
    review_queue(c, _settings(), _profile(), d, NOW)
    assert d.opened == [1]


def test_runs_in_dry_run_because_the_human_is_the_gate():
    """dry_run stops the MACHINE submitting. Here a person clicks Submit, so
    the queue must still work -- otherwise Tier C is unusable in the only
    configuration that is safe to leave switched on."""
    c, d = _conn(), _FakeDeps(answers=["submitted"])
    s = review_queue(c, _settings(dry_run=True), _profile(), d, NOW)
    assert s.submitted == 1


def test_never_opens_a_job_already_applied_to():
    c, d = _conn(), _FakeDeps(answers=["submitted"])
    c.execute("INSERT INTO applications(job_id,company,title,applied_at,method) "
              "VALUES(1,'Acme','DA','2026-08-01','agent')")
    c.commit()
    review_queue(c, _settings(), _profile(), d, NOW)
    assert d.opened == []


def test_never_opens_a_closed_posting():
    c, d = _conn(), _FakeDeps(answers=["submitted"], is_open_result=False)
    review_queue(c, _settings(), _profile(), d, NOW)
    assert d.opened == []


def test_respects_the_browser_kill_switch():
    c, d = _conn(), _FakeDeps(answers=["submitted"])
    review_queue(c, _settings(browser_enabled=False), _profile(), d, NOW)
    assert d.opened == []


def test_cleans_up_every_job_it_opened():
    c, d = _conn((2, "Beta")), _FakeDeps(answers=["submitted", "skip"])
    review_queue(c, _settings(), _profile(), d, NOW)
    assert d.cleaned == [1, 2]


def test_one_job_failing_does_not_abort_the_rest():
    class Boom(_FakeDeps):
        def open_and_fill(self, job, profile):
            if job.id == 1:
                raise RuntimeError("page crashed")
            return super().open_and_fill(job, profile)

    c, d = _conn((2, "Beta")), Boom(answers=["submitted"])
    s = review_queue(c, _settings(), _profile(), d, NOW)
    assert s.failed == 1 and s.submitted == 1
    assert c.execute("SELECT status FROM jobs WHERE id=1").fetchone()["status"] == "failed"
