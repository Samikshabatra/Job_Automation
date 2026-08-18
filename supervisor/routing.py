"""Routing predicates for the supervisor's conditional edges.

These read the shared pipeline.db / config to decide which agents actually
need to run this cycle -- the reason the pipeline is a LangGraph and not a
flat shell chain.
"""

# Same prefix resume_agent selects on (src/run/daily.ts writes it).
_FABRICATION_PREFIX = "fabrication check failed%"


def has_fabrication_failures(conn) -> bool:
    """True if any job is 'failed' for a fabrication reason -- i.e. the
    resume-optimizer has something to repair this cycle."""
    row = conn.execute(
        "SELECT 1 FROM jobs WHERE status = 'failed' AND status_reason LIKE ? LIMIT 1",
        (_FABRICATION_PREFIX,),
    ).fetchone()
    return row is not None
