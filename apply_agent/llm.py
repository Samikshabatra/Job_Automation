# apply_agent/llm.py
import json


def map_unmapped(fields, profile, call) -> dict:
    """Ask an injected LLM `call` to map otherwise-unmapped fields to values.

    `call(prompt: str) -> str` is injected so tests never touch a real LLM
    SDK. Any failure to get usable JSON back (empty output, non-JSON,
    unexpected shape) yields {} rather than raising.
    """
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
    except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
        return {}
