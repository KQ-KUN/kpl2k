"""KPL 2K 赛季模拟器 v1：KPL 赛季完整流程

分组循环（S/A/B）→ 卡位赛（v1 仅叙事）→ 季后赛（双败/单败，按赛季配置）→ 总决赛

注意：
- 季后赛队数/赛制为人工标注配置（PLAYOFF_CONFIG），待与真实赛制逐赛季校对；
- 败者组配对为 v1 近似实现，精确到真实对阵树的细化为后续版本。

用法：
  python tools/sim_season.py --season KPL2021S2 --runs 100
  python tools/sim_season.py --season KPL2021S2 --runs 100 --team 10001 --roster-season KPL2026S1
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sim_engine as se  # noqa: E402
import chemistry  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"

# 季后赛配置兜底（正式配置由 formats.json 的 playoff_config 数据驱动提供）
DEFAULT_PLAYOFF = (8, "double_elim", 7)


def load(name: str) -> dict:
    return json.loads((PROC / name).read_text(encoding="utf-8"))


def build_standings(rounds: list[dict], strengths: dict[str, float], rng: random.Random) -> tuple[dict[str, dict], dict[str, str]]:
    """常规赛 v2：累计胜场/净胜局；分组归属以最后一轮（第三轮）为准。"""
    standings: dict[str, dict] = {}
    final_group: dict[str, str] = {}
    for rnd in rounds:
        if rnd["type"] != "round_robin":
            continue
        for m in rnd["matches"]:
            a_id, b_id = m["a_id"], m["b_id"]
            grp_a = m.get("a_group") or "?"
            grp_b = m.get("b_group") or "?"
            sa = strengths.get(a_id, 50.0) + rng.gauss(0, se.STRENGTH_NOISE)
            sb = strengths.get(b_id, 50.0) + rng.gauss(0, se.STRENGTH_NOISE)
            p = se.series_win_prob(sa, sb, k=se.K)
            ra, rb, _ = se.play_series(rng, p, rnd["bo"] or 5)
            for tid, g, opp_score in ((a_id, ra, rb), (b_id, rb, ra)):
                row = standings.setdefault(tid, {"w": 0, "l": 0, "gf": 0, "ga": 0})
                if g > opp_score:
                    row["w"] += 1
                else:
                    row["l"] += 1
                row["gf"] += g
                row["ga"] += opp_score
            final_group[a_id] = grp_a
            final_group[b_id] = grp_b
    return standings, final_group


def rank_group(tbl: dict) -> list[str]:
    return [tid for tid, _ in sorted(tbl.items(), key=lambda kv: (-kv[1]["w"], kv[1]["gf"] - kv[1]["ga"]))]


def pick_qualifiers(standings: dict[str, dict], final_group: dict[str, str], n: int) -> list[str]:
    order: list[str] = []
    for grp in ("S", "A", "B"):
        sub = {tid: standings[tid] for tid in standings if final_group.get(tid) == grp}
        order.extend(rank_group(sub))
    return order[:n]


def pair_round(rng: random.Random, teams: list[str], bo: int, strengths: dict[str, float]) -> tuple[list[str], list[str]]:
    winners, losers = [], []
    for i in range(0, len(teams), 2):
        a, b = teams[i], teams[i + 1]
        sa = strengths.get(a, 50.0) + rng.gauss(0, se.STRENGTH_NOISE)
        sb = strengths.get(b, 50.0) + rng.gauss(0, se.STRENGTH_NOISE)
        p = se.series_win_prob(sa, sb, k=se.K)
        ra, rb, _ = se.play_series(rng, p, bo)
        winners.append(a if ra > rb else b)
        losers.append(b if ra > rb else a)
    return winners, losers


def single_elim(rng: random.Random, seeds: list[str], bo: int, strengths: dict[str, float]) -> tuple[str, list[str]]:
    teams = list(seeds)
    while len(teams) > 1:
        if len(teams) % 2:
            teams = [teams[0]] + pair_round(rng, teams[1:], bo, strengths)[0]
        else:
            teams = pair_round(rng, teams, bo, strengths)[0]
    return teams[0], []


def double_elim(rng: random.Random, seeds: list[str], bo: int, strengths: dict[str, float]) -> tuple[str, list[str], list[str], list[str]]:
    """双败（v1 近似）：胜者组单败产生冠军候选，败者组按淘汰顺序两两配对。"""
    upper = list(seeds)
    waves: list[list[str]] = []
    while len(upper) > 1:
        if len(upper) % 2:
            upper = [upper[0]] + pair_round(rng, upper[1:], bo, strengths)[0]
            continue
        winners, losers = pair_round(rng, upper, bo, strengths)
        waves.append(losers)
        upper = winners
    ub_champ = upper[0]

    lower: list[str] = []
    for wave in waves[:-1]:
        lower.extend(wave)
        if len(lower) >= 2:
            pairs = lower[: len(lower) // 2 * 2]
            winners, _ = pair_round(rng, pairs, bo, strengths)
            lower = winners + lower[len(pairs):]
    if waves:
        lower.append(waves[-1][0])
    while len(lower) > 1:
        if len(lower) % 2:
            lower = [lower[0]] + pair_round(rng, lower[1:], bo, strengths)[0]
        else:
            lower = pair_round(rng, lower, bo, strengths)[0]
    lb_champ = lower[0] if lower else ub_champ

    if lb_champ == ub_champ:
        return ub_champ, [], [ub_champ], [ub_champ]
    sa = strengths.get(ub_champ, 50.0) + rng.gauss(0, se.STRENGTH_NOISE)
    sb = strengths.get(lb_champ, 50.0) + rng.gauss(0, se.STRENGTH_NOISE)
    p = se.series_win_prob(sa, sb, k=se.K)
    ra, rb, games = se.play_series(rng, p, bo)
    champion = ub_champ if ra > rb else lb_champ
    return champion, games, [ub_champ], [lb_champ]


def simulate_season(season_id: str, formats: dict, rosters: dict[str, list[dict]], rng: random.Random, override: dict[str, list[dict]] | None = None, chem: dict | None = None) -> tuple[str | None, dict, list[str], dict[str, str]]:
    if override:
        rosters = {**rosters, **override}
    fmt = formats["seasons"].get(season_id)
    if not fmt:
        return None, {}, [], {}
    strengths = {fid: se.team_strength(se.pick_starter(r), chem) for fid, r in rosters.items()}
    standings, final_group = build_standings(fmt["rounds"], strengths, rng)
    cfg = fmt.get("playoff_config")
    if cfg:
        qualify, ptype, pbo = cfg["qualify"], cfg["type"], cfg["bo"]
    else:
        qualify, ptype, pbo = DEFAULT_PLAYOFF
    seeds = pick_qualifiers(standings, final_group, qualify)
    if ptype == "double_elim":
        champion, final_games, final_a, final_b = double_elim(rng, seeds, pbo, strengths)
    else:
        champion, final_games = single_elim(rng, seeds, pbo, strengths)
        final_a = final_b = []
    return champion, standings, seeds, final_group


def main() -> None:
    ap = argparse.ArgumentParser(description="KPL 赛季模拟器 v1")
    ap.add_argument("--season", default="KPL2021S2")
    ap.add_argument("--runs", type=int, default=100)
    ap.add_argument("--k", type=float, default=se.K)
    ap.add_argument("--noise", type=float, default=se.STRENGTH_NOISE)
    ap.add_argument("--compress", type=float, default=se.COMPRESS)
    ap.add_argument("--team", help="替换阵容的 franchise")
    ap.add_argument("--roster-season", default="KPL2026S1")
    args = ap.parse_args()

    se.K, se.STRENGTH_NOISE, se.COMPRESS = args.k, args.noise, args.compress
    formats = load("formats.json")
    names = se.franchise_names()
    season_names: dict[str, str] = {}
    for f in load("franchises.json")["franchises"]:
        nbs = f.get("names_by_season") or {}
        if args.season in nbs:
            season_names[f["slug"]] = nbs[args.season]
        elif nbs:
            season_names[f["slug"]] = nbs[sorted(nbs, reverse=True)[0]]

    def disp(tid: str) -> str:
        slug = tid.rsplit("_", 1)[-1] if "_" in tid else tid
        return season_names.get(slug, names.get(tid, tid))

    rosters = se.season_rosters(args.season)
    override: dict[str, list[dict]] = {}
    if args.team:
        base = se.season_rosters(args.roster_season)
        if args.team in base:
            override[args.team] = se.pick_starter(base[args.team])
            print(f"阵容替换：{names.get(args.team)} 使用 {args.roster_season} 首发")

    counts: dict[str, int] = {}
    sample_standings = None
    chem = chemistry.build_chem([r for lst in rosters.values() for r in lst] + [r for lst in override.values() for r in lst])
    for i in range(args.runs):
        rng = random.Random(i)
        champion, standings, seeds, final_group = simulate_season(args.season, formats, rosters, rng, override, chem)
        if champion:
            counts[champion] = counts.get(champion, 0) + 1
        if i == 0:
            sample_standings = (standings, seeds, final_group)

    print(f"赛季 {args.season}：模拟 {args.runs} 次冠军分布（k={args.k}, noise={args.noise}, compress={args.compress}）")
    for fid, c in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {disp(fid):<12} {c:>4} 次 ({c / args.runs:.0%})")
    if sample_standings:
        standings, seeds, final_group = sample_standings
        s_group = {tid: standings[tid] for tid in standings if final_group.get(tid) == "S"}
        print(f"第一次模拟的常规赛最终 S 组排名（{len(s_group)} 队）：")
        for rank, tid in enumerate(rank_group(s_group), start=1):
            row = standings[tid]
            print(f"  S{rank}  {disp(tid):<10} {row['w']}胜{row['l']}负 净胜{row['gf'] - row['ga']}")
        print(f"  季后赛种子（前 {len(seeds)}）：{', '.join(disp(t) for t in seeds[:8])}")


if __name__ == "__main__":
    main()
