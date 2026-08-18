"""Top-level entrypoint: run the whole job pipeline as one conditional
LangGraph.

    python -m supervisor

Runs `npm run daily` (discover/filter/score/tailor), then the resume-optimizer
only when there are fabrication failures to repair, then the apply-agent only
when browser submission is enabled, then prints a combined report.
"""
import os

from supervisor.graph import build_supervisor
from supervisor.steps import RealSteps


def main() -> None:  # untested wiring: real subprocesses
    graph = build_supervisor(RealSteps(os.getcwd()))
    final = graph.invoke({"ran": [], "summary": {}})
    print("Supervisor ran:", " -> ".join(final["ran"]))
    for step, result in final["summary"].items():
        print(f"  {step}: {result}")


if __name__ == "__main__":
    main()
