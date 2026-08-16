# apply_agent/fieldmap.py
from dataclasses import dataclass


@dataclass
class Field:
    name: str
    label: str
    id: str
    aria: str
    kind: str
    required: bool = False


@dataclass
class Mapping:
    values: dict
    unmapped: list
    confidence: float


_PATTERNS = {
    "first": ("first",),
    "last": ("last", "surname"),
    "email": ("email", "e-mail"),
    "phone": ("phone", "mobile", "contact number"),
    "linkedin": ("linkedin",),
    "full_name": ("full name", "your name"),
}


def _hay(f: Field) -> str:
    return " ".join([f.name, f.label, f.id, f.aria]).lower()


def map_fields(fields, profile) -> Mapping:
    first, *rest = profile.name.split()
    last = " ".join(rest) or first
    supply = {
        "first": first,
        "last": last,
        "full_name": profile.name,
        "email": profile.email,
        "phone": profile.phone,
        "linkedin": profile.linkedin,
    }
    values, unmapped, matched = {}, [], 0
    for f in fields:
        hay = _hay(f)
        hit = next((k for k, pats in _PATTERNS.items() if any(p in hay for p in pats)), None)
        if hit and supply.get(hit):
            values[f.name] = supply[hit]
            matched += 1
        elif f.required:
            unmapped.append(f.name)
    total = len(fields) or 1
    confidence = matched / total
    return Mapping(values, unmapped, confidence)


def merge_llm_mapping(mapping: Mapping, fields, extra: dict) -> Mapping:
    """Fold an LLM `map_unmapped` result back into a heuristic `Mapping`.

    Merges `extra` into `mapping.values`, drops the now-filled names from
    `mapping.unmapped`, and RECOMPUTES `mapping.confidence` as the share of
    fields that now carry a value: `filled / total`, capped at 1.0. Without
    this re-blend a form the heuristic scored 0.4 stays 0.4 even after the LLM
    maps every field, so `decide` would route a fully-mapped form to manual
    and defeat the fallback. Mutates and returns `mapping`.
    """
    mapping.values.update(extra)
    mapping.unmapped = [name for name in mapping.unmapped if name not in extra]
    total = len(fields) or 1
    filled = sum(1 for f in fields if f.name in mapping.values)
    mapping.confidence = min(1.0, filled / total)
    return mapping
