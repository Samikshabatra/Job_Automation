# apply_agent/tests/test_config.py
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
