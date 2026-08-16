# apply_agent/tests/test_config.py
import yaml

from apply_agent.config import load_settings, load_profile

def test_settings_defaults_new_keys(tmp_path):
    yaml = tmp_path / "criteria.yaml"
    yaml.write_text(
        "submission:\n  dry_run: true\n"
        "limits:\n  daily_cap: 30\n  per_company_open_applications: 3\n"
        "  min_delay_seconds: 45\n  max_delay_seconds: 120\n"
    )
    s = load_settings(str(yaml))
    assert s.dry_run is True
    assert s.browser_enabled is False        # new key defaults off
    assert s.confidence_threshold == 0.85     # new key default
    assert s.daily_cap == 30 and s.per_company_cap == 3

def test_profile_reads_contact(tmp_path):
    p = tmp_path / "profile.json"
    p.write_text('{"name":"Samiksha Batra","email":"a@b.com","phone":"123","links":{"linkedin":"http://li/x"}}')
    prof = load_profile(str(p))
    assert prof.name == "Samiksha Batra" and prof.linkedin == "http://li/x"

def test_quoted_string_booleans_coerced_safely(tmp_path):
    # Quoted "false"/"true" in YAML must not be truthy-coerced by bare bool().
    # browser_enabled is the live-submit kill switch; a quoted "false" that
    # silently evaluates True would enable live job submission unintentionally.
    yaml = tmp_path / "criteria.yaml"
    yaml.write_text(
        'submission:\n  dry_run: "false"\n  browser_enabled: "false"\n'
    )
    s = load_settings(str(yaml))
    assert s.dry_run is False
    assert s.browser_enabled is False

    yaml2 = tmp_path / "criteria2.yaml"
    yaml2.write_text(
        'submission:\n  dry_run: "true"\n  browser_enabled: "yes"\n'
    )
    s2 = load_settings(str(yaml2))
    assert s2.dry_run is True
    assert s2.browser_enabled is True

def test_real_criteria_yaml_has_explicit_new_keys():
    # load_settings() DEFAULTS browser_enabled/confidence_threshold when
    # absent, so merely checking the resulting Settings would pass even if
    # config/criteria.yaml never declared the keys. Task 10 requires the
    # keys to be LITERALLY PRESENT in the real repo file, so parse the yaml
    # directly and check the submission block itself.
    with open("config/criteria.yaml", encoding="utf-8") as f:
        criteria = yaml.safe_load(f)
    submission = criteria["submission"]
    assert "browser_enabled" in submission
    assert "confidence_threshold" in submission
    assert submission["dry_run"] is True  # must not be disturbed

    s = load_settings("config/criteria.yaml")
    assert s.browser_enabled is False
    assert s.confidence_threshold == 0.85
