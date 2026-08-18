"""Invoke the TS `tailor-once` CLI for one job and parse its JSON result.

This is the single seam to the TypeScript tailor+verify+render. Keeping it
here (behind an injectable callable) lets the run loop be tested with a fake,
while the real path shells out to `npm run tailor-once`.
"""
import json
import subprocess
import tempfile
from pathlib import Path


def run_tailor_once(job_id: int, hint: str, cwd: str) -> dict:
    """Run one tailor+verify pass for `job_id`, passing `hint` as a repair file
    when non-empty. Returns the parsed {ok, offending, resumePath?} object."""
    args = ["npm", "run", "--silent", "tailor-once", "--", str(job_id)]
    hint_path = None
    try:
        if hint:
            fh = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8")
            fh.write(hint)
            fh.close()
            hint_path = fh.name
            args += ["--repair", hint_path]

        proc = subprocess.run(
            args, cwd=cwd, capture_output=True, text=True, shell=True, check=True,
        )
        # tailor-once prints exactly one JSON line to stdout; take the last
        # non-empty line in case npm prepends anything.
        line = [ln for ln in proc.stdout.splitlines() if ln.strip()][-1]
        return json.loads(line)
    finally:
        if hint_path:
            Path(hint_path).unlink(missing_ok=True)
