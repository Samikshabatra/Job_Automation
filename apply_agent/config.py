# apply_agent/config.py
import json
from dataclasses import dataclass
import yaml


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
        dry_run=bool(sub.get("dry_run", True)),
        browser_enabled=bool(sub.get("browser_enabled", False)),
        confidence_threshold=float(sub.get("confidence_threshold", 0.85)),
        daily_cap=int(lim.get("daily_cap", 30)),
        per_company_cap=int(lim.get("per_company_open_applications", 3)),
        min_delay=int(lim.get("min_delay_seconds", 45)),
        max_delay=int(lim.get("max_delay_seconds", 120)),
    )


def load_profile(path: str) -> Profile:
    d = json.load(open(path, encoding="utf-8"))
    return Profile(d["name"], d["email"], d.get("phone", ""), d.get("links", {}).get("linkedin", ""))
