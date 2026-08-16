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
