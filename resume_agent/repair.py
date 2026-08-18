"""Turn a fabrication-gate rejection into a concrete repair directive.

`verifyNoFabrication` (TS) reports each offending bullet as one of:
  - "<bullet> (invented names: X, Y)"   -> the model added terms not in the resume
  - "<bullet> (invented figures: N)"    -> the model added a number not in the source
  - "<bullet>"  (no parenthetical)      -> the bullet drifted too far (jaccard floor)

`repair_hint` groups those into a single instruction the next tailor attempt
can act on, without ever loosening the gate itself.
"""
import re

_NAMES = re.compile(r"\(invented names: ([^)]*)\)")
_FIGS = re.compile(r"\(invented figures: ([^)]*)\)")


def repair_hint(offending: list[str]) -> str:
    if not offending:
        return ""

    names: set[str] = set()
    figures: set[str] = set()
    rewords: list[str] = []

    for item in offending:
        m_names = _NAMES.search(item)
        m_figs = _FIGS.search(item)
        if m_names:
            names.update(s.strip() for s in m_names.group(1).split(",") if s.strip())
        elif m_figs:
            figures.update(s.strip() for s in m_figs.group(1).split(",") if s.strip())
        else:
            rewords.append(item.strip())

    parts: list[str] = []
    if names:
        parts.append(
            "Remove these terms — they are not present in the candidate's resume: "
            + ", ".join(sorted(names))
            + "."
        )
    if figures:
        parts.append(
            "Do not use these numbers — they are not in the source bullets: "
            + ", ".join(sorted(figures))
            + "."
        )
    if rewords:
        parts.append(
            "These bullets were reworded too far from their source; restate each much "
            "closer to the original wording, changing only what surfaces a job keyword: "
            + " | ".join(rewords)
        )
    return "\n".join(parts)
