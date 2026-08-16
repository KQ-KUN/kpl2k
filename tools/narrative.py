"""KPL 2K 叙事生成 v1：把模拟赛季变成有互动性的文字故事

输入一次模拟的"球队旅程"，输出结构化故事事件列表（UI 可逐轮展开/点按揭晓）：
intro（开赛）→ round×N（每轮：标题/比分/氛围词/小局战报/名场面彩蛋）→ final（总决赛）→ epilogue（终章）

用法（配合 sim_engine --story）：
  python tools/sim_engine.py --season KCC2026 --story --roster "..."
"""

from __future__ import annotations

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TPL_PATH = ROOT / "data" / "narrative" / "templates.json"
FLAVOR_PATH = ROOT / "data" / "narrative" / "player_flavor.json"
TEAM_FLAVOR_PATH = ROOT / "data" / "narrative" / "team_flavor.json"
RIVALRY_PATH = ROOT / "data" / "narrative" / "rivalry_flavor.json"


def load_templates() -> dict:
    return json.loads(TPL_PATH.read_text(encoding="utf-8"))


def load_flavor() -> dict[str, list[str]]:
    return json.loads(FLAVOR_PATH.read_text(encoding="utf-8")).get("flavors", {})


def load_team_flavor() -> dict[str, list[str]]:
    return json.loads(TEAM_FLAVOR_PATH.read_text(encoding="utf-8")).get("teams", {})


def load_rivalries() -> list[dict]:
    return json.loads(RIVALRY_PATH.read_text(encoding="utf-8")).get("rivalries", [])


def find_rivalry(rivalries: list[dict], players_a: list[str], players_b: list[str]) -> dict | None:
    """两队名单里各含恩怨对的一人时，返回对应恩怨配置。"""
    set_a, set_b = set(players_a), set(players_b)
    for r in rivalries:
        a, b = r["players"]
        if (a in set_a and b in set_b) or (b in set_a and a in set_b):
            return r
    return None


def pick(rng: random.Random, lst: list[str]) -> str:
    return rng.choice(lst)


def team_nickname(rng: random.Random, team_flavor: dict[str, list[str]], team_name: str) -> str | None:
    for key, nicks in team_flavor.items():
        if key in team_name and nicks:
            return pick(rng, nicks)
    return None


def max_deficit(results: list[str], winner_is_a: bool) -> int:
    """胜方在系列赛中曾落后过的最大局数。"""
    a = b = 0
    worst = 0
    for g in results:
        if g == "A":
            a += 1
        else:
            b += 1
        diff = (a - b) if winner_is_a else (b - a)
        if diff < worst:
            worst = diff
    return -worst


def round_tag(rng: random.Random, tpl: dict, score: str, results: list[str], win: bool) -> str:
    parts = score.split(":")
    sa, sb = int(parts[0]), int(parts[1])
    deficit = max_deficit(results, True)  # results 已统一为主队视角
    if not win:
        if sa == 0:
            key = "sweep"
        elif abs(sa - sb) == 1:
            key = "close"
        else:
            key = "tight"
    elif deficit >= 2:
        key = "comeback"
    elif sa == 0 or sb == 0:
        key = "sweep"
    elif sa + sb >= 6 and max(sa, sb) - min(sa, sb) == 1:
        key = "close"
    elif max(sa, sb) - min(sa, sb) >= 2:
        key = "dominant"
    else:
        key = "tight"
    return pick(rng, tpl.get("round_tags", {}).get(key, ["激烈的一轮"]))


def scene_line(rng: random.Random, tpl: dict, scene: str, text: str) -> str:
    """用场景引导词衔接文本，去掉生硬的元标签（如'名场面：'）。"""
    leads = (tpl.get("scene_leads") or {}).get(scene, [""])
    lead = pick(rng, leads) if leads else ""
    return (lead + text) if lead else text


def build_story(rng: random.Random, tpl: dict, flavor: dict[str, list[str]], ctx: dict) -> list[dict]:
    events: list[dict] = []
    season, team, roster = ctx["season_name"], ctx["team"], ctx["roster"]
    year = ctx.get("year", "")
    rivalries = load_rivalries()
    used_flavor: set[str] = set()
    used_players: set[str] = set()
    last_player: str | None = None

    def flavor_take(scene: str = "名场面") -> tuple[str | None, str | None]:
        nonlocal last_player
        fallback: tuple[str | None, str | None] = (None, None)
        for name in roster:
            if name in used_players:
                continue
            entry = flavor.get(name)
            if not entry:
                continue
            candidates = []
            if isinstance(entry, dict):
                candidates = list(entry.get(scene, []))
                if scene != "低谷":
                    candidates += list(entry.get("名场面", []))
            else:
                candidates = list(entry)
            for line in candidates:
                if line in used_flavor:
                    continue
                picked = (line, name)
                if name != last_player:
                    used_flavor.add(line)
                    used_players.add(name)
                    last_player = name
                    return picked
                if fallback[0] is None:
                    fallback = picked
        if fallback[0] is not None:
            used_flavor.add(fallback[0])
            used_players.add(fallback[1])
            last_player = fallback[1]
        return fallback

    opener = pick(rng, tpl["season_openers"]).format(
        year=year, season=season, team=team, roster="、".join(roster),
    )
    intro_lines = [opener]
    used_players.clear()
    fl, fname = flavor_take("开场")
    if fl:
        intro_lines.append(f"名单公布当晚，{fname}的应援词刷了屏：「{fl}」")
    team_nick = team_nickname(rng, load_team_flavor(), team)
    if team_nick:
        intro_lines.append(f"评论区刷屏：{team}？那不是「{team_nick}」吗")
    events.append({"type": "intro", "title": f"{season} · 开赛", "lines": intro_lines})

    # 常规赛收官：有常规赛的赛季（KPL）在开赛后、首轮淘汰赛前补一段排名与签运剧情
    regular = ctx.get("regular") or {}
    track_reg = regular.get("track")
    if track_reg:
        recap = pick(rng, tpl.get("regular_recap") or ["常规赛收官，{team}以第{rank}名进入季后赛。"]).format(
            team=team,
            rank=track_reg.get("rank", "?"),
            wins=track_reg.get("wins", 0),
            losses=track_reg.get("losses", 0),
        )
        reg_lines = [recap]
        reg_lines.extend(regular.get("seed_notes") or [])
        events.append({"type": "regular", "title": "常规赛收官", "lines": reg_lines})

    for i, p in enumerate(ctx["path"], start=1):
        used_players.clear()
        is_final = "决赛" in p["round"]
        deficit = max_deficit(p["results"], True)
        if not is_final:
            lines = [round_tag(rng, tpl, p["score"], p["results"], p["win"])]
            lines.extend(p["games"])
            # 恩怨局互动：两队阵容里出现名场面宿敌
            opp_players = p.get("opp_players") or []
            riv = find_rivalry(rivalries, roster, opp_players)
            if riv and rng.random() < 0.55:
                lines.append(scene_line(rng, tpl, "恩怨局", pick(rng, riv["lines"])))
            fl = fname = None
            fl_scene = None
            if i == 1:
                fl, fname = flavor_take("名场面")
                fl_scene = "名场面"
            elif deficit >= 2:
                fl, fname = flavor_take("翻盘")
                fl_scene = "翻盘"
            elif i == len(ctx["path"]) - 1:
                fl, fname = flavor_take("名场面")
                fl_scene = "名场面"
            if fl:
                lines.append(scene_line(rng, tpl, fl_scene or "名场面", fl.replace("xx", p["opp"])))
            if "B" in p["results"]:
                fl2, fname2 = flavor_take("低谷")
                if fl2:
                    lines.append(scene_line(rng, tpl, "低谷", fl2))
            # 轮次评述：把本轮的比分/胜负收尾成一句解说
            sum_key = "win" if p["win"] else "loss"
            lines.append(pick(rng, tpl.get("round_summaries", {}).get(sum_key, ["这一轮结束。"])).format(
                team=team, opp=p["opp"], score=p["score"],
            ))
        else:
            lines = [pick(rng, tpl["final_lines"])]
            lines.extend(p["games"])
            fl, fname = flavor_take("决赛")
            if fl:
                lines.append(scene_line(rng, tpl, "决赛", fl))
            continue
        if is_final:
            continue
        events.append({
            "type": "round",
            "title": f"第 {i} 轮 · {p['round']}",
            "meta": {"opp": p["opp"], "score": p["score"], "win": p["win"]},
            "lines": lines,
        })

    has_final_path = bool(ctx["path"]) and "决赛" in ctx["path"][-1]["round"]
    if has_final_path:
        final_lines = lines
        if ctx["champion"] == ctx["team"]:
            fl, fname = flavor_take("夺冠")
            story = f"这一次，{fname}没有让机会溜走。" if fname else "这一次，他们没有让机会溜走。"
            final_lines.append(pick(rng, tpl["champion_lines"]).format(team=team, story=story))
            if fl:
                final_lines.append(scene_line(rng, tpl, "夺冠", fl))
        else:
            final_lines.append(pick(rng, tpl["runnerup_lines"]).format(team=team))
            fl, fname = flavor_take("遗憾")
            if fl:
                final_lines.append(scene_line(rng, tpl, "遗憾", fl))
        events.append({"type": "final", "title": "总决赛", "lines": final_lines})
    elif ctx["champion"] == ctx["team"]:
        final_lines = [pick(rng, tpl.get("default_champion", ["决赛的另一半倒在了半路，{team}不战而冠。"])).format(team=team, season=season)]
        fl, fname = flavor_take("夺冠")
        if fl:
            final_lines.append(scene_line(rng, tpl, "夺冠", fl))
        events.append({"type": "final", "title": "加冕", "lines": final_lines})
    else:
        final_lines = [pick(rng, tpl.get("eliminations", ["{team}的{season}之旅，止步于此。"])).format(season=season, team=team)]
        fl, fname = flavor_take("遗憾")
        if fl:
            final_lines.append(scene_line(rng, tpl, "遗憾", fl))
        events.append({"type": "final", "title": "赛季收官", "lines": final_lines})

    # 赛季总结：放终章前，汇总战绩与旅程
    wins = sum(1 for p in ctx["path"] if p.get("win"))
    losses = sum(1 for p in ctx["path"] if not p.get("win"))
    summary_lines = [f"【赛季战绩】{wins} 胜 {losses} 负"]
    for p in ctx["path"]:
        tag = "胜" if p.get("win") else "负"
        summary_lines.append(f"  {p['round']} vs {p['opp']}：{p['score']} {tag}")
    parts = tpl.get("season_summary_parts", {})
    if ctx["champion"] == team:
        summary_lines.append(pick(rng, parts.get("champion", ["最终，{team}捧起冠军奖杯。"])).format(team=team, season=season))
    elif ctx["path"] and "决赛" in ctx["path"][-1]["round"]:
        summary_lines.append(pick(rng, parts.get("runnerup", ["最终，{team}屈居亚军。"])).format(team=team, season=season))
    else:
        stage = ctx["path"][-1]["round"] if ctx["path"] else season
        summary_lines.append(pick(rng, parts.get("eliminated", ["最终，{team}止步于此。"])).format(team=team, season=season, stage=stage))
    events.append({"type": "summary", "title": "赛季总结", "lines": summary_lines})

    epilogue = pick(rng, tpl["epilogues"]).format(season=season, team=team)
    events.append({"type": "epilogue", "title": "赛季终章", "lines": [epilogue]})
    return events


def print_story(events: list[dict]) -> None:
    for e in events:
        print(f"\n【{e['title']}】")
        for line in e["lines"]:
            print(f"  {line}")
