"""KPL 2K 评分校准验证 v0

标准：每个赛季的真实冠军战队，其首发阵容（按 battle 出场数取前 5，而非战力前 5）
平均战力应排在联盟前列。battle 未覆盖的赛季不参与校验（归属未修正，结果不可信）。

用法：
  python tools/validate_ratings.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"


def load(name: str) -> dict:
    return json.loads((PROC / name).read_text(encoding="utf-8"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--detail", action="store_true", help="打印冠军排名偏低赛季的阵容构成")
    args = ap.parse_args()

    seasons = load("seasons.json")["seasons"]
    stats = load("player_season_stats.json")["records"]
    players = {p["player_id"]: p["name"] for p in load("players.json")["players"]}
    attr = load("player_attribution.json").get("records", [])
    covered = {r["season_id"] for r in attr}
    # (season, franchise) -> {player_name: battle_games}
    starters_pool: dict[tuple[str, str], dict[str, int]] = {}
    for r in attr:
        key = (r["season_id"], r["team_franchise"])
        if key[1]:
            starters_pool.setdefault(key, {})[r["player_name"]] = max(
                starters_pool.get(key, {}).get(r["player_name"], 0), r["games"]
            )
    # player_name -> rating (取该赛季记录)
    stat_by_key = {
        (r["season_id"], players.get(r["player_id"], "")): r
        for r in stats if r["rating"] is not None
    }
    franchises = {f["franchise_id"]: f for f in load("franchises.json")["franchises"]}

    def team_name(fid: str) -> str:
        f = franchises.get(fid)
        if not f:
            return fid
        nbs = f.get("names_by_season") or {}
        return nbs[sorted(nbs, reverse=True)[0]] if nbs else (f.get("current_names") or [fid])[0]

    ranks = []
    for s in seasons:
        if not s.get("is_battlefield"):
            continue
        if s["season_id"] not in covered:
            continue  # battle 未覆盖，归属未修正，跳过
        champ = s.get("champion_franchise")
        season_pool = {
            (sid, fid): names for (sid, fid), names in starters_pool.items() if sid == s["season_id"]
        }
        teams = {}
        team_starters: dict[str, list[tuple[str, float]]] = {}
        for (sid, fid), names in season_pool.items():
            starters = sorted(names, key=names.get, reverse=True)[:5]
            ratings = [stat_by_key.get((s["season_id"], n), {}).get("rating") for n in starters]
            ratings = [r for r in ratings if r]
            team_starters[fid] = [(n, stat_by_key.get((s["season_id"], n), {}).get("rating")) for n in starters]
            if len(ratings) >= 4:  # 少于 4 名有效首发不参与（避免 3 人平均虚高）
                teams[fid] = sum(ratings) / len(ratings)
        if not champ or champ not in teams or len(teams) < 4:
            continue
        order = sorted(teams, key=lambda f: -teams[f])
        rank = order.index(champ) + 1
        ranks.append((s["season_id"], rank, len(order)))
        print(f"  {s['season_id']}: 冠军阵容排名第 {rank}/{len(order)}")
        if rank > 3 and args.detail:
            print(f"    冠军（{team_name(champ)}）：")
            for n, r in team_starters.get(champ, []):
                print(f"      {n} 战力={r}")
            for fid in order[:3]:
                print(f"    TOP{order.index(fid) + 1}（{team_name(fid)}，均值 {teams[fid]:.1f}）：")
                for n, r in team_starters.get(fid, []):
                    print(f"      {n} 战力={r}")
    top3 = sum(1 for _, r, _ in ranks if r <= 3)
    print(f"冠军阵容排名验证（battle 已覆盖的 {len(ranks)} 个赛季）：{top3}/{len(ranks)} 进前三")


if __name__ == "__main__":
    main()
