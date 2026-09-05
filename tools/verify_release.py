"""Run the complete local release gate with no third-party dependencies."""

from __future__ import annotations

import json
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
    portal_html = (ROOT / "portal/index.html").read_text(encoding="utf-8")
    announcement_html = (ROOT / "portal/announcement.html").read_text(encoding="utf-8")
    ui = (ROOT / "app/js/ui.js").read_text(encoding="utf-8")
    required_pages = ("home", "team", "allstar", "season", "sim", "result", "history", "achievements")
    missing_ids = [page for page in required_pages if f'id="{page}"' not in html]
    missing_routes = [route for route in ("#/team", "#/allstar", "#/season", "#/sim", "#/result", "#/history", "#/achievements") if route not in ui]
    if missing_ids or missing_routes:
        raise SystemExit(f"[FAIL] SPA smoke: missing ids={missing_ids}, routes={missing_routes}")
    if "compactAllStarState(STATE.allStar)" not in ui:
        raise SystemExit("[FAIL] All-Star history still risks duplicating avatar data")
    for marker in ("btn-quick", "每日挑战", "今日主题：", "function dailyChallenge", "../guessing/", "sister-link", "nav-home", "nav-rules", "theme-toggle", "navigation.css", "js/theme.js", "#/a?", "build_version", "data-tactic=\"stable\"", "result-achievements", "sideWins[side[0]] / gameCount", "storageHistory.pop()", "cachedRoster === requestedRoster", "normalizeAllStarState", "playerAvatarHtml", "sim-pause", "sim-skip-series", "picker-compare", "result-factors", "var best = bestVersionFor(p, pos);", "确认清空", "kpl2k_achievements_v1", "recordAchievementRun", "recordAchievementEvent", "reconcileAchievementHistory", "item.champ === true", "achievement-grid"):
        if marker not in html + ui + (ROOT / "app/data/manifest.json").read_text(encoding="utf-8"):
            raise SystemExit(f"[FAIL] v0.2 static marker missing: {marker}")
    if "0 / 18" not in html:
        raise SystemExit("[FAIL] achievement total is stale")
    for unsafe_avatar_handler in ("this.parentNode.textContent=&#39;", "this.outerHTML=&#39;<div class=&quot;pava&quot;"):
        if unsafe_avatar_handler in ui:
            raise SystemExit(f"[FAIL] unsafe player avatar fallback remains: {unsafe_avatar_handler}")
    if 'href="./announcement.html"' not in portal_html:
        raise SystemExit("[FAIL] portal announcement link missing")
    for marker in ("更新公告", "BGM 系统上线", "战力系统重新调整", "历年赛程已经补齐", "KPL Guessing 玩法补全"):
        if marker not in announcement_html:
            raise SystemExit(f"[FAIL] announcement page missing: {marker}")
    library_html = (ROOT / "app/player_library.html").read_text(encoding="utf-8")
    if "recordLibraryRead" not in library_html or "toggleCard" not in library_html:
        raise SystemExit("[FAIL] player library achievements missing")
    archive_html = (ROOT / "app/history_archive.html").read_text(encoding="utf-8")
    archive = json.loads((ROOT / "data/processed/historical_archive.json").read_text(encoding="utf-8"))
    player_meta = json.loads((ROOT / "data/processed/historical_player_meta.json").read_text(encoding="utf-8"))
    players = json.loads((ROOT / "data/processed/players.json").read_text(encoding="utf-8"))["players"]
    pid_by_name = {player["name"]: player["player_id"] for player in players}
    records = player_meta["records"]
    history_ok = (
        archive.get("season_count") == 5
        and archive.get("match_count") == 587
        and sum(season["match_count"] for season in archive.get("seasons", [])) == 587
        and archive.get("playable") is False
        and records[pid_by_name["一诺"]]["debut_year"] == 2018
        and records[pid_by_name["一诺"]]["championship_count"] == 7
        and records[pid_by_name["梦泪"]]["championship_count"] == 0
        and "history_archive.html" in html
        and "历年赛程" in archive_html
        and "为什么不能直接开赛" not in archive_html
    )
    if not history_ok:
        raise SystemExit("[FAIL] historical schedule archive contract failed")
    public_copy = "\n".join([
        html,
        ui,
        archive_html,
        library_html,
        (ROOT / "app/data/base.json").read_text(encoding="utf-8"),
        (ROOT / "data/narrative/templates.json").read_text(encoding="utf-8"),
    ])
    forbidden_strength_copy = [term for term in ("纸面阵容", "纸面实力", "纸面战力") if term in public_copy]
    if forbidden_strength_copy:
        raise SystemExit(f"[FAIL] forbidden public strength copy remains: {forbidden_strength_copy}")
    if (ROOT / "app/bgm.js").exists() or 'src="bgm.js"' in (ROOT / "app/bgm_demo.html").read_text(encoding="utf-8"):
        raise SystemExit("[FAIL] duplicate BGM source remains")
    print("SPA/storage/BGM/historical archive static checks passed.")


def main() -> None:
    python = sys.executable
    run("schedule audit", [python, "tools/audit_schedule.py"])
    run("rating validation", [python, "tools/validate_ratings.py"])
    run("player version validation", [python, "tools/validate_player_versions.py"])
    run("build consistency", [python, "tools/validate_build_consistency.py"])
    run("narrative validation", [python, "tools/validate_narrative.py"])
    for script in ("engine.js", "ui.js", "data.js", "narrative.js", "bgm.js"):
        run(f"syntax: {script}", ["node", "--check", f"app/js/{script}"])
    run("historical archive syntax", ["node", "tools/verify_history_archive.js"])
    run("daily challenge presets", ["node", "tools/verify_daily_challenge.js"])
    run("achievement regression", ["node", "tools/verify_achievements.js"])
    run("29-season engine matrix", ["node", "tools/verify_engine.js"])
    static_checks()
    print("\nRelease verification passed.")


if __name__ == "__main__":
    main()
