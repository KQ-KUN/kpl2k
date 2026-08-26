"""KPL 2K 模拟引擎 v0（M1 核心雏形）

能力：
- 从 processed 数据构建某赛季各队"真实首发"（当赛季评分前 5）
- 队伍强度 = 首发评分加权 + 位置覆盖加成
- 系列赛胜率 = sigmoid(实力差)，支持爆冷参数
- 按 formats.json 的真实对阵逐轮模拟，输出冠军分布
- 每小局生成模板化文字战报（开局/事件/终结/比分）

注意：v0 用真实对阵做校准演示；自定义阵容与自主生成淘汰树在 M1 正式版。

用法：
  python tools/sim_engine.py --season KCC2026 --runs 200
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
from pathlib import Path

import chemistry
import narrative

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"
TEMPLATES_PATH = ROOT / "data" / "narrative" / "templates.json"

POSITIONS = ["对抗路", "打野", "中路", "发育路", "游走"]

HERO_POOL = {
    "对抗路": ["关羽", "马超", "花木兰", "蒙恬", "吕布", "猪八戒", "狂铁", "亚连", "夏洛特", "姬小满"],
    "打野": ["镜", "澜", "露娜", "裴擒虎", "橘右京", "娜可露露", "韩信", "云缨", "铠", "兰陵王"],
    "中路": ["沈梦溪", "王昭君", "周瑜", "安琪拉", "干将莫邪", "不知火舞", "上官婉儿", "西施", "金蝉", "嬴政"],
    "发育路": ["马可波罗", "公孙离", "孙尚香", "狄仁杰", "虞姬", "伽罗", "黄忠", "鲁班七号", "戈娅", "莱西奥"],
    "游走": ["张飞", "牛魔", "太乙真人", "孙膑", "大乔", "东皇太一", "盾山", "鲁班大师", "鬼谷子", "苏烈"],
}
SYSTEMS = ["盾曹体系", "马核体系", "大乔体系", "孙膑体系", "弹弓体系", "射核体系", "野核体系", "法刺体系", "坦边体系", "运营体系"]
OBJECTIVES = ["暴君", "主宰", "风暴龙王", "暗影暴君", "先知主宰"]
K = 0.08              # 系列赛胜率曲线陡峭度（越小越容易爆冷）
STRENGTH_NOISE = 3.4  # 每场系列赛的实力随机扰动（与浏览器引擎一致）
COMPRESS = 1.0        # 实力压缩系数：1.0 = 战力与实际强度一致（王朝 90 即模拟 90 强度）


def load(name: str) -> dict:
    return json.loads((PROC / name).read_text(encoding="utf-8"))


def load_overrides() -> dict:
    p = ROOT / "data" / "overrides" / "player_versions.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def load_templates() -> dict:
    if TEMPLATES_PATH.exists():
        tpl = json.loads(TEMPLATES_PATH.read_text(encoding="utf-8"))
        pool_path = TEMPLATES_PATH.parent / "heroes_pool.json"
        if pool_path.exists():
            tpl.setdefault("heroes_pool", json.loads(pool_path.read_text(encoding="utf-8")))
        return tpl
    return {
        "systems": SYSTEMS,
        "heroes": HERO_POOL,
        "openings": ["双方换边，红方{team_a}用一套{system}克制蓝方{team_b}的{hero_b}"],
        "events": ["{minute}分钟龙团，{team}.{player}抢到{objective}，不再彷徨"],
        "endings": ["{team_a}平推水晶，目前比分改写为{score_a}:{score_b}"],
        "comebacks": ["绝境之中{team_a}连追三局，逆天改命"],
        "upsets": ["黑马奇迹，逆袭成功，这就是电子竞技"],
        "meme_quotes": [],
        "player_quotes": [],
        "score_line": "目前比分{team_a}{score_a}:{score_b}{team_b}",
    }


def season_rosters(season_id: str) -> dict[str, list[dict]]:
    """返回 {franchise_id: [该赛季选手统计（按评分降序）]}，只保留有评分且出场>=5 的选手。"""
    records = load("player_season_stats.json")["records"]
    rosters: dict[str, list[dict]] = {}
    for r in records:
        if r["season_id"] != season_id or r["rating"] is None:
            continue
        if (r["games"] or 0) < 5 or r["position"] not in POSITIONS:
            continue
        rosters.setdefault(r["team_franchise"], []).append(r)
    for lst in rosters.values():
        lst.sort(key=lambda r: r["rating"], reverse=True)
    return rosters


def pick_starter(roster: list[dict]) -> list[dict]:
    """尽量覆盖 5 个位置：先取每位置最强，缺位用剩余最强补。"""
    by_pos = {p: [r for r in roster if r["position"] == p] for p in POSITIONS}
    starters = []
    used = set()
    for p in POSITIONS:
        if by_pos[p]:
            starters.append(by_pos[p][0])
            used.add(id(by_pos[p][0]))
    for r in roster:
        if len(starters) >= 5:
            break
        if id(r) not in used:
            starters.append(r)
    return starters[:5]


def team_strength(starter: list[dict], chem: dict | None = None) -> float:
    if not starter:
        return 50.0
    if chem:
        eff, _ = chemistry.lineup_strength(starter, chem, COMPRESS)
        return eff
    ratings = [s["rating"] for s in starter]
    base = sum(ratings) / len(ratings)
    positions = {s["position"] for s in starter}
    bonus = 2.0 if len(positions) == 5 else 0.0
    penalty = max(0, 5 - len(starter)) * 1.5
    return 50.0 + (base + bonus - penalty - 50.0) * COMPRESS


def series_win_prob(sa: float, sb: float, k: float = 0.12) -> float:
    return 1.0 / (1.0 + math.exp(-k * (sa - sb)))


def play_series(rng: random.Random, p: float, bo: int) -> tuple[int, int, list[str]]:
    a = b = 0
    target = bo // 2 + 1
    results: list[str] = []
    while a < target and b < target:
        if rng.random() < p:
            a += 1
            results.append("A")
        else:
            b += 1
            results.append("B")
    return a, b, results


def play_match(
    rng: random.Random,
    strengths: dict[str, float],
    a_id: str,
    b_id: str,
    bo: int,
) -> tuple[str, int, int, list[str]]:
    """打一场系列赛，返回 (胜者, 比分A, 比分B, 小局序列)。"""
    sa = strengths.get(a_id, 50.0) + rng.gauss(0, STRENGTH_NOISE)
    sb = strengths.get(b_id, 50.0) + rng.gauss(0, STRENGTH_NOISE)
    p = series_win_prob(sa, sb, k=K)
    score_a, score_b, results = play_series(rng, p, bo)
    winner = a_id if score_a > score_b else b_id
    return winner, score_a, score_b, results


def seed_order_from_rounds(rounds: list[dict]) -> list[str]:
    """从官方淘汰轮对阵提取参赛队伍种子顺序（保持真实赛制相似度）。"""
    seen: list[str] = []
    for r in rounds:
        for m in r.get("matches", []):
            for tid in (m.get("a_id"), m.get("b_id")):
                if tid and tid not in seen:
                    seen.append(tid)
    return seen


def dynamic_single_elim(
    rng: random.Random,
    strengths: dict[str, float],
    teams: list[str],
    bo: int,
) -> tuple[str, list[dict]]:
    """动态单败淘汰：种子相邻配对，赛果由战力系统决定，返回 (冠军, 每轮赛果)。"""
    alive = list(teams)
    rounds_out: list[dict] = []
    round_no = 0
    while len(alive) > 1:
        round_no += 1
        pairs = [alive[i:i + 2] for i in range(0, len(alive), 2)]
        winners = []
        matches = []
        for pair in pairs:
            if len(pair) < 2:
                winners.append(pair[0])  # 轮空直接晋级
                continue
            w, sa, sb, results = play_match(rng, strengths, pair[0], pair[1], bo)
            winners.append(w)
            matches.append({"a": pair[0], "b": pair[1], "w": w, "sa": sa, "sb": sb, "results": results})
        rounds_out.append({"round_no": round_no, "matches": matches, "winners": winners})
        alive = winners
    return alive[0] if alive else None, rounds_out


def dynamic_double_elim(
    rng: random.Random,
    strengths: dict[str, float],
    teams: list[str],
    bo: int,
    final_bo: int | None = None,
) -> tuple[str, list[dict]]:
    """动态双败淘汰：标准胜者组/败者组，种子相邻配对，赛果由战力系统决定。

    流程：标准双败——
      胜者组第1轮 N 队 -> 胜者组半决赛 -> 胜者组决赛（剩 1 队）
      败者组：第1轮败者两两打，胜者进第2轮，再并入胜者组第2轮败者……
      最终胜者组冠军 vs 败者组冠军，败者组冠军需连赢两场。
    返回 (冠军, 全部赛果)。官方双败结构被重建为等价标准双败。
    """
    final_bo = final_bo or bo
    winners_bracket = list(teams)
    losers_bracket: list[str] = []
    rounds_out: list[dict] = []

    def run_round(bracket: list[str], tag: str) -> list[str]:
        """相邻配对打一轮，返回胜者；败者记入 rounds_out。"""
        winners = []
        pairs = [bracket[i:i + 2] for i in range(0, len(bracket), 2)]
        for pair in pairs:
            if len(pair) < 2:
                winners.append(pair[0])  # 轮空直接晋级
                continue
            w, sa, sb, results = play_match(rng, strengths, pair[0], pair[1], bo)
            winners.append(w)
            loser = pair[1] if w == pair[0] else pair[0]
            rounds_out.append({"round": tag, "a": pair[0], "b": pair[1], "w": w,
                               "loser": loser, "sa": sa, "sb": sb, "results": results})
        return winners

    def run_bracket_round(bracket: list[str], tag: str) -> list[str]:
        """打一轮并把败者收集到败者池，返回胜者。"""
        nonlocal losers_bracket
        winners = []
        pairs = [bracket[i:i + 2] for i in range(0, len(bracket), 2)]
        for pair in pairs:
            if len(pair) < 2:
                winners.append(pair[0])
                continue
            w, sa, sb, results = play_match(rng, strengths, pair[0], pair[1], bo)
            winners.append(w)
            loser = pair[1] if w == pair[0] else pair[0]
            rounds_out.append({"round": tag, "a": pair[0], "b": pair[1], "w": w,
                               "loser": loser, "sa": sa, "sb": sb, "results": results})
            losers_bracket.append(loser)
        return winners

    # 标准双败：胜者组与败者组交替淘汰
    while len(winners_bracket) > 1:
        winners_bracket = run_bracket_round(winners_bracket, "胜者组")
        if len(losers_bracket) >= 2:
            losers_bracket = run_round(losers_bracket, "败者组")
    # 败者组收尾
    while len(losers_bracket) > 1:
        losers_bracket = run_round(losers_bracket, "败者组")

    # 总决赛：胜者组冠军 vs 败者组冠军，败者组冠军需赢两场
    wg_champ = winners_bracket[0]
    lg_champ = losers_bracket[0] if losers_bracket else None
    if lg_champ is None:
        return wg_champ, rounds_out
    champion = wg_champ
    # 第一场
    w1, sa1, sb1, r1 = play_match(rng, strengths, wg_champ, lg_champ, final_bo)
    rounds_out.append({"round": "总决赛第一场", "a": wg_champ, "b": lg_champ, "w": w1,
                       "loser": lg_champ if w1 == wg_champ else wg_champ,
                       "sa": sa1, "sb": sb1, "results": r1})
    if w1 == lg_champ:
        # 败者组冠军扳回一城，打第二场
        w2, sa2, sb2, r2 = play_match(rng, strengths, wg_champ, lg_champ, final_bo)
        rounds_out.append({"round": "总决赛第二场", "a": wg_champ, "b": lg_champ, "w": w2,
                           "loser": lg_champ if w2 == wg_champ else wg_champ,
                           "sa": sa2, "sb": sb2, "results": r2})
        champion = w2
    return champion, rounds_out


def series_pace_text(rng: random.Random, score_a: int, score_b: int) -> str:
    winner, loser = max(score_a, score_b), min(score_a, score_b)
    if loser == 0:
        return rng.choice(["零封过关", "直落数局", "没有让对手拿到一分"])
    if winner - loser == 1:
        return rng.choice(["鏖战至决胜局", "把悬念留到最后一局", "险胜过关"])
    return rng.choice(["稳稳过关", "掌控系列赛节奏", "带着两局以上优势晋级"])


def game_narration(rng: random.Random, tpl: dict, team_a: str, team_b: str, winner: str, score_a: int, score_b: int, game_no: int, player: str, comeback: bool, max_deficit: int = 0, tied_now: bool = False, ahead_now: bool = False, is_last: bool = False, is_peak: bool = False, peak_score: int = 3, year: int | None = None, used_heroes: dict | None = None) -> str:
    year_pool = (tpl.get("heroes_pool") or {}).get(str(year)) if year else None
    hero_source = year_pool or tpl["heroes"]
    roles = list(hero_source.keys())
    used = used_heroes if used_heroes is not None else {}

    def pick_hero() -> str:
        role = rng.choice(roles)
        pool = hero_source.get(role)
        if not isinstance(pool, list) or not pool:
            pool = tpl["heroes"].get(role) or []
        pool = [h for h in pool if h not in used] or pool  # 全局 BP：已用英雄不再复用
        hero = rng.choice(pool) if pool else "不知火舞"
        used[hero] = 1
        return hero

    system_a = rng.choice(tpl["systems"])
    system_b = rng.choice(tpl["systems"])
    if is_peak:
        bp = "巅峰对决！双方盲选当前版本最强阵容，英雄完全相同，拼的就是硬实力"
    else:
        bp = rng.choice(tpl.get("bp_lines", ["BP 结束，{team_a} 对阵 {team_b}"])).format(
        team_a=team_a,
        team_b=team_b,
        hero_a1=pick_hero(),
        hero_a2=pick_hero(),
        hero_b1=pick_hero(),
        hero_b2=pick_hero(),
        system_a=system_a,
        system_b=system_b,
        )
    hero_b_pool = [h for h in (hero_source.get("发育路") or tpl["heroes"].get("发育路") or ["戈娅"]) if h not in used]
    if not hero_b_pool:
        hero_b_pool = hero_source.get("发育路") or tpl["heroes"].get("发育路") or ["戈娅"]
    hero_b = rng.choice(hero_b_pool)
    used[hero_b] = 1
    loser = team_a if winner == team_b else team_b
    opening = rng.choice(tpl["openings"]).format(
        team_a=team_a, team_b=team_b, system=system_a, hero_b=hero_b,
        player_a=player, player_b=player,
    )
    events = rng.sample(tpl["events"], 3)
    def pick_objective(minute: int) -> str:
        pool = [o for o in OBJECTIVES if o != "风暴龙王" or minute >= 20]
        return rng.choice(pool)

    m1 = rng.randint(7, 12)
    m2 = rng.randint(13, 19)
    m3 = rng.randint(20, 26)
    mid1 = events[0].format(
        team=winner, player=player, opp=loser, minute=m1, objective=pick_objective(m1),
    )
    mid2 = events[1].format(
        team=winner, player=player, opp=loser, minute=m2, objective=pick_objective(m2),
    )
    mid3 = events[2].format(
        team=winner, player=player, opp=loser, minute=m3, objective=pick_objective(m3),
    )
    end_pool = [e for e in tpl["endings"] if (
        (not is_last or ("目前比分" not in e and "比分来到" not in e))
        and (is_last or "终结比赛" not in e)
    )]
    if comeback:
        comeback_pool = [c for c in tpl["comebacks"] if (
            ("巅峰对决" not in c or (peak_score >= 3 and tied_now and not is_last and score_a == peak_score))
            and (not any(x in c for x in ("让二追三", "让2追3")) or (is_last and ahead_now and max_deficit == 2))
            and (not any(x in c for x in ("让三追三", "让3追3")) or (tied_now and not is_last and max_deficit == 3))
            and ("连扳三局" not in c or ((tied_now or ahead_now) and max_deficit >= 3))
            and (not any(x in c for x in ("连扳两局", "连扳两城")) or ((tied_now or ahead_now) and max_deficit >= 2))
            and ("悬崖边上" not in c or max_deficit >= 2)
            and (not any(x in c for x in ("同一起跑线", "悬念重新拉回")) or tied_now)
        )]
        if comeback_pool:
            ending = rng.choice(comeback_pool).format(team_a=winner)
        else:
            ending = rng.choice(end_pool or tpl["endings"]).format(
                team_a=winner, team_b=loser, score_a=score_a, score_b=score_b,
            )
    else:
        ending = rng.choice(end_pool or tpl["endings"]).format(
            team_a=winner, team_b=loser, score_a=score_a, score_b=score_b,
        )
    # AG 彩蛋：请神梦老师，低概率偷家收尾
    steal_lines = tpl.get("steal_lines") or ["请神梦老师，{player}成功偷家"]
    if "AG" in winner and rng.random() < 0.12:
        steal_pool = steal_lines if is_last else [s for s in steal_lines if "终结比赛" not in s]
        ending = rng.choice(steal_pool or steal_lines).format(team_a=winner, player=player)
    line = f"第{game_no}局\nBP：{bp}\n开局：{opening}\n中期：{mid1}；{mid2}；{mid3}\n结束：{ending}"
    if tpl["meme_quotes"] and rng.random() < 0.15:
        meme = rng.choice(tpl["meme_quotes"]).format(team=winner, player=player)
        leads = tpl.get("scene_leads", {}).get("名场面", [""])
        lead = rng.choice(leads) if leads else ""
        line += f"\n{lead}{meme}" if lead else f"\n{meme}"
    return line


def franchise_names() -> dict[str, str]:
    franchises = load("franchises.json")["franchises"]
    out = {}
    for f in franchises:
        nbs = f.get("names_by_season") or {}
        if nbs:
            newest = sorted(nbs, reverse=True)[0]  # KPL2026S2 > KPL2019S1（前缀格式一致）
            out[f["franchise_id"]] = nbs[newest]
        else:
            cur = f.get("current_names") or []
            out[f["franchise_id"]] = cur[0] if cur else "?"
    return out


def place_text(round_name: str) -> str:
    """按淘汰轮次名推断止步名次（如 32强/16强/8强/4强/2强）。"""
    n = round_name or ""
    if "32强" in n:
        return "32强"
    if "16强" in n:
        return "16强"
    if "8强" in n:
        return "8强"
    if "双败" in n or "淘汰" in n:
        return "8强"  # 挑战者杯双败淘汰赛为 8 队阶段
    if "胜者组" in n or "败者组" in n:
        return "季后赛"  # engine 生成的双败轮次名，联赛不一定是 8 强阶段
    if "半决赛" in n:
        return "4强"
    if "决赛" in n or "总决赛" in n:
        return "2强"
    return "淘汰赛"


def render_result_card(custom: list[dict], path: list[dict], team: str, season_name: str, champion: str | None, pnames: dict[str, str], icons: dict[str, str]) -> str:
    """渲染可截图传播的战绩卡（自包含 HTML，手机优先）。"""
    def f1(v):
        return f"{v:.1f}" if isinstance(v, (int, float)) else "-"

    rows = []
    for r in custom:
        name = pnames.get(r["player_id"], r["player_id"])
        rows.append({
            "name": name,
            "position": r.get("position", ""),
            "icon": icons.get(r["player_id"], ""),
            "games": r.get("games"),
            "kda": r.get("avg_kda"),
            "kills": r.get("avg_kill_num"),
            "deaths": r.get("avg_death_num"),
            "assists": r.get("avg_assist_num"),
            "participation": r.get("avg_participation_rate"),
            "hurt_rate": r.get("avg_hurt_to_hero_total_rate"),
            "be_hurt_rate": r.get("avg_be_hurt_by_hero_total_rate"),
            "mvp": r.get("mvp_count"),
        })
    rounds_html = ""
    for p in path:
        tag = "胜" if p.get("win") else "负"
        cls = "w" if p.get("win") else "l"
        rounds_html += (
            f'<tr class="{cls}"><td>{p["round"]}</td><td>{p["opp"]}</td>'
            f'<td>{p["score"]}</td><td class="tag">{tag}</td></tr>'
        )
    cards_html = ""
    for r in rows:
        mvp_txt = f' · MVP {r["mvp"]}' if r.get("mvp") else ""
        first_char = r["name"][0]
        ava = (
            f'<img class="pava" src="{r["icon"]}" alt="" '
            f'onerror="this.outerHTML=&#39;<div class=&quot;pava&quot;>{first_char}</div>&#39;">'
            if r.get("icon") else f'<div class="pava">{first_char}</div>'
        )
        cards_html += (
            f'<div class="pc">{ava}'
            f'<div><div class="pnm">{r["name"]}<span class="ppos">{r["position"]}</span></div>'
            f'<div class="pstat">KDA {f1(r["kda"])} · 场均击杀 {f1(r["kills"])} · 参团 {r["participation"]:.1f}% · {r["games"]} 场{mvp_txt}</div></div></div>'
        )
    if champion == team:
        result = '<div class="res champ">🏆 冠军</div>'
    elif path and "决赛" in path[-1]["round"]:
        result = '<div class="res runner">亚军</div>'
    else:
        result = f'<div class="res elim">赛季止步 · {place_text(path[-1]["round"])}</div>'
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KPL 2K · 战绩卡</title>
<style>
:root{{--bg:#0b1a2e;--card:#12243f;--line:#1d3557;--fg:#e9f1fb;--mut:#8fa8cc;--gold:#f0b90b;--blue:#5da8ff;--green:#3fb950;--red:#f85149}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:16px;max-width:520px;margin:0 auto}}
h1{{font-size:20px;margin-bottom:2px}}
.sub{{color:var(--mut);font-size:12px;margin-bottom:14px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}}
h2{{font-size:14px;margin-bottom:10px;color:var(--gold)}}
.res{{font-size:18px;font-weight:700;text-align:center;padding:12px;border-radius:10px}}
.champ{{background:#0f2a1e;color:var(--green);border:1px solid #1f6f43}}
.runner{{background:#1f242e;color:var(--mut);border:1px solid #30363d}}
.elim{{background:#2d0f0f;color:var(--red);border:1px solid #8b3a3a}}
.pc{{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}}
.pc:last-child{{border-bottom:none}}
.pava{{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#58a6ff,#8b949e);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex:none}}
img.pava{{object-fit:cover}}
.pnm{{font-size:15px;font-weight:600}}
.ppos{{color:var(--mut);font-size:11px;margin-left:6px;font-weight:400}}
.pstat{{color:var(--mut);font-size:11px;margin-top:2px}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
td{{padding:7px 6px;border-bottom:1px solid var(--line)}}
tr.w td.tag{{color:var(--green);font-weight:600}}
tr.l td.tag{{color:var(--red);font-weight:600}}
td.tag{{text-align:center}}
.foot{{color:var(--mut);font-size:11px;text-align:center;margin-top:4px}}
</style>
</head>
<body>
<h1>KPL 2K · 战绩卡</h1>
<div class="sub">{season_name} · {team}</div>
<div class="card">{result}
  <h2 style="margin-top:12px">阵容</h2>
  {cards_html}
</div>
<div class="card"><h2>赛程</h2>
  <table>
    <tr><td><b>轮次</b></td><td><b>对手</b></td><td><b>比分</b></td><td><b>结果</b></td></tr>
    {rounds_html}
  </table>
</div>
<div class="card"><h2>选手数据</h2>
  <table>
    <tr><td><b>选手</b></td><td><b>KDA</b></td><td><b>击杀/死/助</b></td><td><b>参团</b></td><td><b>输出/承伤</b></td><td><b>MVP</b></td></tr>
    {''.join(
        f'<tr><td>{r["name"]}</td><td>{f1(r["kda"])}</td>'
        f'<td>{f1(r["kills"])}/{f1(r["deaths"])}/{f1(r["assists"])}</td>'
        f'<td>{r["participation"]:.1f}%</td>'
        f'<td>{(r["hurt_rate"] or 0)*100:.1f}% / {(r["be_hurt_rate"] or 0)*100:.1f}%</td>'
        f'<td>{r["mvp"] or "-"}</td></tr>'
        for r in rows)}
  </table>
</div>
<div class="foot">民间算法 · 平行时空 · KPL 2K</div>
</body>
</html>"""


def player_names() -> dict[str, str]:
    players = load("players.json")["players"]
    return {p["player_id"]: p["name"] for p in players}


def build_custom_roster(specs: list[tuple[str, str]]) -> list[dict]:
    players = load("players.json")["players"]
    records = load("player_season_stats.json")["records"]
    by_name = {p["name"]: p["player_id"] for p in players}
    out: list[dict] = []
    for name, season in specs:
        pid = by_name.get(name)
        if not pid:
            raise SystemExit(f"找不到选手：{name}")
        candidates = [season]
        if not season.startswith(("KPL", "KCC", "L")):
            candidates.append(f"KPL{season}")
        found = next((r for r in records if r["player_id"] == pid and r["season_id"] in candidates), None)
        if not found:
            raise SystemExit(f"找不到版本：{name} @ {season}")
        rec = dict(found)
        ov = load_overrides()
        rec["position"] = ov.get("positions", {}).get(pid, {}).get(found["season_id"], rec["position"])
        rec["team_franchise"] = ov.get("teams", {}).get(pid, {}).get(found["season_id"], rec["team_franchise"])
        out.append(rec)
    return out


def narrate_series(rng: random.Random, tpl: dict, na: str, nb: str, results: list[str], roster_a: list[dict], roster_b: list[dict], pnames: dict[str, str], bo: int | None = None, year: int | None = None) -> list[str]:
    lines: list[str] = []
    used_heroes: dict[str, int] = {}
    cur_a = cur_b = 0
    max_def_a = max_def_b = 0
    for idx, g in enumerate(results, start=1):
        before_a, before_b = cur_a, cur_b
        if g == "A":
            cur_a += 1
            win_team, win_roster, lose_team = na, roster_a, nb
        else:
            cur_b += 1
            win_team, win_roster, lose_team = nb, roster_b, na
        pname = pnames.get(win_roster[(idx - 1) % len(win_roster)]["player_id"], "选手") if win_roster else "选手"
        win_score, lose_score = (cur_a, cur_b) if win_team == na else (cur_b, cur_a)
        tied_now = cur_a == cur_b
        ahead_now = (cur_a > cur_b) if g == "A" else (cur_b > cur_a)
        max_deficit = max_def_a if g == "A" else max_def_b
        comeback = max_deficit > 0 and (tied_now or ahead_now)
        is_peak = bool(bo and bo >= 7 and len(results) >= bo and idx == len(results))
        lines.append(game_narration(
            rng, tpl, win_team, lose_team, win_team, win_score, lose_score, idx, pname,
            comeback, max_deficit, tied_now, ahead_now, idx == len(results), is_peak, (bo or 7) // 2, year, used_heroes,
        ))
        max_def_a = max(max_def_a, max(0, before_b - before_a), max(0, cur_b - cur_a))
        max_def_b = max(max_def_b, max(0, before_a - before_b), max(0, cur_a - cur_b))
    return lines


def _run_pairs(rng: random.Random, strengths: dict, pairs: list[list[str]], round_name: str, bo: int) -> tuple[list[str], list[dict]]:
    winners: list[str] = []
    log: list[dict] = []
    for pair in pairs:
        if len(pair) < 2 or not pair[0] or not pair[1]:
            if pair:
                winners.append(pair[0])
            continue
        w, sa, sb, results = play_match(rng, strengths, pair[0], pair[1], bo)
        winners.append(w)
        loser = pair[1] if w == pair[0] else pair[0]
        log.append({"round": round_name, "a": pair[0], "b": pair[1], "w": w,
                    "loser": loser, "sa": sa, "sb": sb, "results": results})
    return winners, log


def kpl_playoff10_py(rng: random.Random, strengths: dict, s6: list[str], a4: list[str], bo: int = 7) -> tuple[str, list[dict]]:
    """KPL 季后赛 10 队双败（12 场，与官方一致）：胜者组半决 2 → 败者组 R1 2 → 败者组 R2 2
    → 胜者组决赛 1 → 败者组 R3 2 → 败者组 R4（含胜者组决赛败者）1 → 败者组 R5 1 → 总决赛 1。"""
    log: list[dict] = []
    w2, log1 = _run_pairs(rng, strengths, [[s6[0], s6[3]], [s6[1], s6[2]]], "胜者组半决赛", bo)
    wl = [e["loser"] for e in log1]
    log.extend(log1)
    l2, log2 = _run_pairs(rng, strengths, [[a4[0], a4[3]], [a4[1], a4[2]]], "败者组第一轮", bo)
    log.extend(log2)
    l3, log3 = _run_pairs(rng, strengths, [[l2[0], s6[4]], [l2[1], s6[5]]], "败者组第二轮", bo)
    log.extend(log3)
    w_champ_list, log4 = _run_pairs(rng, strengths, [[w2[0], w2[1]]], "胜者组决赛", bo)
    log.extend(log4)
    w_out = log4[0]["loser"]
    l4, log5 = _run_pairs(rng, strengths, [[l3[0], wl[0]], [l3[1], wl[1]]], "败者组第三轮", bo)
    log.extend(log5)
    l5, log6 = _run_pairs(rng, strengths, [[l4[0], w_out]], "败者组第四轮", bo)
    log.extend(log6)
    l_champ, log7 = _run_pairs(rng, strengths, [[l5[0], l4[1]]], "败者组第五轮", bo)
    log.extend(log7)
    champ, log8 = _run_pairs(rng, strengths, [[w_champ_list[0], l_champ[0]]], "总决赛", bo)
    log.extend(log8)
    return champ[0], log


def simulate_kpl3_season(
    season_id: str, formats: dict, rosters: dict[str, list[dict]], rng: random.Random,
    names: dict[str, str], tpl: dict, override_rosters: dict[str, list[dict]] | None = None,
    chem: dict | None = None, track: str | None = None,
) -> tuple[str | None, list[str], list[dict], dict[str, int]]:
    """2021+ KPL 三轮常规赛动态晋级：第一轮官方赛程 → 升降分组 → 第二轮 → 卡位赛 → B 组淘汰 → 第三轮 → 季后赛 10 队双败。"""
    if override_rosters:
        rosters = {**rosters, **override_rosters}
    fmt = formats["seasons"].get(season_id)
    if not fmt:
        return None, [], [], {}, {}
    year_m = re.search(r"(20\d{2})", season_id)
    year = int(year_m.group(1)) if year_m else None
    reg_fmt = fmt.get("regular_format") or {}
    mode = reg_fmt.get("r2_mode") or "by_rank"
    strengths = {fid: team_strength(pick_starter(roster), chem) for fid, roster in rosters.items()}
    narrations: list[str] = []
    path: list[dict] = []
    pnames = player_names()
    losses: dict[str, int] = {}
    regular_wins: dict[str, int] = {}
    regular_games: dict[str, int] = {}
    regular_gf: dict[str, int] = {}
    regular_ga: dict[str, int] = {}

    rr = [r for r in fmt["rounds"] if r["type"] == "round_robin"]
    r1 = rr[0] if rr else None

    def record(a: str, b: str, winner: str, sa: int, sb: int) -> None:
        loser = b if winner == a else a
        losses[loser] = losses.get(loser, 0) + 1
        regular_wins[winner] = regular_wins.get(winner, 0) + 1
        for t, sc, osc in ((a, sa, sb), (b, sb, sa)):
            regular_games[t] = regular_games.get(t, 0) + 1
            regular_gf[t] = regular_gf.get(t, 0) + sc
            regular_ga[t] = regular_ga.get(t, 0) + osc

    def track_entry(a: str, b: str, winner: str, sa: int, sb: int, results: list[str], round_name: str, bo: int) -> None:
        if not track or track not in (a, b):
            return
        track_is_a = track == a
        opp = b if track_is_a else a
        opp_roster = pick_starter(rosters.get(opp, []))
        opp_players = [pnames.get(r["player_id"], r["player_id"]) for r in opp_roster] if opp_roster else []
        score_track, score_opp = (sa, sb) if track_is_a else (sb, sa)
        results_track = results if track_is_a else [("B" if g == "A" else "A") for g in results]
        na = names.get(a) or "A队"
        nb = names.get(b) or "B队"
        roster_a = pick_starter(rosters.get(a, []))
        roster_b = pick_starter(rosters.get(b, []))
        path.append({
            "round": round_name,
            "opp": names.get(opp) or "?",
            "opp_players": opp_players,
            "score": f"{score_track}:{score_opp}",
            "win": winner == track,
            "games": narrate_series(rng, tpl, na, nb, results, roster_a, roster_b, pnames, bo, year),
            "results": results_track,
        })

    def run_series(a: str, b: str, bo: int, round_name: str) -> tuple[str, int, int, list[str]]:
        w, sa, sb, results = play_match(rng, strengths, a, b, bo)
        record(a, b, w, sa, sb)
        track_entry(a, b, w, sa, sb, results, round_name, bo)
        return w, sa, sb, results

    def sort_by_rec(ids: list[str]) -> list[str]:
        return sorted(
            ids,
            key=lambda fid: (
                -regular_wins.get(fid, 0),
                regular_ga.get(fid, 0) - regular_gf.get(fid, 0),
                -strengths.get(fid, 50.0),
                fid,
            ),
        )

    def rr_schedule(ids: list[str]) -> list[list[str]]:
        return [[ids[i], ids[j]] for i in range(len(ids)) for j in range(i + 1, len(ids))]

    def group_names_of(ms: list[dict]) -> dict[str, list[str]]:
        gs: dict[str, list[str]] = {}
        for m in ms:
            for key, gk in (("a_id", "a_group"), ("b_id", "b_group")):
                if m.get(key) and m.get(gk):
                    gs.setdefault(str(m[gk]), []).append(m[key])
        for k in gs:
            gs[k] = list(dict.fromkeys(gs[k]))
        return gs

    groups: dict[str, list[str]] = {}
    if r1:
        groups = group_names_of(r1["matches"])
        bo1 = r1.get("bo") or 5
        for m in r1["matches"]:
            run_series(m["a_id"], m["b_id"], bo1, r1["name"])
        for g in groups:
            groups[g] = sort_by_rec(groups[g])

    # 第二轮分组
    if mode == "swap":
        s, a, b = groups.get("S", []), groups.get("A", []), groups.get("B", [])
        groups = {
            "S": s[:4] + a[:2],
            "A": s[4:] + a[2:4] + b[:2],
            "B": a[4:] + b[2:],
        }
    else:
        S, A, B = [], [], []
        for g in groups.values():
            r = sort_by_rec(g)
            S += r[0:2]
            A += r[2:4]
            B += r[4:6]
        groups = {"S": [t for t in S if t], "A": [t for t in A if t], "B": [t for t in B if t]}

    # 第二轮
    r2 = rr[1] if len(rr) > 1 else None
    r2_name = (r2 or {}).get("name") or "常规赛第二轮"
    bo2 = (r2 or {}).get("bo") or 5
    for g in groups:
        for p in rr_schedule(groups[g]):
            run_series(p[0], p[1], bo2, f"{r2_name}·{g}组")
    for g in groups:
        groups[g] = sort_by_rec(groups[g])

    # 卡位赛（S5/S6 vs A1/A2；A5/A6 vs B1/B2）
    pi = next((r for r in fmt["rounds"] if r["type"] == "play_in"), None)
    pi_name = (pi or {}).get("name") or "卡位赛"
    pi_bo = 7
    s, a, b = groups.get("S", []), groups.get("A", []), groups.get("B", [])
    pairs = [[s[4], a[1]], [s[5], a[0]], [a[4], b[1]], [a[5], b[0]]]
    s_win, a_fail, a_win = [], [], []
    for p in pairs:
        if len(p) < 2 or not p[0] or not p[1]:
            continue
        w, sa, sb, results = run_series(p[0], p[1], pi_bo, pi_name)
        if p in ([[s[4], a[1]], [s[5], a[0]]][0:2] if False else [[s[4], a[1]], [s[5], a[0]]]):
            s_win.append(w)
            a_fail.append(p[1] if w == p[0] else p[0])
        else:
            a_win.append(w)
    groups["S"] = sort_by_rec(s[:4] + s_win)
    groups["A"] = sort_by_rec(a[2:4] + a_fail + a_win)
    groups["B"] = []
    if track and track not in groups["S"] + groups["A"]:
        narrations.append(f"{names.get(track) or '本队'}在卡位赛后止步常规赛，无缘第三轮。")
        return None, narrations, path, losses, {}

    # 第三轮（B 组淘汰，只剩 S/A）
    r3 = rr[2] if len(rr) > 2 else None
    r3_name = (r3 or {}).get("name") or "常规赛第三轮"
    bo3 = (r3 or {}).get("bo") or 5
    for g in ("S", "A"):
        for p in rr_schedule(groups.get(g, [])):
            run_series(p[0], p[1], bo3, f"{r3_name}·{g}组")
    for g in ("S", "A"):
        groups[g] = sort_by_rec(groups.get(g, []))

    # 季后赛：S 组 6 + A 组前 4
    s6 = groups.get("S", [])
    a4 = groups.get("A", [])[:4]
    if track and track not in s6 + a4:
        narrations.append(f"{names.get(track) or '本队'}未能进入季后赛，赛季结束。")
        return None, narrations, path, losses, {}
    if len(s6) == 6 and len(a4) == 4:
        champion, log = kpl_playoff10_py(rng, strengths, s6, a4, 7)
        for e in log:
            if e.get("loser"):
                losses[e["loser"]] = losses.get(e["loser"], 0) + 1
            na = names.get(e["a"]) or "A队"
            nb = names.get(e["b"]) or "B队"
            narrations.extend(narrate_series(rng, tpl, na, nb, e["results"], pick_starter(rosters.get(e["a"], [])), pick_starter(rosters.get(e["b"], [])), pnames, None, year))
            track_entry(e["a"], e["b"], e["w"], e["sa"], e["sb"], e["results"], e["round"], 7)
        return champion, narrations, path, losses, {}
    return None, narrations, path, losses, {}


def simulate_season(season_id: str, formats: dict, rosters: dict[str, list[dict]], rng: random.Random, names: dict[str, str], tpl: dict, override_rosters: dict[str, list[dict]] | None = None, chem: dict | None = None, track: str | None = None) -> tuple[str | None, list[str], list[dict], dict[str, int]]:
    if override_rosters:
        rosters = {**rosters, **override_rosters}
    fmt = formats["seasons"].get(season_id)
    if not fmt:
        return None, [], [], {}, {}
    reg_fmt = fmt.get("regular_format") or {}
    if reg_fmt.get("type") == "kpl_3round":
        return simulate_kpl3_season(season_id, formats, rosters, rng, names, tpl, override_rosters, chem, track)
    year_m = re.search(r"(20\d{2})", season_id)
    year = int(year_m.group(1)) if year_m else None
    playoff_cfg = (fmt or {}).get("playoff_config") or {}
    elim_default = 1 if playoff_cfg.get("type") == "single_elim" else 2
    strengths = {fid: team_strength(pick_starter(roster), chem) for fid, roster in rosters.items()}
    narrations: list[str] = []
    path: list[dict] = []
    champion = None
    final_round = None
    pnames = player_names()
    losses: dict[str, int] = {}
    regular_wins: dict[str, int] = {}
    regular_games: dict[str, int] = {}
    regular_gf: dict[str, int] = {}
    regular_ga: dict[str, int] = {}
    elim_rounds: list[dict] = []  # 收集淘汰轮（单败/双败/季后赛/决赛）
    played_pairs: set[tuple[str, str]] = set()
    seed_notes: dict[str, list[str]] = {}

    for rnd in fmt["rounds"]:
        rtype = rnd["type"]
        if rtype in ("single_elim", "double_elim", "playoffs", "play_in", "final"):
            elim_rounds.append(rnd)
            continue
        # 常规赛/小组赛等非淘汰轮：按官方对阵模拟（战绩记录到 losses，仅展示用）
        for m in rnd["matches"]:
            a_id, b_id = m["a_id"], m["b_id"]
            bo = rnd["bo"] or (7 if rnd["type"] in ("playoffs", "play_in", "final", "single_elim", "double_elim") else 5)
            winner_id, score_a, score_b, game_results = play_match(rng, strengths, a_id, b_id, bo)
            loser_id = b_id if winner_id == a_id else a_id
            losses[loser_id] = losses.get(loser_id, 0) + 1
            regular_wins[winner_id] = regular_wins.get(winner_id, 0) + 1
            for _tid, _sc, _osc in ((a_id, score_a, score_b), (b_id, score_b, score_a)):
                regular_games[_tid] = regular_games.get(_tid, 0) + 1
                regular_gf[_tid] = regular_gf.get(_tid, 0) + _sc
                regular_ga[_tid] = regular_ga.get(_tid, 0) + _osc
            na = names.get(a_id) or m.get("a_name") or "A队"
            nb = names.get(b_id) or m.get("b_name") or "B队"
            roster_a = pick_starter(rosters.get(a_id, []))
            roster_b = pick_starter(rosters.get(b_id, []))
            if rtype in ("playoffs", "single_elim", "double_elim") and rng.random() < 0.2:
                pa = pnames.get(roster_a[0]["player_id"], "选手") if roster_a else "选手"
                system = rng.choice(SYSTEMS)
                hero_b = rng.choice(HERO_POOL.get("中路", ["王昭君"]))
                narrations.append(
                    f"{na} {score_a}:{score_b} {nb}——{na}用{system}克制{nb}的{hero_b}，{series_pace_text(rng, score_a, score_b)}。"
                )
            if track and track in (a_id, b_id):
                track_is_a = track == a_id
                opp = b_id if track_is_a else a_id
                opp_name = names.get(opp) or (m.get("a_name") if not track_is_a else m.get("b_name")) or "?"
                opp_roster = roster_b if track_is_a else roster_a
                opp_players = [pnames.get(r["player_id"], r["player_id"]) for r in opp_roster] if opp_roster else []
                score_track, score_opp = (score_a, score_b) if track_is_a else (score_b, score_a)
                results_track = game_results if track_is_a else [("B" if g == "A" else "A") for g in game_results]
                path.append({
                    "round": rnd["name"],
                    "opp": opp_name,
                    "opp_players": opp_players,
                    "score": f"{score_track}:{score_opp}",
                    "win": winner_id == track,
                    "games": narrate_series(rng, tpl, na, nb, game_results, roster_a, roster_b, pnames, bo, year),
                    "results": results_track,
                })

    # 常规赛排名：胜场为主，净胜局次之，强度兜底；仅用于种子剧情，不改官方淘汰树对位
    regular_rank: dict[str, int] = {}
    regular_info: dict[str, dict] = {}
    if regular_games:
        order = sorted(
            regular_games,
            key=lambda fid: (
                -regular_wins.get(fid, 0),
                regular_ga.get(fid, 0) - regular_gf.get(fid, 0),
                -strengths.get(fid, 50.0),
                fid,
            ),
        )
        for i, fid in enumerate(order, start=1):
            regular_rank[fid] = i
            regular_info[fid] = {
                "rank": i,
                "wins": regular_wins.get(fid, 0),
                "losses": regular_games[fid] - regular_wins.get(fid, 0),
                "games": regular_games[fid],
                "net": regular_gf[fid] - regular_ga[fid],
            }

    # 动态淘汰树：参赛名单取首个淘汰轮的官方对阵（种子顺序），
    # 之后晋级完全由模拟结果决定，不再遍历后续轮的官方固定对阵。
    # 淘汰树首轮只取 playoffs/single_elim/double_elim（play_in 卡位赛不算）
    tree_rounds = [r for r in elim_rounds if r["type"] in ("single_elim", "double_elim", "playoffs", "final")]
    if not tree_rounds:
        # 只有 play_in 的赛事（罕见）：按官方对阵跑
        for rnd in elim_rounds:
            for m in rnd["matches"]:
                a_id, b_id = m["a_id"], m["b_id"]
                bo = rnd.get("bo") or 7
                winner_id, score_a, score_b, game_results = play_match(rng, strengths, a_id, b_id, bo)
                na = names.get(a_id) or "A队"
                nb = names.get(b_id) or "B队"
                narrations.append(f"{na} {score_a}:{score_b} {nb}")
        # 无淘汰树则无冠军（沿用旧语义：返回 None）
    elif elim_rounds and tree_rounds:
        # play_in 卡位赛先按官方对阵跑（仅记录战绩，不参与动态树）
        for rnd in elim_rounds:
            if rnd["type"] != "play_in":
                continue
            for m in rnd["matches"]:
                a_id, b_id = m["a_id"], m["b_id"]
                bo = rnd.get("bo") or 7
                winner_id, score_a, score_b, game_results = play_match(rng, strengths, a_id, b_id, bo)
                loser_id = b_id if winner_id == a_id else a_id
                losses[loser_id] = losses.get(loser_id, 0) + 1
                na = names.get(a_id) or "A队"
                nb = names.get(b_id) or "B队"
                roster_a = pick_starter(rosters.get(a_id, []))
                roster_b = pick_starter(rosters.get(b_id, []))
                narrations.append(f"{na} {score_a}:{score_b} {nb}——{series_pace_text(rng, score_a, score_b)}。")
        first_round = tree_rounds[0]
        teams = []
        for m in first_round["matches"]:
            if m.get("a_id") not in teams:
                teams.append(m["a_id"])
            if m.get("b_id") not in teams:
                teams.append(m["b_id"])
        # 保留全部官方参赛队；无战力数据的青训/外卡队以默认强度 50 参赛
        for t in teams:
            if t not in strengths:
                strengths[t] = 50.0
        # 种子剧情：首轮对位 + 常规赛排名生成"签运"文本（仅叙事，不影响赛果）
        if regular_rank:
            seed_tpl = tpl.get("seed_lines") or {}
            first_pairs = [teams[i:i + 2] for i in range(0, len(teams), 2)]
            for pair in first_pairs:
                if len(pair) < 2:
                    continue
                a, b = pair
                ra, rb = regular_rank.get(a), regular_rank.get(b)
                if not ra or not rb:
                    continue
                low, high = (a, b) if ra > rb else (b, a)
                rl, rh = max(ra, rb), min(ra, rb)
                gap = rl - rh

                def seed_line(side: str, opp_side: str, rank_side: int, rank_opp: int) -> str:
                    if gap >= 2 and rank_side > rank_opp:
                        pool = seed_tpl.get("underdog") or []
                    elif gap >= 2 and rank_side < rank_opp:
                        pool = seed_tpl.get("favorite") or []
                    else:
                        pool = seed_tpl.get("neutral") or []
                    return rng.choice(pool).format(
                        team=names.get(side) or side,
                        opp=names.get(opp_side) or opp_side,
                        rank=rank_side,
                        opp_rank=rank_opp,
                    )

                if track in (a, b):
                    opp = b if track == a else a
                    line = seed_line(track, opp, regular_rank[track], regular_rank[opp])
                    seed_notes.setdefault(track, []).append(line)
                    narrations.append(line)
                elif gap >= 3:
                    line = seed_line(low, high, rl, rh)
                    seed_notes.setdefault(low, []).append(line)
                    narrations.append(line)
        single_rounds = [r for r in tree_rounds if r["type"] == "single_elim"]
        multi_rounds = [r for r in tree_rounds if r["type"] in ("double_elim", "playoffs", "final")]
        current = teams
        elim_log: list[dict] = []

        # 单败阶段：按官方轮次推进（32强打 1 轮到 16 队，16强打 1 轮到 8 队）
        for rnd in single_rounds:
            bo = rnd.get("bo") or 5
            winners = []
            round_log = []
            pairs = [current[i:i + 2] for i in range(0, len(current), 2)]
            for pair in pairs:
                if len(pair) < 2:
                    winners.append(pair[0])
                    continue
                w, sa, sb, results = play_match(rng, strengths, pair[0], pair[1], bo)
                winners.append(w)
                loser = pair[1] if w == pair[0] else pair[0]
                round_log.append({"round": rnd["name"], "a": pair[0], "b": pair[1], "w": w,
                                  "loser": loser, "sa": sa, "sb": sb, "results": results})
            elim_log.extend(round_log)
            current = winners
            if len(current) <= 1:
                break

        # 双败/季后赛/决赛
        if multi_rounds and len(current) > 1:
            bo = multi_rounds[0].get("bo") or 7
            final_bo = next((r.get("bo") for r in multi_rounds if r["type"] == "final"), None) or bo
            champ_of_round, log = dynamic_double_elim(rng, strengths, current, bo, final_bo)
            elim_log.extend(log)
            current = [champ_of_round]

        # 汇总淘汰赛战绩与 champion
        if current:
            champion = current[0]
        for e in elim_log:
            if e.get("loser"):
                losses[e["loser"]] = losses.get(e["loser"], 0) + 1
            if e.get("w"):
                na = names.get(e["a"]) or "A队"
                nb = names.get(e["b"]) or "B队"
                roster_a = pick_starter(rosters.get(e["a"], []))
                roster_b = pick_starter(rosters.get(e["b"], []))
                narrations.extend(narrate_series(rng, tpl, na, nb, e["results"], roster_a, roster_b, pnames, None, year))
                if track and track in (e["a"], e["b"]):
                    track_is_a = track == e["a"]
                    opp = e["b"] if track_is_a else e["a"]
                    opp_name = names.get(opp) or "?"
                    opp_roster = roster_b if track_is_a else roster_a
                    opp_players = [pnames.get(r["player_id"], r["player_id"]) for r in opp_roster] if opp_roster else []
                    score_track, score_opp = (e["sa"], e["sb"]) if track_is_a else (e["sb"], e["sa"])
                    results_track = e["results"] if track_is_a else [("B" if g == "A" else "A") for g in e["results"]]
                    path.append({
                        "round": e["round"],
                        "opp": opp_name,
                        "opp_players": opp_players,
                        "score": f"{score_track}:{score_opp}",
                        "win": e["w"] == track,
                        "games": narrate_series(rng, tpl, na, nb, e["results"], roster_a, roster_b, pnames, None, year),
                        "results": results_track,
                    })
    if champion:
        rank = sorted(strengths.values(), reverse=True)
        if strengths.get(champion, 0) <= rank[min(2, len(rank) - 1)]:
            narrations.append("冠军彩蛋：" + rng.choice(tpl["upsets"]).format(team_a=names.get(champion, "这支队伍")))
    regular_out = {
        "standings": regular_info,
        "track": regular_info.get(track) if track else None,
        "seed_notes": seed_notes.get(track, []) if track else [],
    }
    return champion, narrations, path, losses, regular_out


def main() -> None:
    global K, STRENGTH_NOISE, COMPRESS
    ap = argparse.ArgumentParser(description="KPL 2K 模拟引擎 v0")
    ap.add_argument("--season", default="KCC2026", help="赛季 id，默认 KCC2026（2026 挑战者杯）")
    ap.add_argument("--runs", type=int, default=200, help="模拟次数")
    ap.add_argument("--k", type=float, default=K, help="胜率曲线陡峭度")
    ap.add_argument("--noise", type=float, default=STRENGTH_NOISE, help="系列赛实力扰动")
    ap.add_argument("--compress", type=float, default=COMPRESS, help="实力压缩系数")
    ap.add_argument("--team", help="经典模式：替换某 franchise 的阵容（用 --roster-season 的该队首发）")
    ap.add_argument("--roster-season", default="KPL2026S1", help="阵容来源赛季，默认 2026 春季赛")
    ap.add_argument("--roster", help="自定义阵容：名:赛季;名:赛季（如 Fly:2023S1;小胖:2023S1）")
    ap.add_argument("--track", help="全流程追踪的 franchise（默认：被替换的队伍）")
    ap.add_argument("--story", action="store_true", help="把第一次模拟输出为互动性故事")
    args = ap.parse_args()

    K, STRENGTH_NOISE, COMPRESS = args.k, args.noise, args.compress

    rosters = season_rosters(args.season)
    formats = load("formats.json")
    names = franchise_names()
    tpl = load_templates()
    override: dict[str, list[dict]] = {}
    if args.team:
        base = season_rosters(args.roster_season)
        if args.team in base:
            override[args.team] = pick_starter(base[args.team])
            print(f"阵容替换：{names.get(args.team, args.team)} 使用 {args.roster_season} 首发")
        else:
            print(f"[warn] {args.team} 在 {args.roster_season} 无数据，忽略替换")
    if args.roster:
        specs = [tuple(part.split(":")) for part in args.roster.split(";") if part.strip()]
        custom = build_custom_roster(specs)
        fid = custom[0]["team_franchise"]
        if any(r["team_franchise"] != fid for r in custom):
            print("[warn] 自定义阵容含多个俱乐部，按第一人归属覆盖")
        override[fid] = custom
        print(f"自定义阵容：{args.roster} -> 覆盖 {names.get(fid, fid)}")
    track = args.track or (next(iter(override)) if override else None)
    counts: dict[str, int] = {}
    sample: list[str] = []
    sample_path: list[dict] = []
    champion_run0: str | None = None
    chem = chemistry.build_chem([r for lst in rosters.values() for r in lst] + [r for lst in override.values() for r in lst])
    if override:
        for fid, custom in override.items():
            eff, brk = chemistry.lineup_strength(custom, chem, COMPRESS)
            print(f"阵容强度：{names.get(fid, fid)} 战力={eff:.1f}（基础{brk['base']} 覆盖{brk['coverage']} 默契{brk['synergy']} 风格{brk['style']}）")
    real_champion = next(
        (s["champion_franchise"] for s in load("seasons.json")["seasons"] if s["season_id"] == args.season),
        None,
    )
    for i in range(args.runs):
        rng = random.Random(i)
        champion, narrations, path, losses, regular_out = simulate_season(args.season, formats, rosters, rng, names, tpl, override, chem, track)
        if champion:
            counts[champion] = counts.get(champion, 0) + 1
        if i == 0:
            sample = narrations[-4:]  # 总决赛逐局解说
            sample_path = path
            champion_run0 = champion

    print(f"赛季 {args.season}（真实冠军 franchise={real_champion}）：模拟 {args.runs} 次冠军分布（k={K}, noise={STRENGTH_NOISE}, compress={COMPRESS}）")
    for fid, c in sorted(counts.items(), key=lambda kv: -kv[1]):
        star = "  <-- 真实冠军" if fid == real_champion else ""
        print(f"  {names.get(fid, fid):<10} {c:>4} 次 ({c / args.runs:.0%}){star}")
    print("样本小局战报（第一次模拟）：")
    for line in sample:
        print(f"  {line}")
    if sample_path and track:
        print(f"全流程（{names.get(track, track)}，第一次模拟）：")
        for p in sample_path:
            print(f"  [{p['round']}] vs {p['opp']} {p['score']} {'胜' if p['win'] else '负'}")
            for g in p["games"][:2]:
                print(f"    {g}")
    if args.story and track and sample_path:
        season_name = next(
            (s["name"] for s in load("seasons.json")["seasons"] if s["season_id"] == args.season),
            args.season,
        )
        season_year = next(
            (s["year"] for s in load("seasons.json")["seasons"] if s["season_id"] == args.season),
            "",
        )
        roster_names = []
        custom_records: list[dict] = []
        if override:
            pnames = player_names()
            for fid, custom in override.items():
                roster_names = [pnames.get(r["player_id"], r["player_id"]) for r in custom]
                custom_records = custom
        elif track in rosters:
            pnames = player_names()
            roster_names = [pnames.get(r["player_id"], r["player_id"]) for r in pick_starter(rosters[track])]
        ctx = {
            "season_name": season_name,
            "year": season_year,
            "team": names.get(track, track),
            "roster": roster_names,
            "champion": names.get(champion_run0, champion_run0) if champion_run0 else None,
            "path": sample_path,
            "regular": regular_out,
        }
        tpl_n = narrative.load_templates()
        flavor = narrative.load_flavor()
        rng = random.Random(0)
        print("\n========== 赛季故事（互动性结构：intro/round/final/epilogue）==========")
        narrative.print_story(narrative.build_story(rng, tpl_n, flavor, ctx))
        # 战绩卡（可截图传播）
        if custom_records:
            players_all = load("players.json")["players"]
            icons = {p["player_id"]: p.get("player_icon", "") for p in players_all}
            card = render_result_card(
                custom_records, sample_path, names.get(track, track),
                season_name, names.get(champion_run0, champion_run0) if champion_run0 else None,
                player_names(), icons,
            )
            card_path = ROOT / "app" / "result_card.html"
            card_path.write_text(card, encoding="utf-8")
            print(f"\n战绩卡已生成：{card_path}")


if __name__ == "__main__":
    main()
