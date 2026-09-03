"""Verify home toolbar placement and built player portrait coverage."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def verify_icon_set(base: Path) -> tuple[int, int]:
    players = json.loads((base / "data" / "base.json").read_text(encoding="utf-8"))["players"]
    blank = [player["name"] for player in players.values() if not player.get("icon")]
    remote = [player["name"] for player in players.values() if str(player.get("icon", "")).startswith(("http://", "https://"))]
    missing = [
        player["name"]
        for player in players.values()
        if player.get("icon") and not (base / player["icon"]).is_file()
    ]
    if blank or remote or missing:
        raise SystemExit(f"[FAIL] portraits blank={blank[:5]} remote={remote[:5]} missing={missing[:5]}")
    return len(players), len({player["icon"] for player in players.values()})


def main() -> None:
    html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
    row = html.index('class="home-bgm-row"')
    link = html.index('class="home-guessing-link"')
    volume = html.index('id="bgm-toggle-home"')
    if not row < link < volume or "sister-game-link" in html:
        raise SystemExit("[FAIL] Guessing link is not beside the home volume control")

    source_count, source_unique = verify_icon_set(ROOT / "app")
    dist = ROOT / "dist" / "kpl2k"
    if dist.exists():
        dist_count, dist_unique = verify_icon_set(dist)
        if (source_count, source_unique) != (dist_count, dist_unique):
            raise SystemExit("[FAIL] dist portrait set differs from app")
    print(f"Player portraits passed: {source_count}/{source_count} players, {source_unique} local assets.")


if __name__ == "__main__":
    main()
