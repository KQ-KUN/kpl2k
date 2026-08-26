"""Validate historical roles and current roster calibration in built web data."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEAM_DIR = ROOT / "app" / "data" / "teams"


def load_team(team_id: str) -> dict:
    return json.loads((TEAM_DIR / f"{team_id}.json").read_text(encoding="utf-8"))


def player(team: dict, name: str) -> dict:
    match = next((item for item in team["players"] if item["name"] == name), None)
    if not match:
        raise SystemExit(f"[FAIL] missing player: {name}")
    return match


def main() -> None:
    ag = load_team("10027")
    six = player(ag, "六点六")
    if not any(v["year"] == 2020 and v["position"] == "对抗路" for v in six["versions"]):
        raise SystemExit("[FAIL] 六点六 missing 2020 top-lane version")

    aze = player(ag, "啊泽")
    if not all(v["position"] == "对抗路" for v in aze["versions"]):
        raise SystemExit("[FAIL] 啊泽 AG versions are not top lane")

    for path in TEAM_DIR.glob("*.json"):
        team = json.loads(path.read_text(encoding="utf-8"))
        for item in team.get("players", []):
            expected = sorted({v["position"] for v in item.get("versions", [])})
            if item.get("positions") != expected:
                raise SystemExit(f"[FAIL] {item['name']} role union mismatch in {path.name}")

    jdg = load_team("10020")
    floors = {"光明": 82, "无双": 80, "小寒": 80, "无畏": 82, "清融": 90}
    for name, floor in floors.items():
        current = max((v["rating"] for v in player(jdg, name)["versions"] if v["year"] == 2026), default=0)
        if current < floor:
            raise SystemExit(f"[FAIL] JDG {name} current rating {current} < {floor}")

    print("Historical roles, role unions, and current JDG calibration passed.")


if __name__ == "__main__":
    main()
