# Apply-Agent (LangGraph) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python LangGraph agent that submits queued jobs by driving the real application form in a browser, replacing the broken HTTP-400 ATS POST replay.

**Architecture:** A new standalone Python package `apply_agent/` reuses the TypeScript pipeline through the shared SQLite database `data/pipeline.db` (reads `tailored`/`deferred` jobs, writes `applications` + `jobs.status`) and the `npm run track` CLI for the tracker. A LangGraph `StateGraph` runs one job at a time through load → preflight → open → classify → map → fill → check → decide → submit → record → delay, auto-submitting only when field-mapping confidence clears a threshold and no captcha is present; otherwise it screenshots and queues for manual completion.

**Tech Stack:** Python 3.11+, LangGraph, Playwright (Python, Chromium headed), google-generativeai (Gemini fallback mapping), PyYAML, pytest, pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-08-16-apply-agent-langgraph-design.md`

## Global Constraints

- Package lives at repo root as `apply_agent/`; tests in `apply_agent/tests/`.
- Reuse `data/pipeline.db` on the EXISTING schema — never alter slice-1 tables.
- Read all knobs from `config/criteria.yaml`; add only new keys `submission.browser_enabled` (default `false`) and `submission.confidence_threshold` (default `0.85`).
- `applications.method` for agent submits is the literal string `agent`.
- Manual-queue jobs get `jobs.status = 'held'` (existing status; never auto-reconsidered).
- **Never mark a job applied on an uncertain or timed-out submit** — record `failed`, so dedup allows a retry.
- No test may touch a live employer; browser tests use Playwright route interception over saved HTML fixtures.
- Every commit uses the existing author identity; end messages with the `Co-Authored-By` trailer.

## File Structure

| File | Responsibility |
|---|---|
| `apply_agent/pyproject.toml` | Package metadata + pinned deps |
| `apply_agent/config.py` | Load `criteria.yaml` + `resume/profile.json` into typed dataclasses |
| `apply_agent/db.py` | Read queued jobs; write applications + status against `pipeline.db` |
| `apply_agent/guards.py` | dry_run/browser_enabled/caps/delays/dedupe/liveness decisions |
| `apply_agent/fieldmap.py` | Heuristic form-input → profile-field mapping + confidence |
| `apply_agent/detect.py` | Captcha / confirmation-page detection from page HTML |
| `apply_agent/llm.py` | Gemini fallback mapping for unmapped fields |
| `apply_agent/browser.py` | Playwright headed context, navigate, fill, upload, screenshot |
| `apply_agent/graph.py` | LangGraph StateGraph wiring all nodes + branches |
| `apply_agent/__main__.py` | CLI entrypoint `python -m apply_agent` + tracker refresh |
| `apply_agent/tests/fixtures/*.html` | Saved greenhouse/lever/bespoke forms |

---

### Task 1: Package scaffold + config loader

**Files:**
- Create: `apply_agent/pyproject.toml`, `apply_agent/__init__.py`, `apply_agent/config.py`
- Test: `apply_agent/tests/test_config.py`

**Interfaces:**
- Produces: `load_settings(criteria_path: str) -> Settings` where `Settings` has `dry_run: bool`, `browser_enabled: bool`, `confidence_threshold: float`, `daily_cap: int`, `per_company_cap: int`, `min_delay: int`, `max_delay: int`. `load_profile(path: str) -> Profile` with `name, email, phone, linkedin`.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apply_agent && pip install -e . && pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: apply_agent.config`.

- [ ] **Step 3: Write minimal implementation**

```python
# apply_agent/config.py
import json
from dataclasses import dataclass
import yaml

@dataclass
class Settings:
    dry_run: bool; browser_enabled: bool; confidence_threshold: float
    daily_cap: int; per_company_cap: int; min_delay: int; max_delay: int

@dataclass
class Profile:
    name: str; email: str; phone: str; linkedin: str

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
```

Provide `pyproject.toml` pinning `langgraph`, `playwright`, `google-generativeai`, `pyyaml`, `pytest`, `pytest-asyncio`; set `[project] name="apply-agent"`, `requires-python=">=3.11"`, and a `[tool.pytest.ini_options] asyncio_mode="auto"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apply_agent && pytest tests/test_config.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apply_agent/pyproject.toml apply_agent/__init__.py apply_agent/config.py apply_agent/tests/test_config.py
git commit -m "feat(apply-agent): package scaffold and config loader"
```

---

### Task 2: DB read/write layer

**Files:**
- Create: `apply_agent/db.py`
- Test: `apply_agent/tests/test_db.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `queued_jobs(conn) -> list[Job]` (`Job` has `id, company, title, url, ats_platform, resume_path, fingerprint`), `open_apps_for_company(conn, company) -> int`, `count_applied_today(conn, now_iso) -> int`, `record_submitted(conn, job, email) -> None`, `mark_status(conn, job_id, status, reason) -> None`.

- [ ] **Step 1: Write the failing test**

```python
# apply_agent/tests/test_db.py
import sqlite3
from apply_agent.db import queued_jobs, record_submitted, mark_status, open_apps_for_company

SCHEMA = """
CREATE TABLE jobs(id INTEGER PRIMARY KEY, fingerprint TEXT, company TEXT, title TEXT,
  url TEXT, ats_platform TEXT, resume_path TEXT, status TEXT, first_seen_at TEXT, created_at TEXT);
CREATE TABLE applications(id INTEGER PRIMARY KEY, job_id INTEGER, company TEXT, title TEXT,
  applied_at TEXT, method TEXT, email_used TEXT, outcome TEXT DEFAULT 'awaiting');
"""

def _db():
    c = sqlite3.connect(":memory:"); c.row_factory = sqlite3.Row; c.executescript(SCHEMA); return c

def test_queued_returns_tailored_and_deferred():
    c = _db()
    c.execute("INSERT INTO jobs(company,title,url,ats_platform,resume_path,status) VALUES('Acme','DA','u','greenhouse','/r.pdf','tailored')")
    c.execute("INSERT INTO jobs(company,title,url,status) VALUES('X','Y','u2','skipped')")
    c.commit()
    jobs = queued_jobs(c)
    assert [j.company for j in jobs] == ['Acme']

def test_record_submitted_writes_application_and_status():
    c = _db()
    c.execute("INSERT INTO jobs(id,company,title,url,resume_path,status) VALUES(7,'Acme','DA','u','/r.pdf','tailored')"); c.commit()
    jobs = queued_jobs(c)
    record_submitted(c, jobs[0], "me@x.com")
    row = c.execute("SELECT method,email_used FROM applications WHERE job_id=7").fetchone()
    assert row["method"] == "agent" and row["email_used"] == "me@x.com"
    assert c.execute("SELECT status FROM jobs WHERE id=7").fetchone()["status"] == "submitted"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apply_agent && pytest tests/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError: apply_agent.db`.

- [ ] **Step 3: Write minimal implementation**

```python
# apply_agent/db.py
from dataclasses import dataclass
from datetime import datetime, timezone

@dataclass
class Job:
    id: int; company: str; title: str; url: str
    ats_platform: str | None; resume_path: str | None; fingerprint: str | None

_OPEN = ("awaiting", "acknowledged", "screening", "interview")

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def queued_jobs(conn) -> list[Job]:
    rows = conn.execute(
        "SELECT id,company,title,url,ats_platform,resume_path,fingerprint FROM jobs "
        "WHERE status IN ('tailored','deferred') ORDER BY id"
    ).fetchall()
    return [Job(r["id"], r["company"], r["title"], r["url"], r["ats_platform"], r["resume_path"], r["fingerprint"]) for r in rows]

def open_apps_for_company(conn, company: str) -> int:
    q = ",".join("?" * len(_OPEN))
    return conn.execute(f"SELECT COUNT(*) n FROM applications WHERE company=? AND outcome IN ({q})", (company, *_OPEN)).fetchone()["n"]

def count_applied_today(conn, since_iso: str) -> int:
    return conn.execute("SELECT COUNT(*) n FROM applications WHERE applied_at>=?", (since_iso,)).fetchone()["n"]

def record_submitted(conn, job: Job, email: str) -> None:
    conn.execute(
        "INSERT INTO applications(job_id,company,title,applied_at,method,email_used) VALUES(?,?,?,?,?,?)",
        (job.id, job.company, job.title, _now(), "agent", email),
    )
    conn.execute("UPDATE jobs SET status='submitted', submitted_at=? WHERE id=?", (_now(), job.id)) if _has_col(conn) else conn.execute("UPDATE jobs SET status='submitted' WHERE id=?", (job.id,))
    conn.commit()

def _has_col(conn) -> bool:
    return any(r["name"] == "submitted_at" for r in conn.execute("PRAGMA table_info(jobs)").fetchall())

def mark_status(conn, job_id: int, status: str, reason: str) -> None:
    conn.execute("UPDATE jobs SET status=?, status_reason=? WHERE id=?", (status, reason, job_id)) if _has_col_named(conn, "status_reason") else conn.execute("UPDATE jobs SET status=? WHERE id=?", (status, job_id))
    conn.commit()

def _has_col_named(conn, name: str) -> bool:
    return any(r["name"] == name for r in conn.execute("PRAGMA table_info(jobs)").fetchall())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apply_agent && pytest tests/test_db.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apply_agent/db.py apply_agent/tests/test_db.py
git commit -m "feat(apply-agent): sqlite read/write layer over pipeline.db"
```

---

### Task 3: Guards (dry_run, caps, dedupe, liveness)

**Files:**
- Create: `apply_agent/guards.py`
- Test: `apply_agent/tests/test_guards.py`

**Interfaces:**
- Consumes: `Settings` (Task 1), `Job` + `open_apps_for_company` + `count_applied_today` (Task 2).
- Produces: `preflight(conn, job, settings, submitted_this_run, now, is_open) -> Decision` where `Decision` has `allow: bool`, `status: str`, `reason: str`. `is_open` is a callable `(url) -> bool` injected for testability.

- [ ] **Step 1: Write the failing test**

```python
# apply_agent/tests/test_guards.py
import sqlite3
from datetime import datetime, timezone
from apply_agent.config import Settings
from apply_agent.db import Job
from apply_agent.guards import preflight

def _settings(**kw):
    base = dict(dry_run=False, browser_enabled=True, confidence_threshold=0.85,
                daily_cap=30, per_company_cap=3, min_delay=0, max_delay=0)
    base.update(kw); return Settings(**base)

def _conn():
    c = sqlite3.connect(":memory:"); c.row_factory = sqlite3.Row
    c.executescript("CREATE TABLE applications(id INTEGER PRIMARY KEY, company TEXT, applied_at TEXT, outcome TEXT DEFAULT 'awaiting');")
    return c

JOB = Job(1, "Acme", "DA", "http://acme/apply", "greenhouse", "/r.pdf", "fp1")
NOW = datetime(2026, 8, 16, tzinfo=timezone.utc)

def test_blocks_when_browser_disabled():
    d = preflight(_conn(), JOB, _settings(browser_enabled=False), 0, NOW, lambda u: True)
    assert d.allow is False and "disabled" in d.reason

def test_blocks_when_daily_cap_reached():
    d = preflight(_conn(), JOB, _settings(daily_cap=2), 2, NOW, lambda u: True)
    assert d.allow is False and d.status == "deferred"

def test_holds_when_posting_closed():
    d = preflight(_conn(), JOB, _settings(), 0, NOW, lambda u: False)
    assert d.allow is False and d.status == "skipped"

def test_allows_a_clean_job():
    d = preflight(_conn(), JOB, _settings(), 0, NOW, lambda u: True)
    assert d.allow is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apply_agent && pytest tests/test_guards.py -v`
Expected: FAIL — `ModuleNotFoundError: apply_agent.guards`.

- [ ] **Step 3: Write minimal implementation**

```python
# apply_agent/guards.py
from dataclasses import dataclass
from apply_agent.db import open_apps_for_company, count_applied_today

@dataclass
class Decision:
    allow: bool; status: str; reason: str

def preflight(conn, job, settings, submitted_this_run, now, is_open) -> Decision:
    if not settings.browser_enabled:
        return Decision(False, "held", "browser submission disabled")
    if submitted_this_run >= settings.daily_cap:
        return Decision(False, "deferred", f"daily cap {settings.daily_cap} reached")
    if open_apps_for_company(conn, job.company) >= settings.per_company_cap:
        return Decision(False, "deferred", f"per-company cap for {job.company}")
    if not is_open(job.url):
        return Decision(False, "skipped", "posting no longer open")
    return Decision(True, "tailored", "")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apply_agent && pytest tests/test_guards.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apply_agent/guards.py apply_agent/tests/test_guards.py
git commit -m "feat(apply-agent): preflight guards for caps, kill-switch and liveness"
```

---

### Task 4: Heuristic field mapping

**Files:**
- Create: `apply_agent/fieldmap.py`, `apply_agent/tests/fixtures/greenhouse_form.html`, `apply_agent/tests/fixtures/ambiguous_form.html`
- Test: `apply_agent/tests/test_fieldmap.py`

**Interfaces:**
- Consumes: `Profile` (Task 1).
- Produces: `map_fields(inputs: list[Field], profile) -> Mapping` where `Field` has `name, label, id, aria, kind` and `Mapping` has `values: dict[str,str]` (input name → value), `unmapped: list[str]` (names of required-but-unmapped), `confidence: float` in `[0,1]`.

- [ ] **Step 1: Write the failing test**

```python
# apply_agent/tests/test_fieldmap.py
from apply_agent.config import Profile
from apply_agent.fieldmap import Field, map_fields

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apply_agent && pytest tests/test_fieldmap.py -v`
Expected: FAIL — `ModuleNotFoundError: apply_agent.fieldmap`.

- [ ] **Step 3: Write minimal implementation**

```python
# apply_agent/fieldmap.py
from dataclasses import dataclass, field as dc_field

@dataclass
class Field:
    name: str; label: str; id: str; aria: str; kind: str; required: bool = False

@dataclass
class Mapping:
    values: dict; unmapped: list; confidence: float

_PATTERNS = {
    "first": ("first",), "last": ("last", "surname"),
    "email": ("email", "e-mail"), "phone": ("phone", "mobile", "contact number"),
    "linkedin": ("linkedin",), "full_name": ("full name", "your name"),
}

def _hay(f: Field) -> str:
    return " ".join([f.name, f.label, f.id, f.aria]).lower()

def map_fields(fields, profile) -> Mapping:
    first, *rest = profile.name.split()
    last = " ".join(rest) or first
    supply = {"first": first, "last": last, "full_name": profile.name,
              "email": profile.email, "phone": profile.phone, "linkedin": profile.linkedin}
    values, unmapped, matched = {}, [], 0
    for f in fields:
        hay = _hay(f)
        hit = next((k for k, pats in _PATTERNS.items() if any(p in hay for p in pats)), None)
        if hit and supply.get(hit):
            values[f.name] = supply[hit]; matched += 1
        elif f.required:
            unmapped.append(f.name)
    total = len(fields) or 1
    confidence = matched / total
    return Mapping(values, unmapped, confidence)
```

Also save two fixtures: `greenhouse_form.html` (a real captured Greenhouse form with `first_name`/`last_name`/`email`/`phone`/`resume` inputs) and `ambiguous_form.html` (inputs whose labels do not clearly map). These feed Tasks 6–7.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apply_agent && pytest tests/test_fieldmap.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apply_agent/fieldmap.py apply_agent/tests/test_fieldmap.py apply_agent/tests/fixtures/
git commit -m "feat(apply-agent): heuristic field mapping with confidence"
```

---

### Task 5: Captcha / confirmation detection

**Files:**
- Create: `apply_agent/detect.py`
- Test: `apply_agent/tests/test_detect.py`

**Interfaces:**
- Produces: `has_captcha(html: str) -> bool`, `is_confirmation(html: str) -> bool`.

- [ ] **Step 1: Write the failing test**

```python
# apply_agent/tests/test_detect.py
from apply_agent.detect import has_captcha, is_confirmation

def test_detects_recaptcha_and_hcaptcha():
    assert has_captcha('<div class="g-recaptcha" data-sitekey="x"></div>') is True
    assert has_captcha('<iframe src="https://hcaptcha.com/..."></iframe>') is True
    assert has_captcha("<form><input name=email></form>") is False

def test_detects_confirmation_page():
    assert is_confirmation("<h1>Thank you for applying</h1>") is True
    assert is_confirmation("<p>Your application has been received.</p>") is True
    assert is_confirmation("<form>Apply now</form>") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apply_agent && pytest tests/test_detect.py -v`
Expected: FAIL — `ModuleNotFoundError: apply_agent.detect`.

- [ ] **Step 3: Write minimal implementation**

```python
# apply_agent/detect.py
import re

_CAPTCHA = re.compile(r"g-recaptcha|recaptcha/api|hcaptcha\.com|data-sitekey|cf-challenge", re.I)
_CONFIRM = re.compile(r"thank you for applying|application (has been )?received|successfully submitted|we('|’)ve received your application", re.I)

def has_captcha(html: str) -> bool:
    return bool(_CAPTCHA.search(html or ""))

def is_confirmation(html: str) -> bool:
    return bool(_CONFIRM.search(html or ""))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apply_agent && pytest tests/test_detect.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apply_agent/detect.py apply_agent/tests/test_detect.py
git commit -m "feat(apply-agent): captcha and confirmation-page detection"
```

---

### Task 6: LLM fallback mapping (mocked)

**Files:**
- Create: `apply_agent/llm.py`
- Test: `apply_agent/tests/test_llm.py`

**Interfaces:**
- Consumes: `Field` (Task 4), `Profile` (Task 1).
- Produces: `map_unmapped(fields: list[Field], profile, call) -> dict[str,str]` where `call(prompt: str) -> str` is an injected function returning JSON; the real caller wraps Gemini. Unparseable/empty JSON yields `{}` (never raises).

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apply_agent && pytest tests/test_llm.py -v`
Expected: FAIL — `ModuleNotFoundError: apply_agent.llm`.

- [ ] **Step 3: Write minimal implementation**

```python
# apply_agent/llm.py
import json

def map_unmapped(fields, profile, call) -> dict:
    if not fields:
        return {}
    described = "\n".join(f"- name={f.name!r} label={f.label!r} kind={f.kind}" for f in fields)
    prompt = (
        "Map each form field to a value for this candidate. Use ONLY these facts; "
        "if unknown, omit the field. Reply with a JSON object of name->value.\n"
        f"Candidate: name={profile.name}, email={profile.email}, phone={profile.phone}, "
        f"linkedin={profile.linkedin}.\nFields:\n{described}"
    )
    try:
        raw = call(prompt)
        data = json.loads(raw)
        return {k: str(v) for k, v in data.items() if isinstance(k, str)}
    except (json.JSONDecodeError, TypeError, ValueError):
        return {}
```

A separate real caller `gemini_call(prompt)` wrapping `google-generativeai` with `GEMINI_API_KEY`/`GEMINI_MODEL` is wired only in `__main__` (Task 8); it is never imported by a test.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apply_agent && pytest tests/test_llm.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apply_agent/llm.py apply_agent/tests/test_llm.py
git commit -m "feat(apply-agent): Gemini fallback mapping with injected call"
```

---

### Task 7: Browser adapter (Playwright, fixture-driven)

**Files:**
- Create: `apply_agent/browser.py`
- Test: `apply_agent/tests/test_browser.py`

**Interfaces:**
- Consumes: `Field` (Task 4).
- Produces: async `open_form(context, url) -> Page`, `read_fields(page) -> list[Field]`, `fill_form(page, values, resume_path) -> None`, `submit_form(page) -> None`, `screenshot(page, path) -> None`. Tests drive these via Playwright route interception serving fixture HTML; no network.

- [ ] **Step 1: Write the failing test**

```python
# apply_agent/tests/test_browser.py
import pathlib, pytest
from playwright.async_api import async_playwright
from apply_agent.browser import read_fields, fill_form

FIX = pathlib.Path(__file__).parent / "fixtures" / "greenhouse_form.html"

async def _page():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    ctx = await browser.new_context()
    page = await ctx.new_page()
    await page.route("**/*", lambda route: route.fulfill(body=FIX.read_text(), content_type="text/html"))
    await page.goto("https://boards.greenhouse.io/acme/jobs/1")
    return pw, browser, page

@pytest.mark.asyncio
async def test_reads_named_inputs_from_the_form():
    pw, browser, page = await _page()
    try:
        names = {f.name for f in await read_fields(page)}
        assert {"first_name", "last_name", "email"} <= names
    finally:
        await browser.close(); await pw.stop()

@pytest.mark.asyncio
async def test_fill_sets_input_values():
    pw, browser, page = await _page()
    try:
        await fill_form(page, {"first_name": "Samiksha", "email": "me@x.com"}, resume_path=None)
        assert await page.input_value("[name=first_name]") == "Samiksha"
    finally:
        await browser.close(); await pw.stop()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apply_agent && playwright install chromium && pytest tests/test_browser.py -v`
Expected: FAIL — `ModuleNotFoundError: apply_agent.browser`.

- [ ] **Step 3: Write minimal implementation**

```python
# apply_agent/browser.py
from apply_agent.fieldmap import Field

async def open_form(context, url):
    page = await context.new_page()
    await page.goto(url, wait_until="domcontentloaded")
    return page

async def read_fields(page) -> list[Field]:
    handles = await page.query_selector_all("input, textarea, select")
    fields: list[Field] = []
    for h in handles:
        name = await h.get_attribute("name") or ""
        if not name or (await h.get_attribute("type")) in ("hidden", "submit", "button"):
            continue
        fields.append(Field(
            name=name,
            label=(await h.get_attribute("placeholder")) or (await h.get_attribute("aria-label")) or name,
            id=await h.get_attribute("id") or "",
            aria=await h.get_attribute("aria-label") or "",
            kind=(await h.get_attribute("type")) or (await h.evaluate("e => e.tagName.toLowerCase()")),
            required=(await h.get_attribute("required")) is not None,
        ))
    return fields

async def fill_form(page, values: dict, resume_path) -> None:
    for name, value in values.items():
        loc = page.locator(f"[name={name!r}]")
        if await loc.count():
            await loc.first.fill(str(value))
    if resume_path:
        up = page.locator("input[type=file]")
        if await up.count():
            await up.first.set_input_files(resume_path)

async def submit_form(page) -> None:
    await page.locator("button[type=submit], input[type=submit]").first.click()

async def screenshot(page, path: str) -> None:
    await page.screenshot(path=path, full_page=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apply_agent && pytest tests/test_browser.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apply_agent/browser.py apply_agent/tests/test_browser.py
git commit -m "feat(apply-agent): Playwright form read/fill over fixtures"
```

---

### Task 8: Decide node + graph wiring

**Files:**
- Create: `apply_agent/graph.py`
- Test: `apply_agent/tests/test_graph.py`

**Interfaces:**
- Consumes: `Mapping` (Task 4), `Settings` (Task 1), `has_captcha`/`is_confirmation` (Task 5).
- Produces: `decide(mapping, has_captcha, dry_run, threshold) -> str` returning one of `"submit"`, `"manual"`; and `verify_submit(html, is_confirmation) -> str` returning `"submitted"` or `"failed"` (unknown → `"failed"`). `build_graph(deps) -> CompiledGraph` wires nodes; `deps` injects browser/llm/db so the graph is testable without a live browser.

- [ ] **Step 1: Write the failing test**

```python
# apply_agent/tests/test_graph.py
from apply_agent.fieldmap import Mapping
from apply_agent.graph import decide, verify_submit

def test_decide_submits_only_when_confident_no_captcha_not_dry():
    good = Mapping(values={"email": "x"}, unmapped=[], confidence=0.9)
    assert decide(good, has_captcha=False, dry_run=False, threshold=0.85) == "submit"

def test_decide_routes_to_manual_when_below_threshold():
    weak = Mapping(values={}, unmapped=["q"], confidence=0.5)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apply_agent && pytest tests/test_graph.py -v`
Expected: FAIL — `ModuleNotFoundError: apply_agent.graph`.

- [ ] **Step 3: Write minimal implementation**

```python
# apply_agent/graph.py  (decision core; full StateGraph wiring below it)
def decide(mapping, has_captcha: bool, dry_run: bool, threshold: float) -> str:
    if dry_run or has_captcha or mapping.unmapped or mapping.confidence < threshold:
        return "manual"
    return "submit"

def verify_submit(html: str, is_confirmation) -> str:
    return "submitted" if is_confirmation(html) else "failed"
```

Then wire the LangGraph `StateGraph` with nodes `load_job → preflight → open_page → classify_form → map_fields → fill → check_blockers → decide → {submit | manual} → record → delay`, each calling the injected `deps` (browser/llm/db/guards). `decide` uses the function above; the `submit` node calls `verify_submit` and, on `"failed"`, records `failed` — never applied. Keep node bodies thin; the branch logic is already unit-tested above.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apply_agent && pytest tests/test_graph.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apply_agent/graph.py apply_agent/tests/test_graph.py
git commit -m "feat(apply-agent): confidence-gated decide node and graph wiring"
```

---

### Task 9: CLI entrypoint + tracker refresh

**Files:**
- Create: `apply_agent/__main__.py`
- Test: `apply_agent/tests/test_main.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `run(conn, settings, profile, deps, now) -> Summary` where `Summary` has `submitted: int, held: int, failed: int, skipped: int`; `main()` opens the real DB, builds real deps (Playwright + `gemini_call`), runs, then invokes `npm run track` via subprocess. `run` is what the test drives with fakes.

- [ ] **Step 1: Write the failing test**

```python
# apply_agent/tests/test_main.py
import sqlite3
from datetime import datetime, timezone
from apply_agent.config import Settings, Profile
from apply_agent.__main__ import run

def _conn():
    c = sqlite3.connect(":memory:"); c.row_factory = sqlite3.Row
    c.executescript(
        "CREATE TABLE jobs(id INTEGER PRIMARY KEY, fingerprint TEXT, company TEXT, title TEXT, url TEXT,"
        " ats_platform TEXT, resume_path TEXT, status TEXT, status_reason TEXT, submitted_at TEXT);"
        "CREATE TABLE applications(id INTEGER PRIMARY KEY, job_id INTEGER, company TEXT, title TEXT,"
        " applied_at TEXT, method TEXT, email_used TEXT, outcome TEXT DEFAULT 'awaiting');"
    )
    c.execute("INSERT INTO jobs(id,company,title,url,ats_platform,resume_path,status) "
              "VALUES(1,'Acme','DA','http://acme/apply','greenhouse','/r.pdf','tailored')")
    c.commit(); return c

def test_dry_run_holds_without_submitting():
    conn = _conn()
    s = Settings(dry_run=True, browser_enabled=True, confidence_threshold=0.85,
                 daily_cap=30, per_company_cap=3, min_delay=0, max_delay=0)
    prof = Profile("Samiksha Batra", "me@x.com", "999", "http://li/x")
    # deps fake a confident, captcha-free form
    deps = _fake_deps(confidence=0.95, captcha=False, confirmation=True)
    summary = run(conn, s, prof, deps, datetime(2026, 8, 16, tzinfo=timezone.utc))
    assert summary.submitted == 0 and summary.held == 1
    assert conn.execute("SELECT COUNT(*) n FROM applications").fetchone()["n"] == 0
```

Include a `_fake_deps(...)` helper in the test file returning an object whose browser/llm/guards methods are synchronous fakes matching the injected-deps contract (open→fields→fill→html), so no Playwright launches.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apply_agent && pytest tests/test_main.py -v`
Expected: FAIL — `ImportError: cannot import name 'run'`.

- [ ] **Step 3: Write minimal implementation**

```python
# apply_agent/__main__.py  (run loop; main() wiring below)
from dataclasses import dataclass
from apply_agent.db import queued_jobs, record_submitted, mark_status, count_applied_today
from apply_agent.guards import preflight
from apply_agent.graph import decide, verify_submit

@dataclass
class Summary:
    submitted: int = 0; held: int = 0; failed: int = 0; skipped: int = 0

def run(conn, settings, profile, deps, now) -> Summary:
    s = Summary(); submitted_this_run = 0
    for job in queued_jobs(conn):
        pre = preflight(conn, job, settings, submitted_this_run, now, deps.is_open)
        if not pre.allow:
            mark_status(conn, job.id, pre.status, pre.reason)
            setattr(s, {"held": "held", "deferred": "held", "skipped": "skipped"}.get(pre.status, "skipped"),
                    getattr(s, {"held": "held", "deferred": "held", "skipped": "skipped"}.get(pre.status, "skipped")) + 1)
            continue
        form = deps.open_and_map(job, profile)   # -> (mapping, html_before)
        route = decide(form.mapping, deps.has_captcha(form.html), settings.dry_run, settings.confidence_threshold)
        if route == "manual":
            deps.screenshot(job)
            mark_status(conn, job.id, "held", "manual queue: low confidence / captcha / dry-run")
            s.held += 1
            continue
        outcome = verify_submit(deps.submit_and_read(job), deps.is_confirmation)
        if outcome == "submitted":
            record_submitted(conn, job, profile.email); s.submitted += 1; submitted_this_run += 1
        else:
            mark_status(conn, job.id, "failed", "submit outcome uncertain"); s.failed += 1
        deps.delay()
    return s
```

`main()` (not unit-tested) opens `data/pipeline.db`, constructs real Playwright-backed deps and `gemini_call`, calls `run`, prints the summary, then `subprocess.run(["npm", "run", "track"], cwd=repo_root)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apply_agent && pytest tests/test_main.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apply_agent/__main__.py apply_agent/tests/test_main.py
git commit -m "feat(apply-agent): run loop, dry-run safety and tracker refresh"
```

---

### Task 10: Wire new config keys + docs

**Files:**
- Modify: `config/criteria.yaml` (add `submission.browser_enabled: false`, `submission.confidence_threshold: 0.85`)
- Modify: `README` / `package.json` scripts note (`apply` step usage)
- Test: `apply_agent/tests/test_config.py` (extend for the two keys read from the real file)

- [ ] **Step 1:** Add the failing assertion that `load_settings("config/criteria.yaml")` returns `browser_enabled is False` and `confidence_threshold == 0.85` from the real repo file.
- [ ] **Step 2:** Run it; it fails because the keys are absent.
- [ ] **Step 3:** Add the two keys under `submission:` in `config/criteria.yaml` (keep `dry_run: true`).
- [ ] **Step 4:** Run the test; it passes.
- [ ] **Step 5:** Commit.

```bash
git add config/criteria.yaml apply_agent/tests/test_config.py
git commit -m "feat(apply-agent): expose browser_enabled and confidence_threshold"
```

---

## Self-Review

**Spec coverage:** load/preflight/open/classify/map/fill/check/decide/submit/record/delay → Tasks 2,3,7,4,6,8,9. Guards, dry_run, caps, dedupe, liveness → Task 3. Heuristic-first + LLM fallback → Tasks 4,6. Captcha/confirmation + never-applied-on-uncertainty → Tasks 5,8,9. Fixture-based testing, no live employer → Tasks 4,7. Tracker refresh → Task 9. New config keys → Tasks 1,10. `classify_form` is folded into `open_and_map` (Task 9 deps) since v1 treats ATS and bespoke forms through the same read/fill path; the LinkedIn/redirect routing is out of scope v1 per the spec.

**Placeholder scan:** every code step carries real test + implementation code; no TBD/TODO.

**Type consistency:** `Field(name,label,id,aria,kind,required)`, `Mapping(values,unmapped,confidence)`, `Decision(allow,status,reason)`, `Job(...)`, `Summary(...)` used identically across tasks. `decide()` and `verify_submit()` signatures match Task 8 and Task 9 usage.

**Open follow-ups (not v1):** real Playwright end-to-end against a self-owned live form behind an env flag; a `careerpage` ATS-sniff for bespoke URLs; the top-level supervisor graph chaining Apply with the Resume-optimizer and Search agents.
