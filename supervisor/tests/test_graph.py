from supervisor.graph import build_supervisor


class _FakeSteps:
    """Stands in for the real subprocess step runners so the graph's routing
    can be exercised without launching npm/Playwright/Gemini."""
    def __init__(self, has_failures: bool, browser_enabled: bool):
        self._failures = has_failures
        self._browser = browser_enabled
        self.calls = []

    def run_daily(self):
        self.calls.append("daily")
        return {"discovered": 5}

    def run_optimize(self):
        self.calls.append("optimize")
        return {"repaired": 2}

    def run_apply(self):
        self.calls.append("apply")
        return {"submitted": 1}

    def has_failures(self):
        return self._failures

    def browser_enabled(self):
        return self._browser


def _run(steps):
    return build_supervisor(steps).invoke({"ran": [], "summary": {}})


def test_all_three_run_when_failures_exist_and_browser_on():
    steps = _FakeSteps(has_failures=True, browser_enabled=True)
    state = _run(steps)
    assert state["ran"] == ["discover", "optimize", "submit", "report"]
    assert state["summary"]["submit"] == {"submitted": 1}
    assert steps.calls == ["daily", "optimize", "apply"]


def test_optimize_is_skipped_when_there_are_no_fabrication_failures():
    steps = _FakeSteps(has_failures=False, browser_enabled=True)
    state = _run(steps)
    assert state["ran"] == ["discover", "submit", "report"]
    assert "optimize" not in steps.calls


def test_submit_is_skipped_when_browser_is_disabled():
    steps = _FakeSteps(has_failures=True, browser_enabled=False)
    state = _run(steps)
    assert state["ran"] == ["discover", "optimize", "report"]
    assert "apply" not in steps.calls


def test_only_discover_and_report_when_nothing_to_optimize_or_submit():
    steps = _FakeSteps(has_failures=False, browser_enabled=False)
    state = _run(steps)
    assert state["ran"] == ["discover", "report"]
    assert steps.calls == ["daily"]
