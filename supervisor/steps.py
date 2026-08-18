"""Real step runners for the supervisor: each shells out to an existing
pipeline entrypoint so no wiring is duplicated. Untested by design (they
launch npm/Playwright/Gemini); the graph's routing is tested with a fake.
"""
import subprocess
import sqlite3
import sys

import yaml

from supervisor.routing import has_fabrication_failures


class RealSteps:
    def __init__(self, cwd: str):
        self.cwd = cwd

    def _sh(self, cmd: str) -> dict:
        proc = subprocess.run(cmd, cwd=self.cwd, shell=True, capture_output=True, text=True)
        tail = [ln for ln in (proc.stdout or "").splitlines() if ln.strip()][-3:]
        return {"returncode": proc.returncode, "tail": tail}

    def _py(self, module: str) -> dict:
        # sys.executable, not a bare "python", so the venv interpreter is used.
        proc = subprocess.run([sys.executable, "-m", module], cwd=self.cwd,
                              capture_output=True, text=True)
        tail = [ln for ln in (proc.stdout or "").splitlines() if ln.strip()][-3:]
        return {"returncode": proc.returncode, "tail": tail}

    def run_daily(self) -> dict:
        return self._sh("npm run daily")

    def run_optimize(self) -> dict:
        return self._py("resume_agent")

    def run_apply(self) -> dict:
        return self._py("apply_agent")

    def has_failures(self) -> bool:
        conn = sqlite3.connect("data/pipeline.db")
        conn.row_factory = sqlite3.Row
        try:
            return has_fabrication_failures(conn)
        finally:
            conn.close()

    def browser_enabled(self) -> bool:
        criteria = yaml.safe_load(open("config/criteria.yaml", encoding="utf-8")) or {}
        return bool((criteria.get("submission") or {}).get("browser_enabled", False))
