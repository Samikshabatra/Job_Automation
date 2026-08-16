# apply_agent/tests/test_graph.py
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
