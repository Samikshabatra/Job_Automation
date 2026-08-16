# apply_agent/graph.py
"""Confidence-gated decision core, plus the LangGraph StateGraph that wires
the apply pipeline together.

`decide` and `verify_submit` are the safety-critical branch logic: they
decide whether an application is submitted live or routed to manual review,
and whether a submission is confirmed or treated as failed. They are plain
functions with no dependencies so they can be unit-tested directly.

`build_graph(deps)` wires those functions into a `StateGraph` alongside the
rest of the pipeline (load_job -> preflight -> open_page -> classify_form ->
map_fields -> fill -> check_blockers -> decide -> {submit | manual} ->
record -> delay). All I/O (browser, LLM, db, guards) is reached only through
the injected `Deps`, so the graph can be built and unit-tested without a
live browser.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, TypedDict

from langgraph.graph import END, StateGraph

from apply_agent import browser, db, detect, fieldmap, guards, llm
from apply_agent.fieldmap import Mapping


def decide(mapping: Mapping, has_captcha: bool, dry_run: bool, threshold: float) -> str:
    """Route to "submit" only when confident, unblocked, and not a dry run.

    Manual review is required if ANY of: dry_run is true, a captcha was
    detected, some required field was left unmapped, or confidence is below
    threshold. Only when none of those hold does this return "submit".
    """
    if dry_run or has_captcha or mapping.unmapped or mapping.confidence < threshold:
        return "manual"
    return "submit"


def verify_submit(html: str, is_confirmation: Callable[[str], bool]) -> str:
    """Confirm a submission from the resulting page HTML.

    Returns "submitted" only when `is_confirmation` positively recognizes a
    confirmation page. Any other outcome -- unrecognized markup, a loading
    state, a timeout -- is treated as "failed". The agent never reports a
    submission on uncertainty.
    """
    return "submitted" if is_confirmation(html) else "failed"


@dataclass
class Deps:
    """Injected dependencies for `build_graph`.

    Every field is optional so a graph can be constructed (and compiled) in
    tests without a live browser, LLM, or database. Real callers supply
    `conn`/`context`/`settings`/`profile` plus the callables the nodes use
    to reach the outside world.
    """

    conn: Any = None
    context: Any = None
    settings: Any = None
    profile: Any = None
    llm_call: Callable[[str], str] | None = None
    is_open: Callable[[str], bool] = lambda url: True
    next_job: Callable[[], Any] | None = None
    sleep: Callable[[int, int], Any] | None = None
    submitted_this_run: int = 0
    now: Any = None


class ApplyState(TypedDict, total=False):
    job: Any
    allow: bool
    status: str
    reason: str
    page: Any
    html: str
    fields: list
    mapping: Mapping
    has_captcha: bool
    route: str
    outcome: str


def build_graph(deps: Deps):
    """Wire the apply pipeline into a compiled LangGraph `StateGraph`.

    Node bodies are kept thin: each one delegates to the existing,
    independently-tested module functions (`guards.preflight`,
    `browser.*`, `fieldmap.map_fields`, `llm.map_unmapped`, `detect.*`,
    `db.*`) and to the `decide`/`verify_submit` functions above. All of
    those reach the outside world only through `deps`.
    """
    graph = StateGraph(ApplyState)

    async def load_job(state: ApplyState) -> dict:
        if deps.next_job is not None:
            return {"job": deps.next_job()}
        return {}

    async def preflight_node(state: ApplyState) -> dict:
        decision = guards.preflight(
            deps.conn, state["job"], deps.settings, deps.submitted_this_run, deps.now, deps.is_open
        )
        return {"allow": decision.allow, "status": decision.status, "reason": decision.reason}

    async def open_page(state: ApplyState) -> dict:
        page = await browser.open_form(deps.context, state["job"].url)
        return {"page": page}

    async def classify_form(state: ApplyState) -> dict:
        html = await state["page"].content()
        return {"html": html, "has_captcha": detect.has_captcha(html)}

    async def map_fields_node(state: ApplyState) -> dict:
        fields = await browser.read_fields(state["page"])
        mapping = fieldmap.map_fields(fields, deps.profile)
        if mapping.unmapped and deps.llm_call is not None:
            remaining = [f for f in fields if f.name in mapping.unmapped]
            extra = llm.map_unmapped(remaining, deps.profile, deps.llm_call)
            mapping.values.update(extra)
            mapping.unmapped = [name for name in mapping.unmapped if name not in extra]
        return {"fields": fields, "mapping": mapping}

    async def fill(state: ApplyState) -> dict:
        await browser.fill_form(state["page"], state["mapping"].values, state["job"].resume_path)
        return {}

    async def check_blockers(state: ApplyState) -> dict:
        html = await state["page"].content()
        return {"html": html, "has_captcha": detect.has_captcha(html)}

    async def decide_node(state: ApplyState) -> dict:
        route = decide(
            state["mapping"], state["has_captcha"], deps.settings.dry_run, deps.settings.confidence_threshold
        )
        return {"route": route}

    def route_decision(state: ApplyState) -> str:
        return state["route"]

    async def submit(state: ApplyState) -> dict:
        await browser.submit_form(state["page"])
        html = await state["page"].content()
        outcome = verify_submit(html, detect.is_confirmation)
        return {"outcome": outcome, "html": html}

    async def manual(state: ApplyState) -> dict:
        return {"outcome": "manual"}

    async def record(state: ApplyState) -> dict:
        job = state["job"]
        if state.get("outcome") == "submitted":
            db.record_submitted(deps.conn, job, deps.profile.email)
        else:
            db.mark_status(deps.conn, job.id, "held", state.get("outcome", "manual"))
        return {}

    async def delay(state: ApplyState) -> dict:
        if deps.sleep is not None:
            await deps.sleep(deps.settings.min_delay, deps.settings.max_delay)
        return {}

    graph.add_node("load_job", load_job)
    graph.add_node("preflight", preflight_node)
    graph.add_node("open_page", open_page)
    graph.add_node("classify_form", classify_form)
    graph.add_node("map_fields", map_fields_node)
    graph.add_node("fill", fill)
    graph.add_node("check_blockers", check_blockers)
    graph.add_node("decide", decide_node)
    graph.add_node("submit", submit)
    graph.add_node("manual", manual)
    graph.add_node("record", record)
    graph.add_node("delay", delay)

    graph.set_entry_point("load_job")
    graph.add_edge("load_job", "preflight")
    graph.add_edge("preflight", "open_page")
    graph.add_edge("open_page", "classify_form")
    graph.add_edge("classify_form", "map_fields")
    graph.add_edge("map_fields", "fill")
    graph.add_edge("fill", "check_blockers")
    graph.add_edge("check_blockers", "decide")
    graph.add_conditional_edges("decide", route_decision, {"submit": "submit", "manual": "manual"})
    graph.add_edge("submit", "record")
    graph.add_edge("manual", "record")
    graph.add_edge("record", "delay")
    graph.add_edge("delay", END)

    return graph.compile()
