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


def _f(name, label="", required=True):
    return Field(name=name, label=label, id="", aria="", kind="text", required=required)


def test_maps_a_bare_name_field_to_the_full_name():
    # Ashby names its identity fields `_systemfield_name` / `_systemfield_email`
    # and renders the human label in a separate element. Requiring the words
    # "full name" left a live Snowflake form with its Full Name box empty while
    # Email filled correctly.
    m = map_fields([_f("_systemfield_name")], PROF)
    assert m.values["_systemfield_name"] == "Samiksha Batra"


def test_a_bare_name_rule_does_not_steal_first_and_last_name_fields():
    # "first_name" and "last_name" both contain "name". They must keep going to
    # the split parts, or a form with separate boxes gets the full name in both.
    m = map_fields([_f("first_name"), _f("last_name")], PROF)
    assert m.values["first_name"] == "Samiksha"
    assert m.values["last_name"] == "Batra"


def test_a_bare_name_rule_does_not_claim_unrelated_name_questions():
    # A custom question is not an identity field. Answering it with the
    # candidate's own name submits a wrong answer instead of leaving a blank
    # one for a human to fill.
    m = map_fields([_f("company_name"), _f("referrer_name")], PROF)
    assert "company_name" not in m.values
    assert "referrer_name" not in m.values


def _choice(name, label, kind, required=True):
    return Field(name=name, label=label, id="", aria="", kind=kind, required=required)


def test_a_checkbox_is_never_filled_with_a_profile_value():
    # A live Notion form asks "How did you hear about us?" as a checkbox list,
    # one option of which is labelled "LinkedIn". Matching it against the
    # linkedin pattern typed the candidate's profile URL into a tick box --
    # a confidently wrong answer on a real application.
    m = map_fields([_choice("e01a85db", "LinkedIn", "checkbox")], PROF)
    assert m.values == {}


def test_a_radio_option_is_never_filled_with_a_profile_value():
    m = map_fields([_choice("q_source", "Email", "radio")], PROF)
    assert m.values == {}


def test_a_required_choice_field_still_counts_as_unmapped():
    # It is a real question with no answer, so it must keep forcing manual
    # review rather than quietly disappearing from the gate.
    m = map_fields([_choice("consent", "I agree to the privacy notice", "checkbox")], PROF)
    assert "consent" in m.unmapped


def test_text_fields_are_unaffected_by_the_choice_guard():
    m = map_fields([_f("linkedin_url", label="LinkedIn Profile")], PROF)
    assert m.values["linkedin_url"] == "http://li/x"
