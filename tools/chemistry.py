"""KPL 2K 阵容化学反应 v0

让"不同阵容 → 不同胜率"成立的三层机制（在个人评分之上）：
1. 位置覆盖：五位置齐全 +2，缺位扣分（已有）
2. 老搭档默契：同队同赛季长期首发的选手有真实默契，数据挖掘得到
3. 打法风格适配：大核数量过多（抢资源）或全队无核都会扣分

产出：lineup_strength() -> (有效强度, 拆解{base, coverage, synergy, style})

用法（演示拆解）：
  python tools/chemistry.py --team 10001 --season KPL2021S2
"""

from __future__ import annotations

import argparse
import bisect
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"

POSITIONS = ["对抗路", "打野", "中路", "发育路", "游走"]
CARRY_POSITIONS = {"发育路", "中路", "打野"}
SYNERGY_CAP = 4.0      # 老搭档加成上限（分）
SYNERGY_SCALE = 0.8    # 每单位默契权重
PAIR_WIN_MIN = 10      # 组合样本下限：少于该场次不参与胜率化学
PAIR_WIN_WEIGHT = 6.0  # 组合胜率偏离 50% 的换算系数（满分 ±3）
STYLE_PENALTY = 1.5    # 每个超出上限的大核扣分


def load(name: str) -> dict:
    return json.loads((PROC / name).read_text(encoding="utf-8"))


_CACHE: dict[str, dict] = {}


def load_cached(name: str) -> dict:
    if name not in _CACHE:
        _CACHE[name] = load(name)
    return _CACHE[name]


def _pct(sorted_vals: list[float], v: float) -> float:
    if not sorted_vals:
        return 0.5
    return bisect.bisect_right(sorted_vals, v) / len(sorted_vals)


def build_style_tags(records: list[dict]) -> dict[tuple[str, str], str]:
    """按位置分桶计算分均经济/助攻的百分位，给选手-赛季打风格标签。"""
    by_pos: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        if r["position"] in POSITIONS and (r["games"] or 0) >= 5:
            by_pos[r["position"]].append(r)
    tags: dict[tuple[str, str], str] = {}
    for pos, lst in by_pos.items():
        gpm_sorted = sorted(x["avg_gpm"] or 0 for x in lst)
        assist_sorted = sorted(x["avg_assist_num"] or 0 for x in lst)
        for r in lst:
            gpm_pct = _pct(gpm_sorted, r["avg_gpm"] or 0)
            assist_pct = _pct(assist_sorted, r["avg_assist_num"] or 0)
            if pos in CARRY_POSITIONS:
                tag = "大核" if gpm_pct >= 0.66 else ("节奏" if assist_pct >= 0.66 else "平衡")
            else:
                tag = "开团" if assist_pct >= 0.66 else "平衡"
            tags[(r["player_id"], r["season_id"])] = tag
    return tags


def build_pair_table(records: list[dict]) -> dict[tuple[str, str], dict[frozenset, float]]:
    """同队同赛季出场>=10 的选手两两成对，权重 = min(出场)/30，封顶 1。"""
    by_team: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in records:
        if (r["games"] or 0) >= 10:
            by_team[(r["season_id"], r["team_franchise"])].append(r)
    table: dict[tuple[str, str], dict[frozenset, float]] = {}
    for key, lst in by_team.items():
        pairs: dict[frozenset, float] = {}
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                w = min(lst[i]["games"], lst[j]["games"]) / 30.0
                pair = frozenset({lst[i]["player_id"], lst[j]["player_id"]})
                pairs[pair] = max(pairs.get(pair, 0), w)
        table[key] = pairs
    return table


def build_chem(records: list[dict]) -> dict:
    pair_win_data = load_cached("pair_win.json")
    return {
        "pair_table": build_pair_table(records),
        "tags": build_style_tags(records),
        "pair_win": pair_win_data,
    }


def lineup_strength(starter: list[dict], chem: dict | None, compress: float = 0.6) -> tuple[float, dict]:
    """有效强度 = 50 + (基础评分 + 位置覆盖 + 老搭档 + 风格适配 - 50) * 压缩系数。"""
    if not starter:
        return 50.0, {"base": 50.0, "coverage": 0.0, "synergy": 0.0, "style": 0.0}
    base = sum(s["rating"] for s in starter) / len(starter)
    positions = {s["position"] for s in starter}
    coverage = 2.0 if len(positions) == 5 else 0.0
    coverage -= max(0, 5 - len(starter)) * 1.5

    synergy = 0.0
    if chem:
        pair_table = chem["pair_table"]
        for i in range(len(starter)):
            for j in range(i + 1, len(starter)):
                key = (starter[i]["season_id"], starter[i]["team_franchise"])
                pair = frozenset({starter[i]["player_id"], starter[j]["player_id"]})
                synergy += pair_table.get(key, {}).get(pair, 0.0)
        synergy = min(synergy, SYNERGY_CAP) * SYNERGY_SCALE

    # 组合真实胜率：同队同赛季两人共同出场时，胜率偏离 50% 的幅度作为化学分
    # （高战力组队却胜率低 → 负分；长期一起赢 → 正分）
    win_synergy = 0.0
    if chem and chem.get("pair_win"):
        players = load_cached("players.json")["players"]
        name_by_id = {p["player_id"]: p["name"] for p in players}
        pair_win = chem["pair_win"].get("pair_win", {})
        for i in range(len(starter)):
            for j in range(i + 1, len(starter)):
                a = starter[i]
                b = starter[j]
                if a["season_id"] != b["season_id"] or a["team_franchise"] != b["team_franchise"]:
                    continue
                n1, n2 = sorted([name_by_id.get(a["player_id"], a["player_id"]),
                                 name_by_id.get(b["player_id"], b["player_id"])])
                key = f"{a['season_id']}|{a['team_franchise']}|{n1}|{n2}"
                rec = pair_win.get(key)
                if not rec or rec["games"] < PAIR_WIN_MIN:
                    continue
                wr = rec["wins"] / rec["games"]
                win_synergy += (wr - 0.5) * PAIR_WIN_WEIGHT * min(1.0, rec["games"] / 30.0)
        win_synergy = max(-3.0, min(3.0, win_synergy))

    style = 0.0
    if chem:
        tags = chem["tags"]
        carries = sum(
            1 for s in starter
            if tags.get((s["player_id"], s["season_id"])) == "大核"
        )
        if carries >= 3:
            style = -(carries - 2) * STYLE_PENALTY
        elif carries == 0:
            style = -1.0

    raw = base + coverage + synergy + win_synergy + style
    effective = 50.0 + (raw - 50.0) * compress
    return effective, {
        "base": round(base, 1),
        "coverage": round(coverage, 1),
        "synergy": round(synergy, 1),
        "win_synergy": round(win_synergy, 1),
        "style": round(style, 1),
        "raw": round(raw, 1),
        "effective": round(effective, 1),
    }


def _starter_name(s: dict, players: dict[str, dict]) -> str:
    p = players.get(s["player_id"], {})
    return p.get("name") or s["player_id"][:8]


def main() -> None:
    ap = argparse.ArgumentParser(description="阵容化学反应演示")
    ap.add_argument("--team", default="10001")
    ap.add_argument("--season", default="KPL2021S2", help="对战赛季")
    ap.add_argument("--roster-season", default="KPL2026S1", help="阵容来源赛季")
    args = ap.parse_args()

    records = load("player_season_stats.json")["records"]
    players = {p["player_id"]: p for p in load("players.json")["players"]}
    chem = build_chem(records)
    rosters: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        if r["season_id"] == args.roster_season and (r["games"] or 0) >= 5 and r["position"] in POSITIONS:
            rosters[r["team_franchise"]].append(r)
    for lst in rosters.values():
        lst.sort(key=lambda r: r["rating"], reverse=True)

    def show(title: str, starter: list[dict]) -> None:
        eff, brk = lineup_strength(starter, chem)
        names = " + ".join(_starter_name(s, players) for s in starter)
        print(f"[{title}] 强度={eff:.1f}")
        print(f"  拆解: 基础{brk['base']} 覆盖{brk['coverage']} 默契{brk['synergy']} 风格{brk['style']}")
        print(f"  阵容: {names}")

    if args.team in rosters:
        show(f"{args.roster_season} 该队首发", rosters[args.team][:5])
    # 全大核反例：取 5 个最高评分选手（多为大核，破坏位置与资源结构）
    top5 = sorted(records, key=lambda r: r["rating"], reverse=True)
    top5 = [r for r in top5 if r["season_id"] == args.roster_season and (r["games"] or 0) >= 5][:5]
    if top5:
        show("全联盟最高分 5 人（反例）", top5)


if __name__ == "__main__":
    main()
