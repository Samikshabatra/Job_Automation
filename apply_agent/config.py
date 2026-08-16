# apply_agent/config.py
import json
from dataclasses import dataclass
import yaml

_FALSY_STRINGS = {"false", "no", "0", ""}
_TRUTHY_STRINGS = {"true", "yes", "1"}


def _coerce_bool(value, default: bool) -> bool:
    """Safely coerce a YAML-parsed value to bool.

    YAML's safe_load already converts unquoted true/false/yes/no into native
    Python bools, but a quoted value (e.g. `browser_enabled: "false"`) comes
    through as the string "false". Bare bool("false") is True, which would
    silently enable the live-submit kill switch or disable the dry-run
    safety flag. This coerces known string forms explicitly instead of
    relying on Python truthiness.
    """
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in _FALSY_STRINGS:
            return False
        if normalized in _TRUTHY_STRINGS:
            return True
        return default
    return bool(value)


@dataclass
class Settings:
    dry_run: bool
    browser_enabled: bool
    confidence_threshold: float
    daily_cap: int
    per_company_cap: int
    min_delay: int
    max_delay: int


@dataclass
class Profile:
    name: str
    email: str
    phone: str
    linkedin: str


def load_settings(criteria_path: str) -> Settings:
    c = yaml.safe_load(open(criteria_path, encoding="utf-8"))
    sub, lim = c.get("submission", {}), c.get("limits", {})
    return Settings(
        dry_run=_coerce_bool(sub.get("dry_run"), default=True),
        browser_enabled=_coerce_bool(sub.get("browser_enabled"), default=False),
        confidence_threshold=float(sub.get("confidence_threshold", 0.85)),
        daily_cap=int(lim.get("daily_cap", 30)),
        per_company_cap=int(lim.get("per_company_open_applications", 3)),
        min_delay=int(lim.get("min_delay_seconds", 45)),
        max_delay=int(lim.get("max_delay_seconds", 120)),
    )


def load_profile(path: str) -> Profile:
    d = json.load(open(path, encoding="utf-8"))
    return Profile(d["name"], d["email"], d.get("phone", ""), d.get("links", {}).get("linkedin", ""))
