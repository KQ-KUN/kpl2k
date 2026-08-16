"""KPL 2K 选手组合胜率构建 v1

从 data/raw/battles 的逐局数据统计"同队同赛季任意两人组合共同出场的胜率"，
产出 data/processed/pair_win.json，供 chemistry.py 计算风格/默契分。

核心思想：两个高战力选手组队却胜率低 → 负化学，风格分扣分。
胜率以偏离 50% 的幅度 + 样本量加权，正胜率加分、负胜率减分。

用法：
  python tools/build_pair_win.py
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "battles"
PROC = ROOT / "data" / "processed"
OUT = PROC / "pair_win.json"


def load(name: str) -> dict:
    return json.loads((PROC / name).read_text(encoding="utf-8"))


def main() -> None:
    league_to_season = {
        s["league_id"]: s["season_id"]
        for s in load("seasons.json")["seasons"]
    }
    # (season, team, player) -> Counter(games, wins)
    player_win: dict[tuple[str, str, str], dict[str, int]] = defaultdict(lambda: {"games": 0, "wins": 0})
    # (season, team, frozenset(pair)) -> Counter(games, wins)
    pair_win: dict[tuple[str, str, frozenset], dict[str, int]] = defaultdict(lambda: {"games": 0, "wins": 0})

    files = sorted(RAW.glob("*.json"))
    for path in files:
        league_id = path.stem.split("_")[0]
        season_id = league_to_season.get(league_id)
        if not season_id:
            continue
        obj = json.loads(path.read_text(encoding="utf-8"))
        data = obj.get("data") or {}
        c1, c2 = data.get("camp1") or {}, data.get("camp2") or {}
        winner = c1.get("team_id") if c1.get("is_win") else c2.get("team_id")
        by_team: dict[str, list[str]] = defaultdict(list)
        for p in data.get("battle_player_list") or []:
            name = p.get("player_name")
            tid = p.get("team_id")
            if name and tid:
                by_team[tid].append(name)
        for tid, names in by_team.items():
            for nm in names:
                key = (season_id, tid, nm)
                player_win[key]["games"] += 1
                player_win[key]["wins"] += 1 if tid == winner else 0
            for i in range(len(names)):
                for j in range(i + 1, len(names)):
                    pair = frozenset({names[i], names[j]})
                    key = (season_id, tid, pair)
                    pair_win[key]["games"] += 1
                    pair_win[key]["wins"] += 1 if tid == winner else 0

    # 序列化为可 JSON 化的结构
    players_out: dict[str, dict] = {}
    for (season, team, name), c in player_win.items():
        k = f"{season}|{team}|{name}"
        players_out[k] = {"games": c["games"], "wins": c["wins"]}
    pairs_out: dict[str, dict] = {}
    for (season, team, pair), c in pair_win.items():
        names = sorted(pair)
        k = f"{season}|{team}|{names[0]}|{names[1]}"
        pairs_out[k] = {"games": c["games"], "wins": c["wins"]}

    (OUT).write_text(json.dumps({
        "schema_version": "0.1",
        "data_version": "2026-08-16",
        "player_win": players_out,
        "pair_win": pairs_out,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"pair_win 已生成：{OUT}")
    print(f"  选手-赛季-队 记录：{len(players_out)}，组合记录：{len(pairs_out)}")


if __name__ == "__main__":
    main()
