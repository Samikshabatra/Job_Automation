# apply_agent/tests/test_fieldmap.py
from apply_agent.config import Profile
from apply_agent.fieldmap import Field, Mapping, map_fields, merge_llm_mapping

PROF = Profile("Samiksha Batra", "me@x.com", "999", "http://li/x")

def test_maps_obvious_contact_fields_with_high_confidence():
    fields = [
        Field(name="first_name", label="First Name", id="", aria="", kind="text", required=True),
        Field(name="last_name", label="Last Name", id="", aria="", kind="text", required=True),
        Field(name="email", label="Email", id="", aria="", kind="email", required=True),
    ]
    m = map_fields(fields, PROF)
    assert m.values["first_name"] == "Samiksha" and m.values["email"] == "me@x.com"
    assert m.unmapped == [] and m.confidence >= 0.85

def test_reports_unmapped_required_field_and_lowers_confidence():
    fields = [
        Field(name="email", label="Email", id="", aria="", kind="email", required=True),
        Field(name="q_custom", label="Why do you want this role?", id="", aria="", kind="textarea", required=True),
    ]
    m = map_fields(fields, PROF)
    assert "q_custom" in m.unmapped and m.confidence < 0.85


def test_merge_llm_mapping_reblends_confidence_after_llm_fills_fields():
    # A form the heuristic scored low (1 of 2 fields, 0.5) that the LLM then
    # maps completely must be re-scored to reflect the now-filled fields, or
    # `decide` keeps routing a fully-mapped form to manual (F4).
    fields = [
        Field(name="email", label="Email", id="", aria="", kind="email", required=True),
        Field(name="q_custom", label="Why do you want this role?", id="", aria="", kind="textarea", required=True),
    ]
    m = map_fields(fields, PROF)
    assert m.confidence == 0.5 and m.unmapped == ["q_custom"]  # RED baseline: pre-blend

    merge_llm_mapping(m, fields, {"q_custom": "Because I love data."})

    assert m.values["q_custom"] == "Because I love data."
    assert m.unmapped == []                 # newly-mapped name cleared
    assert m.confidence == 1.0              # both fields now filled -> 2/2


def test_merge_llm_mapping_is_conservative_when_llm_returns_nothing():
    fields = [
        Field(name="email", label="Email", id="", aria="", kind="email", required=True),
        Field(name="q_custom", label="Why?", id="", aria="", kind="textarea", required=True),
    ]
    m = map_fields(fields, PROF)
    merge_llm_mapping(m, fields, {})  # LLM mapped nothing
    assert m.unmapped == ["q_custom"]       # still unmapped
    assert m.confidence == 0.5              # only email filled -> 1/2, never inflated


def test_confidence_excludes_file_input_from_the_denominator():
    # A resume file input is uploaded out-of-band by fill_form, not via the
    # value mapping, so it must not count against confidence -- otherwise a
    # cleanly-fillable form scores (n)/(n+1) and never clears the auto-submit
    # threshold. It is also not a mapping gap, so it must not appear in unmapped.
    fields = [
        Field(name="first_name", label="First Name", id="", aria="", kind="text", required=True),
        Field(name="email", label="Email", id="", aria="", kind="email", required=True),
        Field(name="resume", label="Resume", id="", aria="", kind="file", required=True),
    ]
    m = map_fields(fields, PROF)
    assert m.confidence == 1.0          # 2 mapped / 2 countable -- file excluded
    assert "resume" not in m.unmapped


def test_merge_llm_confidence_excludes_file_input():
    fields = [
        Field(name="q_custom", label="Why?", id="", aria="", kind="textarea", required=True),
        Field(name="resume", label="Resume", id="", aria="", kind="file", required=True),
    ]
    m = Mapping(values={}, unmapped=["q_custom"], confidence=0.0)
    merge_llm_mapping(m, fields, {"q_custom": "because"})
    assert m.confidence == 1.0          # 1 filled / 1 countable -- file excluded
