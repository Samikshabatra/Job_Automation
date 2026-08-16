# apply_agent/tests/test_llm.py
from apply_agent.config import Profile
from apply_agent.fieldmap import Field
from apply_agent.llm import map_unmapped

PROF = Profile("Samiksha Batra", "me@x.com", "999", "http://li/x")


def test_maps_via_injected_call():
    fields = [Field(name="q_years", label="Years of experience", id="", aria="", kind="text", required=True)]
    called = {}

    def fake(prompt):
        called["prompt"] = prompt
        return '{"q_years": "2"}'

    out = map_unmapped(fields, PROF, fake)
    assert out == {"q_years": "2"}
    assert "Years of experience" in called["prompt"]


def test_bad_json_returns_empty_never_raises():
    fields = [Field(name="q", label="Q", id="", aria="", kind="text", required=True)]
    assert map_unmapped(fields, PROF, lambda p: "not json") == {}


def test_valid_json_non_object_returns_empty_never_raises():
    fields = [Field(name="q", label="Q", id="", aria="", kind="text", required=True)]
    # Valid JSON, but not an object -> .items() would raise AttributeError if uncaught.
    assert map_unmapped(fields, PROF, lambda p: "[1, 2, 3]") == {}
    assert map_unmapped(fields, PROF, lambda p: '"hello"') == {}


def test_empty_fields_returns_empty_without_calling():
    def boom(prompt):
        raise AssertionError("call must not run when there are no fields")

    assert map_unmapped([], PROF, boom) == {}
