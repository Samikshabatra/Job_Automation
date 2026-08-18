"""The top-level LangGraph that sequences the three agents with conditional
routing: discover (TS daily) -> optimize (resume-agent, only if there are
fabrication failures) -> submit (apply-agent, only if the kill switch is on)
-> report.

`build_supervisor(steps)` closes over an injected `steps` object so the graph
can be driven with fakes in tests. `steps` exposes:
  run_daily()     -> dict   run the TS discovery/tailor pipeline
  run_optimize()  -> dict   run the resume-optimizer repair loop
  run_apply()     -> dict   run the apply-agent submit loop
  has_failures()  -> bool   are there fabrication-failed jobs to repair?
  browser_enabled()-> bool  is live browser submission enabled?
"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import StateGraph, START, END


def _merge(a: dict, b: dict) -> dict:
    return {**a, **b}


class SupervisorState(TypedDict):
    ran: Annotated[list, operator.add]
    summary: Annotated[dict, _merge]


def build_supervisor(steps):
    def discover(state):
        return {"ran": ["discover"], "summary": {"discover": steps.run_daily()}}

    def optimize(state):
        return {"ran": ["optimize"], "summary": {"optimize": steps.run_optimize()}}

    def submit(state):
        return {"ran": ["submit"], "summary": {"submit": steps.run_apply()}}

    def report(state):
        return {"ran": ["report"]}

    # Routing: `has_failures`/`browser_enabled` are read at routing time, so
    # they reflect what `discover` just produced / the live config.
    def after_discover(state):
        if steps.has_failures():
            return "optimize"
        return "submit" if steps.browser_enabled() else "report"

    def after_optimize(state):
        return "submit" if steps.browser_enabled() else "report"

    g = StateGraph(SupervisorState)
    g.add_node("discover", discover)
    g.add_node("optimize", optimize)
    g.add_node("submit", submit)
    g.add_node("report", report)

    g.add_edge(START, "discover")
    g.add_conditional_edges("discover", after_discover,
                            {"optimize": "optimize", "submit": "submit", "report": "report"})
    g.add_conditional_edges("optimize", after_optimize,
                            {"submit": "submit", "report": "report"})
    g.add_edge("submit", "report")
    g.add_edge("report", END)
    return g.compile()
