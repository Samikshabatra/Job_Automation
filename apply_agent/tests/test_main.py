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
    (i.e. never "opens a browser") by raising if it's called.
    """
    confidence: float = 0.95
    captcha: bool = False
    confirmation: bool = True
    open_result: bool = True
    blow_up_on_open: bool = False
    opened: list = field(default_factory=list)
    submitted: list = field(default_factory=list)
    screenshots: list = field(default_factory=list)
    delays: int = 0

    def is_open(self, url: str) -> bool:
        return self.open_result

    def open_and_map(self, job, profile):
        if self.blow_up_on_open:
            raise AssertionError("open_and_map must not be called for a disallowed job")
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
        self.delays += 1


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
    """The preflight gate: when browser submission is disabled, `run` must
    call `mark_status` and move on WITHOUT ever calling `deps.open_and_map`
    (i.e. without opening a browser) or `deps.submit_and_read`."""
    conn = _conn()
    settings = _settings(browser_enabled=False)
    deps = _fake_deps(blow_up_on_open=True)

    summary = run(conn, settings, _profile(), deps, NOW)

    assert summary.submitted == 0
    assert summary.held == 1  # preflight status "held" -> counted as held
    assert deps.opened == []
    assert deps.submitted == []
    assert conn.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"] == 0
    job = conn.execute("SELECT status, status_reason FROM jobs WHERE id=1").fetchone()
    assert job["status"] == "held"
    assert "disabled" in job["status_reason"]


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
