"""Run the complete local release gate with no third-party dependencies."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(label: str, command: list[str]) -> None:
    print(f"\n===== {label} =====")
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode:
        raise SystemExit(f"[FAIL] {label}: exit {result.returncode}")


def static_checks() -> None:
    html = (ROOT / "app/index.html").read_text(encoding="utf-8")
    ui = (ROOT / "app/js/ui.js").read_text(encoding="utf-8")
    required_pages = ("home", "team", "allstar", "season", "sim", "result", "history")
    missing_ids = [page for page in required_pages if f'id="{page}"' not in html]
    missing_routes = [route for route in ("#/team", "#/allstar", "#/season", "#/sim", "#/result", "#/history") if route not in ui]
    if missing_ids or missing_routes:
        raise SystemExit(f"[FAIL] SPA smoke: missing ids={missing_ids}, routes={missing_routes}")
    if "compactAllStarState(STATE.allStar)" not in ui:
        raise SystemExit("[FAIL] All-Star history still risks duplicating avatar data")
    for marker in ("btn-quick", "#/a?", "build_version", "data-tactic=\"stable\"", "result-achievements", "sideWins[side[0]] / gameCount", "storageHistory.pop()", "cachedRoster === requestedRoster"):
        if marker not in html + ui + (ROOT / "app/data/manifest.json").read_text(encoding="utf-8"):
            raise SystemExit(f"[FAIL] v0.2 static marker missing: {marker}")
    if (ROOT / "app/bgm.js").exists() or 'src="bgm.js"' in (ROOT / "app/bgm_demo.html").read_text(encoding="utf-8"):
        raise SystemExit("[FAIL] duplicate BGM source remains")
    print("SPA/storage/BGM static checks passed.")


def main() -> None:
    python = sys.executable
    run("schedule audit", [python, "tools/audit_schedule.py"])
    run("rating validation", [python, "tools/validate_ratings.py"])
    run("player version validation", [python, "tools/validate_player_versions.py"])
    run("build consistency", [python, "tools/validate_build_consistency.py"])
    run("narrative validation", [python, "tools/validate_narrative.py"])
    for script in ("engine.js", "ui.js", "data.js", "narrative.js", "bgm.js"):
        run(f"syntax: {script}", ["node", "--check", f"app/js/{script}"])
    run("29-season engine matrix", ["node", "tools/verify_engine.js"])
    static_checks()
    print("\nRelease verification passed.")


if __name__ == "__main__":
    main()
