# apply_agent/tests/test_main.py
"""Tests for the apply_agent run loop (`apply_agent.__main__.run`).

`run` is the safety-critical synchronous orchestrator: for each queued job it
gates on `guards.preflight`, routes low-confidence/captcha/dry-run forms to
the manual queue, and only ever calls `db.record_submitted` when
`graph.verify_submit` positively confirms the submission. These tests drive
`run` with a fully synchronous fake `deps` object -- no Playwright launch,
no network, no LLM call -- so they can assert the exact safety semantics:
dry_run never submits, a disallowed job never opens a browser, and an
unconfirmed submit outcome never produces an `applications` row.
"""
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone

from apply_agent.config import Settings, Profile
from apply_agent.fieldmap import Mapping
from apply_agent.__main__ import run


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(
        "CREATE TABLE jobs(id INTEGER PRIMARY KEY, fingerprint TEXT, company TEXT, title TEXT, url TEXT,"
        " ats_platform TEXT, resume_path TEXT, status TEXT, status_reason TEXT, submitted_at TEXT);"
        "CREATE TABLE applications(id INTEGER PRIMARY KEY, job_id INTEGER, company TEXT, title TEXT,"
        " applied_at TEXT, method TEXT, email_used TEXT, outcome TEXT DEFAULT 'awaiting');"
    )
    c.execute(
        "INSERT INTO jobs(id,company,title,url,ats_platform,resume_path,status) "
        "VALUES(1,'Acme','DA','http://acme/apply','greenhouse','/r.pdf','tailored')"
    )
    c.commit()
    return c


def _settings(**kw):
    base = dict(
        dry_run=False, browser_enabled=True, confidence_threshold=0.85,
        daily_cap=30, per_company_cap=3, min_delay=0, max_delay=0,
    )
    base.update(kw)
    return Settings(**base)


def _profile():
    return Profile("Samiksha Batra", "me@x.com", "999", "http://li/x")


@dataclass
class _FakeForm:
    """Stand-in for the object `deps.open_and_map` returns: a (mapping, html)
    pair reached via attribute access, matching the brief's Step 3 usage
    (`form.mapping`, `form.html`)."""
    mapping: Mapping
    html: str


@dataclass
class _FakeDeps:
    """Synchronous fake matching the injected-deps contract `run` consumes:
    is_open -> fields -> fill -> html, with no real browser/LLM/network.

    `confidence`/`captcha`/`confirmation` drive the fake form's outcome so a
    test can force a specific `decide`/`verify_submit` branch. `blow_up_on_open`
    lets a test assert that a disallowed job never reaches `open_and_map`
    (i.e. never "opens a browser") by raising if it's called. `closed_urls`
    lets a test make a *specific* job's posting look closed (preflight
    "skipped") while other jobs in the same run stay open, without needing
    per-job settings.
    """
    confidence: float = 0.95
    captcha: bool = False
    confirmation: bool = True
    open_result: bool = True
    closed_urls: frozenset = field(default_factory=frozenset)
    blow_up_on_open: bool = False
    raise_on_open: frozenset = field(default_factory=frozenset)
    opened: list = field(default_factory=list)
    submitted: list = field(default_factory=list)
    screenshots: list = field(default_factory=list)
    cleaned: list = field(default_factory=list)
    delays: int = 0
    delay_raises: bool = False

    def is_open(self, url: str) -> bool:
        return self.open_result and url not in self.closed_urls

    def open_and_map(self, job, profile):
        if self.blow_up_on_open:
            raise AssertionError("open_and_map must not be called for a disallowed job")
        if job.id in self.raise_on_open:
            # Simulate a Playwright/LLM/db explosion for ONE job; run() must
            # isolate it (mark failed) and keep processing the rest (F2).
            raise RuntimeError(f"boom while mapping job {job.id}")
        self.opened.append(job.id)
        mapping = Mapping(values={"email": profile.email}, unmapped=[], confidence=self.confidence)
        return _FakeForm(mapping, "<form>fake form</form>")

    def has_captcha(self, html: str) -> bool:
        return self.captcha

    def is_confirmation(self, html: str) -> bool:
        return self.confirmation

    def submit_and_read(self, job) -> str:
        self.submitted.append(job.id)
        return "<h1>Thank you for applying!</h1>" if self.confirmation else "<div>still loading...</div>"

    def screenshot(self, job) -> None:
        self.screenshots.append(job.id)

    def delay(self) -> None:
        if self.delay_raises:
            raise RuntimeError("delay boom")
        self.delays += 1

    def cleanup(self, job) -> None:
        self.cleaned.append(job.id)


def _fake_deps(confidence=0.95, captcha=False, confirmation=True, **kw):
    return _FakeDeps(confidence=confidence, captcha=captcha, confirmation=confirmation, **kw)


NOW = datetime(2026, 8, 16, tzinfo=timezone.utc)


def test_dry_run_holds_without_submitting():
    conn = _conn()
    s = Settings(dry_run=True, browser_enabled=True, confidence_threshold=0.85,
                 daily_cap=30, per_company_cap=3, min_delay=0, max_delay=0)
    prof = Profile("Samiksha Batra", "me@x.com", "999", "http://li/x")
    # deps fake a confident, captcha-free form
    deps = _fake_deps(confidence=0.95, captcha=False, confirmation=True)
    summary = run(conn, s, prof, deps, datetime(2026, 8, 16, tzinfo=timezone.utc))
    assert summary.submitted == 0 and summary.held == 1
    assert conn.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"] == 0
    # F1: dry-run must NOT drain the queue -- the job stays 'tailored' (queued)
    # so flipping to live later re-attempts it. It must NOT be written to 'held'.
    job = conn.execute("SELECT status FROM jobs WHERE id=1").fetchone()
    assert job["status"] == "tailored"


def test_confident_confirmed_job_submits_exactly_once():
    """The one real "happy path": not dry_run, confident, no captcha, and a
    verified confirmation page. Exactly one record_submitted call, one
    applications row, and the job flips to submitted."""
    conn = _conn()
    settings = _settings(dry_run=False)
    deps = _fake_deps(confidence=0.95, captcha=False, confirmation=True)

    summary = run(conn, settings, _profile(), deps, NOW)

    assert summary.submitted == 1
    assert summary.held == 0 and summary.failed == 0 and summary.skipped == 0
    rows = conn.execute("SELECT * FROM applications").fetchall()
    assert len(rows) == 1
    assert rows[0]["job_id"] == 1 and rows[0]["email_used"] == "me@x.com"
    job = conn.execute("SELECT status FROM jobs WHERE id=1").fetchone()
    assert job["status"] == "submitted"
    assert deps.submitted == [1]


def test_delay_error_after_submit_does_not_corrupt_outcome():
    """A pacing delay() that raises AFTER a real submit must not overwrite the
    already-committed outcome. The per-job except must not swallow a post-submit
    delay error into a spurious 'failed' (double-count + mislabel)."""
    conn = _conn()
    settings = _settings(dry_run=False)
    deps = _fake_deps(confidence=0.95, captcha=False, confirmation=True, delay_raises=True)

    summary = run(conn, settings, _profile(), deps, NOW)  # must not raise

    assert summary.submitted == 1 and summary.failed == 0
    assert conn.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"] == 1
    job = conn.execute("SELECT status FROM jobs WHERE id=1").fetchone()
    assert job["status"] == "submitted"


def test_unconfirmed_submit_outcome_never_applies():
    """Never mark applied on uncertainty: the form is confident and
    captcha-free (so it routes to "submit"), but the resulting page is NOT a
    recognized confirmation. This must fail closed -- zero applications rows,
    never record_submitted -- not "submitted" on a guess."""
    conn = _conn()
    settings = _settings(dry_run=False)
    deps = _fake_deps(confidence=0.95, captcha=False, confirmation=False)

    summary = run(conn, settings, _profile(), deps, NOW)

    assert summary.submitted == 0
    assert summary.failed == 1
    assert conn.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"] == 0
    job = conn.execute("SELECT status FROM jobs WHERE id=1").fetchone()
    assert job["status"] == "failed"


def test_low_confidence_routes_to_manual_without_submitting():
    conn = _conn()
    settings = _settings(dry_run=False, confidence_threshold=0.85)
    deps = _fake_deps(confidence=0.5, captcha=False, confirmation=True)

    summary = run(conn, settings, _profile(), deps, NOW)

    assert summary.submitted == 0 and summary.held == 1
    assert conn.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"] == 0
    assert deps.screenshots == [1]
    assert deps.submitted == []  # never reached submit_and_read


def test_captcha_routes_to_manual_even_when_confident():
    conn = _conn()
    settings = _settings(dry_run=False)
    deps = _fake_deps(confidence=0.99, captcha=True, confirmation=True)

    summary = run(conn, settings, _profile(), deps, NOW)

    assert summary.submitted == 0 and summary.held == 1
    assert conn.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"] == 0


def test_disallowed_job_never_opens_browser_or_submits():
    """The preflight kill-switch: when browser submission is disabled, `run`
    must move on WITHOUT ever calling `deps.open_and_map` (i.e. without opening
    a browser) or `deps.submit_and_read`. F1: it must ALSO leave jobs.status
    untouched ('tailored', still queued) so enabling the browser later
    resubmits the queue -- the kill-switch must not drain it to a dead status."""
    conn = _conn()
    settings = _settings(browser_enabled=False)
    deps = _fake_deps(blow_up_on_open=True)

    summary = run(conn, settings, _profile(), deps, NOW)

    assert summary.submitted == 0
    assert summary.held == 1  # transient skip still counted as held in Summary
    assert deps.opened == []
    assert deps.submitted == []
    assert conn.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"] == 0
    job = conn.execute("SELECT status, status_reason FROM jobs WHERE id=1").fetchone()
    assert job["status"] == "tailored"  # left queued, NOT written to 'held'
    assert job["status_reason"] is None  # no terminal status write happened


def test_posting_closed_is_skipped_without_opening_browser():
    conn = _conn()
    settings = _settings()
    deps = _fake_deps(open_result=False, blow_up_on_open=True)

    summary = run(conn, settings, _profile(), deps, NOW)

    assert summary.skipped == 1
    assert deps.opened == []
    job = conn.execute("SELECT status FROM jobs WHERE id=1").fetchone()
    assert job["status"] == "skipped"


def test_daily_cap_reached_from_earlier_today_defers_new_submissions():
    """count_applied_today seeds the run's submitted-this-run counter so the
    daily cap accounts for applications already submitted earlier today, not
    just this invocation."""
    conn = _conn()
    conn.execute(
        "INSERT INTO applications(job_id,company,title,applied_at,method,email_used) "
        "VALUES(99,'Other','X',?,?,?)",
        ("2026-08-16T01:00:00+00:00", "agent", "me@x.com"),
    )
    conn.commit()
    settings = _settings(daily_cap=1)
    deps = _fake_deps(blow_up_on_open=True)

    summary = run(conn, settings, _profile(), deps, NOW)

    assert summary.submitted == 0
    assert summary.held == 1  # "deferred" status -> counted as held
    assert deps.opened == []
    job = conn.execute("SELECT status FROM jobs WHERE id=1").fetchone()
    assert job["status"] == "deferred"


def test_delay_is_called_after_each_processed_job():
    conn = _conn()
    settings = _settings(dry_run=False)
    deps = _fake_deps(confidence=0.95, captcha=False, confirmation=True)

    run(conn, settings, _profile(), deps, NOW)

    assert deps.delays == 1


def test_cleanup_runs_once_per_job_for_manual_and_preflight_blocked():
    """Resource-leak guard: `deps.cleanup(job)` must run exactly once for
    EVERY queued job, no matter which branch it took -- including a job
    that opened a page and got routed to manual (low confidence), and a job
    that never opened a page at all because the preflight gate blocked it
    (posting closed). Without this, a real Playwright page would stay open
    for every non-submitted job until the whole run finishes."""
    conn = _conn()
    conn.execute(
        "INSERT INTO jobs(id,company,title,url,ats_platform,resume_path,status) "
        "VALUES(2,'Beta','QA','http://beta/apply','lever','/r2.pdf','tailored')"
    )
    conn.commit()
    settings = _settings(dry_run=False, confidence_threshold=0.85)
    # job 1 (acme) stays open and is confident-but-below-threshold -> manual.
    # job 2 (beta) is preflight-blocked (posting closed) -> never opened.
    deps = _fake_deps(confidence=0.5, captcha=False, confirmation=True,
                       closed_urls={"http://beta/apply"})

    summary = run(conn, settings, _profile(), deps, NOW)

    assert summary.held == 1  # job 1: routed to manual
    assert summary.skipped == 1  # job 2: preflight-blocked (posting closed)
    assert deps.opened == [1]  # job 2 never reached open_and_map
    assert deps.cleaned == [1, 2]  # cleanup ran for every job, blocked one included


def test_one_job_erroring_does_not_abort_the_batch():
    """F2: a Playwright/LLM/db explosion on one job must NOT abort the run.
    The failing job is marked 'failed' and the OTHER jobs still process; no
    exception escapes `run()`."""
    conn = _conn()
    conn.execute(
        "INSERT INTO jobs(id,company,title,url,ats_platform,resume_path,status) "
        "VALUES(2,'Beta','QA','http://beta/apply','lever','/r2.pdf','tailored')"
    )
    conn.commit()
    settings = _settings(dry_run=False)
    # job 1 (acme) blows up in open_and_map; job 2 (beta) is a clean happy path.
    deps = _fake_deps(confidence=0.95, captcha=False, confirmation=True,
                      raise_on_open=frozenset({1}))

    summary = run(conn, settings, _profile(), deps, NOW)  # must NOT raise

    assert summary.failed == 1 and summary.submitted == 1
    job1 = conn.execute("SELECT status, status_reason FROM jobs WHERE id=1").fetchone()
    assert job1["status"] == "failed" and "boom" in job1["status_reason"]
    job2 = conn.execute("SELECT status FROM jobs WHERE id=2").fetchone()
    assert job2["status"] == "submitted"  # the other job still processed
    assert deps.submitted == [2]  # only the healthy job reached submit
    assert deps.cleaned == [1, 2]  # cleanup still ran for both, error included
    assert conn.execute("SELECT job_id FROM applications").fetchone()["job_id"] == 2


def test_already_applied_fingerprint_is_skipped_not_submitted():
    """F3 dedupe: a repost (new job id, same fingerprint as an already-recorded
    application) must be skipped by preflight and never re-submitted."""
    conn = _conn()
    # Job 1 already has a recorded application under fingerprint 'fp-dupe'.
    conn.execute("UPDATE jobs SET fingerprint='fp-dupe', status='submitted' WHERE id=1")
    conn.execute(
        "INSERT INTO applications(job_id,company,title,applied_at,method,email_used) "
        "VALUES(1,'Acme','DA','2026-08-15T00:00:00+00:00','agent','me@x.com')"
    )
    # Job 2 is a repost of the same posting: new id, SAME fingerprint, queued.
    conn.execute(
        "INSERT INTO jobs(id,fingerprint,company,title,url,ats_platform,resume_path,status) "
        "VALUES(2,'fp-dupe','Acme','DA','http://acme/apply2','greenhouse','/r.pdf','tailored')"
    )
    conn.commit()
    settings = _settings(dry_run=False)
    deps = _fake_deps(blow_up_on_open=True)  # must never open the dupe's form

    summary = run(conn, settings, _profile(), deps, NOW)

    assert summary.submitted == 0 and summary.skipped == 1
    assert deps.opened == []  # dedupe blocked before opening a browser
    # Still exactly one application row (the original), no second submit.
    assert conn.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"] == 1
    job2 = conn.execute("SELECT status, status_reason FROM jobs WHERE id=2").fetchone()
    assert job2["status"] == "skipped" and "already applied" in job2["status_reason"]
