"""KPL 2K 选手归属构建 v0

扫描 data/raw/battles 的逐局阵容，按"选手-赛季"投票出：
- team_franchise：该赛季真实俱乐部（多数票）
- position：该赛季位置（多数票）
- heroes：英雄池（去重）

产出 data/processed/player_attribution.json，供 clean_kpl.py 修正污染数据。

用法：
  python tools/build_attribution.py
"""

from __future__ import annotations

import json
from collections import defaultdict, Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
BATTLE_DIR = RAW / "battles"

# The official battle feed leaves this player's name and position blank in
# every AG game from his tenure. The remaining row (team, hero and stats) is
# complete, so recover the identity at the narrowest reliable boundary.
MISSING_PLAYER_BY_SEASON_TEAM = {
    ("L20190004", "10027"): ("六点六", "对抗路"),
    ("L20200001", "10027"): ("六点六", "对抗路"),
    ("L20200003", "10027"): ("六点六", "对抗路"),
    ("KPL2020S2", "10027"): ("六点六", "对抗路"),
}


def load(name: str) -> dict:
    return json.loads((PROC / name).read_text(encoding="utf-8"))


def main() -> None:
    league_to_season = {
        s["league_id"]: s["season_id"]
        for s in load("seasons.json")["seasons"]
    }
    votes: dict[tuple[str, str], Counter] = defaultdict(Counter)
    heroes: dict[tuple[str, str], set[str]] = defaultdict(set)
    games: Counter = Counter()
    sums: dict[tuple[str, str], dict[str, float]] = defaultdict(lambda: defaultdict(float))
    mvp: Counter = Counter()
    duration_sum: dict[tuple[str, str], float] = defaultdict(float)
    if not BATTLE_DIR.exists():
        print("data/raw/battles 不存在，先运行 tools/crawl_battles.py")
        return
    for path in BATTLE_DIR.glob("*.json"):
        league_id = path.stem.split("_")[0]
        season_id = league_to_season.get(league_id)
        if not season_id:
            continue
        obj = json.loads(path.read_text(encoding="utf-8"))
        data = obj.get("data") or {}
        duration_min = (data.get("game_duration") or 0) / 60000.0
        seen_in_battle: set[str] = set()
        for p in data.get("battle_player_list") or []:
            name = p.get("player_name")
            recovered = MISSING_PLAYER_BY_SEASON_TEAM.get((season_id, p.get("team_id")))
            if not name and recovered:
                name = recovered[0]
            if not name:
                continue
            seen_in_battle.add(name)
            key = (season_id, name)
            if p.get("team_id"):
                votes[key]["team"] = p["team_id"]
            position = p.get("position_desc") or (recovered[1] if recovered else None)
            if position:
                votes[key]["position"] = position
            if p.get("hero_name"):
                heroes[key].add(p["hero_name"])
            for field in ("kill_num", "death_num", "assist_num", "gold", "hurt_to_hero_total",
                          "participation_rate", "hurt_to_hero_total_rate", "be_hurt_by_hero_total_rate"):
                v = p.get(field)
                if isinstance(v, (int, float)):
                    sums[key][field] += v
            if p.get("is_mvp"):
                mvp[key] += 1
            duration_sum[key] += duration_min
        for name in seen_in_battle:
            games[(season_id, name)] += 1

    records = []
    for (season_id, name), c in sorted(votes.items()):
        s = sums[(season_id, name)]
        dur = duration_sum[(season_id, name)]
        games_n = games[(season_id, name)]
        deaths = s.get("death_num", 0) or 0
        records.append({
            "season_id": season_id,
            "player_name": name,
            "team_franchise": c.get("team"),
            "position": c.get("position"),
            "games": games_n,
            "heroes": sorted(heroes.get((season_id, name), set())),
            "mvp_count": mvp[(season_id, name)],
            "avg_kill_num": round(s.get("kill_num", 0) / games_n, 3) if games_n else None,
            "avg_death_num": round(s.get("death_num", 0) / games_n, 3) if games_n else None,
            "avg_assist_num": round(s.get("assist_num", 0) / games_n, 3) if games_n else None,
            "avg_kda": round((s.get("kill_num", 0) + s.get("assist_num", 0)) / deaths, 3) if deaths else None,
            "avg_gpm": round(s.get("gold", 0) / dur, 1) if dur else None,
            "avg_dpm": round(s.get("hurt_to_hero_total", 0) / dur, 1) if dur else None,
            "avg_participation_rate": round(s.get("participation_rate", 0) / games_n, 2) if games_n else None,
            "avg_hurt_rate": round(s.get("hurt_to_hero_total_rate", 0) / games_n, 4) if games_n else None,
            "avg_be_hurt_rate": round(s.get("be_hurt_by_hero_total_rate", 0) / games_n, 4) if games_n else None,
        })
    (PROC / "player_attribution.json").write_text(
        json.dumps({
            "schema_version": "0.1",
            "data_version": "2026-08-15",
            "records": records,
        }, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"attribution records: {len(records)}")
    for season, rows in sorted(
        ((s, [r for r in records if r["season_id"] == s]) for s in {r["season_id"] for r in records}),
        key=lambda kv: kv[0],
    ):
        print(f"  {season}: {len(rows)} 名选手")


if __name__ == "__main__":
    main()
