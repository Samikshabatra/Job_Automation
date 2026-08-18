import sqlite3

from supervisor.routing import has_fabrication_failures

SCHEMA = "CREATE TABLE jobs(id INTEGER PRIMARY KEY, status TEXT, status_reason TEXT);"


def _db(*rows):
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(SCHEMA)
    for i, (status, reason) in enumerate(rows, start=1):
        c.execute("INSERT INTO jobs(id,status,status_reason) VALUES(?,?,?)", (i, status, reason))
    c.commit()
    return c


def test_true_when_a_fabrication_failure_exists():
    c = _db(("failed", "fabrication check failed: bad (invented names: Google)"))
    assert has_fabrication_failures(c) is True


def test_false_when_only_other_failures():
    c = _db(("failed", "submit outcome uncertain"), ("tailored", None))
    assert has_fabrication_failures(c) is False


def test_false_on_empty_db():
    assert has_fabrication_failures(_db()) is False
