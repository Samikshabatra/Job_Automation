# apply_agent/tests/test_graph.py
import asyncio
import sqlite3
from types import SimpleNamespace

from apply_agent.fieldmap import Mapping
from apply_agent.graph import Deps, build_graph, decide, verify_submit


def test_decide_submits_only_when_confident_no_captcha_not_dry():
    good = Mapping(values={"email": "x"}, unmapped=[], confidence=0.9)
    assert decide(good, has_captcha=False, dry_run=False, threshold=0.85) == "submit"


def test_decide_routes_to_manual_when_below_threshold():
    weak = Mapping(values={}, unmapped=["q"], confidence=0.5)
    assert decide(weak, has_captcha=False, dry_run=False, threshold=0.85) == "manual"


def test_decide_routes_to_manual_when_required_field_unmapped():
    # Confidence is high (0.99), no captcha, not dry_run -- ONLY the
    # `unmapped` clause can force "manual" here. This isolates that branch
    # from the confidence-threshold branch (which the below-threshold test
    # exercises together with unmapped, not on its own).
    weak = Mapping(values={"email": "x"}, unmapped=["q_custom"], confidence=0.99)
    assert decide(weak, has_captcha=False, dry_run=False, threshold=0.85) == "manual"


def test_decide_routes_to_manual_on_captcha_even_if_confident():
    good = Mapping(values={"email": "x"}, unmapped=[], confidence=0.99)
    assert decide(good, has_captcha=True, dry_run=False, threshold=0.85) == "manual"


def test_decide_never_submits_in_dry_run():
    good = Mapping(values={"email": "x"}, unmapped=[], confidence=0.99)
    assert decide(good, has_captcha=False, dry_run=True, threshold=0.85) == "manual"


def test_verify_unknown_outcome_is_failed_never_submitted():
    assert verify_submit("<div>loading…</div>", lambda h: False) == "failed"
    assert verify_submit("<h1>Thank you for applying</h1>", lambda h: True) == "submitted"


def test_build_graph_compiles_with_injected_deps():
    compiled = build_graph(Deps())
    assert compiled is not None


def test_build_graph_gates_disallowed_job_without_opening_page():
    """F5: the compiled graph must branch on preflight's `allow`. With the
    kill-switch off (browser_enabled False) the graph has to END via `blocked`
    and NEVER reach `open_page`/`submit`. `context=None` is the tripwire: if
    the gate regressed and open_page ran, `browser.open_form(None, ...)` would
    raise. The transient "disabled" status must also leave jobs.status queued."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        "CREATE TABLE jobs(id INTEGER PRIMARY KEY, fingerprint TEXT, company TEXT, status TEXT);"
        "CREATE TABLE applications(id INTEGER PRIMARY KEY, job_id INTEGER, company TEXT,"
        " applied_at TEXT, outcome TEXT DEFAULT 'awaiting');"
    )
    conn.execute("INSERT INTO jobs(id,company,status) VALUES(1,'Acme','tailored')")
    conn.commit()
    job = SimpleNamespace(id=1, company="Acme", url="http://acme/apply", fingerprint=None)
    settings = SimpleNamespace(
        browser_enabled=False, dry_run=True, confidence_threshold=0.85,
        daily_cap=30, per_company_cap=3, min_delay=0, max_delay=0,
    )
    deps = Deps(conn=conn, context=None, settings=settings,
                profile=SimpleNamespace(email="e@x.com"), next_job=lambda: job)

    final = asyncio.run(build_graph(deps).ainvoke({}))  # must not raise

    assert final["allow"] is False
    # transient kill-switch status: jobs.status left queued, not overwritten.
    assert conn.execute("SELECT status FROM jobs WHERE id=1").fetchone()["status"] == "tailored"
