"""Step-level trace of an agent run, for the dashboard to read back.

Everything here is best-effort by construction. `agent_events` is written by
the agent but read only by the JobPilot dashboard, and the dashboard must never
become load-bearing for a run: a missing table, a closed connection or a locked
database has to cost the trace, never the application. Every write is therefore
wrapped, and a recorder with nothing to write to is a working no-op.

The table itself is created by the TypeScript `openDb` (src/db/schema.sql). It
is deliberately NOT created here -- two definitions of one table drift apart,
and the agent has no business migrating a schema it does not own.
"""
from datetime import datetime, timezone
from typing import Callable, Optional

_INSERT = (
    "INSERT INTO agent_events (run_id, job_id, step, detail, confidence, created_at) "
    "VALUES (?, ?, ?, ?, ?, ?)"
)

EventFn = Callable[..., None]


def make_recorder(conn, run_id: Optional[int]) -> EventFn:
    """A function that appends one step to the trace.

    `run_id` ties the events to a dashboard-started run and is None when the
    agent was started straight from the command line -- those events are still
    worth keeping, they simply belong to no run row.
    """

    def event(step: str, detail: str = "", job_id: Optional[int] = None,
              confidence: Optional[float] = None) -> None:
        if conn is None:
            return
        try:
            conn.execute(
                _INSERT,
                (run_id, job_id, step, detail or "", confidence,
                 datetime.now(timezone.utc).isoformat()),
            )
            conn.commit()
        except Exception:
            # See the module docstring: the trace is never worth a failed run.
            pass

    return event


def noop(*_args, **_kwargs) -> None:
    """The recorder used when nothing is tracing."""
    return None
