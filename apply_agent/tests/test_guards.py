import sqlite3
from datetime import datetime, timezone
from apply_agent.config import Settings
from apply_agent.db import Job
from apply_agent.guards import preflight

def _settings(**kw):
    base = dict(dry_run=False, browser_enabled=True, confidence_threshold=0.85,
                daily_cap=30, per_company_cap=3, min_delay=0, max_delay=0)
    base.update(kw); return Settings(**base)

def _conn():
    c = sqlite3.connect(":memory:"); c.row_factory = sqlite3.Row
    c.executescript("CREATE TABLE applications(id INTEGER PRIMARY KEY, company TEXT, applied_at TEXT, outcome TEXT DEFAULT 'awaiting');")
    return c

JOB = Job(1, "Acme", "DA", "http://acme/apply", "greenhouse", "/r.pdf", "fp1")
NOW = datetime(2026, 8, 16, tzinfo=timezone.utc)

def test_blocks_when_browser_disabled():
    d = preflight(_conn(), JOB, _settings(browser_enabled=False), 0, NOW, lambda u: True)
    assert d.allow is False and "disabled" in d.reason

def test_blocks_when_daily_cap_reached():
    d = preflight(_conn(), JOB, _settings(daily_cap=2), 2, NOW, lambda u: True)
    assert d.allow is False and d.status == "deferred"

def test_holds_when_posting_closed():
    d = preflight(_conn(), JOB, _settings(), 0, NOW, lambda u: False)
    assert d.allow is False and d.status == "skipped"

def test_allows_a_clean_job():
    d = preflight(_conn(), JOB, _settings(), 0, NOW, lambda u: True)
    assert d.allow is True

def test_blocks_when_per_company_cap_reached():
    conn = _conn()
    settings = _settings(per_company_cap=2)
    conn.executemany(
        "INSERT INTO applications(company, applied_at, outcome) VALUES (?,?,?)",
        [(JOB.company, "2026-08-01T00:00:00+00:00", "awaiting")] * settings.per_company_cap,
    )
    d = preflight(conn, JOB, settings, 0, NOW, lambda u: True)
    assert d.allow is False and d.status == "deferred"
