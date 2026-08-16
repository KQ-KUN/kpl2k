"""KPL 2K 选手版本查询

版本 = (选手, 赛季, 位置) 的一张卡：同一选手在不同赛季有不同战力与位置，
例如 "2019·小胖(打野)" 与 "2025·小胖(打野)"、无畏的打野版/辅助版。

用法：
  python tools/player_versions.py --name 小胖
  python tools/player_versions.py --team 10001            # 列某俱乐部全历史版本
  python tools/player_versions.py --peak 10001            # 每选手只列巅峰版本
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

PROC = Path(__file__).resolve().parent.parent / "data" / "processed"
OVERRIDES = Path(__file__).resolve().parent.parent / "data" / "overrides" / "player_versions.json"


def load(name: str) -> dict:
    return json.loads((PROC / name).read_text(encoding="utf-8"))


def apply_overrides(rows: list[dict]) -> list[dict]:
    if not OVERRIDES.exists():
        return rows
    pos = json.loads(OVERRIDES.read_text(encoding="utf-8")).get("positions", {})
    for r in rows:
        override = pos.get(r["player_id"], {}).get(r["season_id"])
        if override:
            r["position"] = override
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="选手版本查询")
    ap.add_argument("--name", help="按选手名关键字筛选")
    ap.add_argument("--team", help="按俱乐部 franchise_id 筛选")
    ap.add_argument("--season", help="只显示指定赛季（支持简写如 2023S1）")
    ap.add_argument("--peak", action="store_true", help="只显示每位选手的巅峰版本")
    args = ap.parse_args()

    recs = load("player_season_stats.json")["records"]
    players = {p["player_id"]: p for p in load("players.json")["players"]}

    rows = []
    for r in recs:
        if (r["games"] or 0) < 5:
            continue
        if args.team and r["team_franchise"] != args.team:
            continue
        if args.season:
            candidates = [args.season]
            if not args.season.startswith(("KPL", "KCC", "L")):
                candidates.append(f"KPL{args.season}")
            if r["season_id"] not in candidates:
                continue
        if args.name and args.name not in (players.get(r["player_id"], {}).get("name") or ""):
            continue
        rows.append(r)

    rows = apply_overrides(rows)

    if args.peak:
        best: dict[str, dict] = {}
        for r in rows:
            cur = best.get(r["player_id"])
            if cur is None or r["rating"] > cur["rating"]:
                best[r["player_id"]] = r
        rows = list(best.values())

    rows.sort(key=lambda r: (-(r["rating"] or 0), r["season_id"]))
    print(f"共 {len(rows)} 个版本" + ("（仅巅峰）" if args.peak else ""))
    for r in rows:
        nm = players.get(r["player_id"], {}).get("name") or r["player_id"][:8]
        season = r["season_id"].replace("KPL", "").replace("KCC", "KCC")
        print(f"  {nm:<8} {season:<10} {r['position']:<4} 战力={r['rating']:<6} 场次={r['games']:<4} 队={r['team_franchise']} pid={r['player_id'][:8]}")


if __name__ == "__main__":
    main()
