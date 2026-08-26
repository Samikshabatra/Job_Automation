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

    @property
    def key(self) -> str:
        """Stable identity for this field across mapping and filling.

        `name` when the form supplies one, else `id`. Modern Greenhouse (and
        React-rendered forms generally) put identity in `id`/`aria-label` and
        omit `name` entirely -- a live PhonePe posting had 2 of 50 fields
        named -- so keying on `name` alone collapsed every such field onto the
        empty string and filled nothing. `fill_form` resolves this back to a
        locator by trying `[name=...]` first, then `[id=...]`.
        """
        return self.name or self.id


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
    # A bare "name" is last on purpose. Dict order IS match order, so "first"
    # and "last" claim first_name/last_name before this rule can, and only a
    # field whose identity is nothing more specific than "name" falls through
    # to the full name. Ashby calls that field `_systemfield_name`, which
    # matches none of the phrases above.
    "full_name": ("full name", "your name", "name"),
}

# Fields whose identity contains "name" but which are not the candidate's own
# name. Answering these from the profile would submit a confidently wrong
# answer, which is worse than leaving a required field for a human.
_NOT_MY_NAME = ("company", "employer", "referr", "referen", "school", "college",
                "university", "manager", "user", "file", "preferred pronoun")


# Inputs that carry no text value the mapping is responsible for: a file input
# is uploaded out-of-band by fill_form, and hidden/submit/button inputs are not
# filled at all. They must not count toward the confidence denominator, or a
# cleanly-fillable form scores (n)/(n+1) and never clears the auto-submit
# threshold. (read_fields already skips hidden/submit/button upstream; excluding
# them here too is defensive and keeps the denominator honest.)
_UNCOUNTED_KINDS = frozenset({"file", "hidden", "submit", "button"})

# Fields that take a CHOICE, not a typed value. A profile value must never be
# written into one: a live Notion form asks "How did you hear about us?" as a
# checkbox list whose options include "LinkedIn" and "Email", and matching
# those against the contact patterns typed the candidate's profile URL into a
# tick box. Ticking the wrong box is worse than leaving it blank -- a blank
# forces manual review, a wrong answer gets submitted.
#
# They still COUNT, and a required one still reaches `unmapped`: they are real
# questions that genuinely need an answer, and hiding them from the gate would
# let a form auto-submit with its consent box untouched.
_CHOICE_KINDS = frozenset({"checkbox", "radio"})


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
    values, unmapped, matched, countable = {}, [], 0, 0
    for f in fields:
        if f.kind in _UNCOUNTED_KINDS:
            continue  # not part of the value mapping; see _UNCOUNTED_KINDS
        countable += 1
        if f.kind in _CHOICE_KINDS:
            # Counted, never filled. See _CHOICE_KINDS.
            if f.required:
                unmapped.append(f.key)
            continue
        hay = _hay(f)
        hit = next((k for k, pats in _PATTERNS.items() if any(p in hay for p in pats)), None)
        # Guard the bare-"name" rule only. The explicit phrases are unambiguous;
        # it is the fallback that can wander onto someone else's name.
        if hit == "full_name" and any(w in hay for w in _NOT_MY_NAME):
            hit = None
        if hit and supply.get(hit):
            values[f.key] = supply[hit]
            matched += 1
        elif f.required:
            unmapped.append(f.key)
    confidence = matched / (countable or 1)
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
    countable = [f for f in fields if f.kind not in _UNCOUNTED_KINDS]
    total = len(countable) or 1
    filled = sum(1 for f in countable if f.key in mapping.values)
    mapping.confidence = min(1.0, filled / total)
    return mapping
