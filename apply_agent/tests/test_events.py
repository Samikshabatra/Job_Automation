# apply_agent/tests/test_events.py
import sqlite3

from apply_agent.events import make_recorder

SCHEMA = """
CREATE TABLE agent_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     INTEGER,
  job_id     INTEGER,
  step       TEXT NOT NULL,
  detail     TEXT,
  confidence REAL,
  created_at TEXT NOT NULL
);
"""


def _conn(with_table=True):
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    if with_table:
        c.executescript(SCHEMA)
    return c


def _rows(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM agent_events ORDER BY id")]


def test_records_a_step():
    conn = _conn()
    event = make_recorder(conn, run_id=7)
    event("preflight", detail="allowed", job_id=42, confidence=None)

    row = _rows(conn)[0]
    assert row["step"] == "preflight"
    assert row["detail"] == "allowed"
    assert row["job_id"] == 42
    assert row["run_id"] == 7
    assert row["created_at"]


def test_records_confidence_when_there_is_one():
    conn = _conn()
    make_recorder(conn, run_id=None)("mapped", detail="4 of 17 fields", job_id=1, confidence=0.27)
    assert _rows(conn)[0]["confidence"] == 0.27


def test_a_run_id_is_optional():
    # The agent is also started straight from the command line, with no
    # dashboard run row to belong to. Those events still belong in the trace.
    conn = _conn()
    make_recorder(conn, run_id=None)("decision", detail="manual", job_id=1, confidence=None)
    assert _rows(conn)[0]["run_id"] is None


def test_keeps_events_in_order():
    conn = _conn()
    event = make_recorder(conn, run_id=1)
    for step in ("preflight", "opened", "mapped", "decision"):
        event(step, detail="", job_id=1, confidence=None)
    assert [r["step"] for r in _rows(conn)] == ["preflight", "opened", "mapped", "decision"]


def test_a_missing_table_does_not_raise():
    # agent_events is created by the TypeScript openDb. An agent run started
    # against a database that predates it must still work: the trace is a
    # convenience for the dashboard and is never load-bearing for a run.
    event = make_recorder(_conn(with_table=False), run_id=1)
    event("preflight", detail="allowed", job_id=1, confidence=None)  # must not raise


def test_a_broken_connection_does_not_raise():
    conn = _conn()
    conn.close()
    make_recorder(conn, run_id=1)("preflight", detail="", job_id=1, confidence=None)


def test_a_recorder_with_no_connection_is_a_no_op():
    make_recorder(None, run_id=1)("preflight", detail="", job_id=1, confidence=None)
