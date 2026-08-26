"""KPL 2K 数据清洗 v0.1

读取 data/raw（smoba 官方接口原始 JSON），产出 data/processed：
- seasons.json：赛事/赛季元信息 + 冠军/亚军（决赛反推）
- players.json：选手主档（openid 为唯一键）
- player_season_stats.json：选手-赛季统计 + 评分草稿
- franchises_draft.json：俱乐部稳定 ID → 名称/缩写/出现赛季（改名映射草稿，待人工校对）

用法：
  python tools/clean_kpl.py
"""

from __future__ import annotations

import json
import bisect
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
DATA_VERSION = "2026-08-15"

# 评分 v2：分路差异化权重（依据 KPL 各分路职责与社区数据讨论整理）
POS_WEIGHTS = {
    # 对抗路：核心是单带/切后/输出，参团率对单带边路天然偏低，移出权重
    "对抗路": {"kills": 0.25, "hurt_rate": 0.22, "kda": 0.18, "towers": 0.15, "mvp": 0.12, "be_hurt_rate": 0.08},
    "打野": {"kills": 0.30, "participation": 0.20, "kda": 0.15, "gold_rate": 0.15, "hurt_rate": 0.10, "towers": 0.10, "mvp": 0.12},
    # 中路：伤害转化降权（吃资源大核天然转化率低），输出/击杀/KDA 提权；
    # v4 加入工具人维度（助攻/承伤）——蓝领工具人中单参团高、承伤多，不再只看输出
    "中路": {"damage_convert": 0.15, "hurt_rate": 0.18, "kills": 0.15, "kda": 0.15, "participation": 0.15, "assists": 0.10, "be_hurt_rate": 0.05, "mvp": 0.12, "gpm": 0.05},
    "发育路": {"gold_rate": 0.25, "hurt_rate": 0.25, "kills": 0.20, "kda": 0.15, "participation": 0.15, "mvp": 0.08},
    "游走": {"participation": 0.35, "be_hurt_rate": 0.25, "assists": 0.20, "kda": 0.15, "towers": 0.05, "mvp": 0.08},
}
METRIC_FIELD = {
    "kda": "avg_kda",
    "kills": "avg_kill_num",
    "assists": "avg_assist_num",
    "gpm": "avg_gpm",
    "participation": "avg_participation_rate",
    "gold_rate": "avg_gold_rate",
    "hurt_rate": "avg_hurt_to_hero_total_rate",
    "be_hurt_rate": "avg_be_hurt_by_hero_total_rate",
    "damage_convert": "avg_damage_convert_rate",
    "towers": "avg_push_tower_num",
    "mvp": "mvp_per_game",
}
MIN_GAMES = 10   # 百分位池构建门槛：只用 >=10 场的选手，保证分布稳定
RATE_MIN_GAMES = 5  # 评分门槛：5 场即可参与评分，小样本靠对数折扣自然降权

# 传奇小样本例外：职业生涯跨度过长/早期样本不足的选手，允许用更少场次参与评分
# （仍走同一套分路权重 + 出场数对数折扣，不做历史地位加成）
LEGEND_MIN_GAMES = {
    "43062C3D029AD48A789256BE11349345": 4,  # 梦泪：2019KPL秋季赛仅 4 场
}


def min_games_for(player_id: str) -> int:
    return LEGEND_MIN_GAMES.get(player_id, RATE_MIN_GAMES)


def load_raw(name: str) -> dict | None:
    p = RAW / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def load_overrides() -> dict:
    p = ROOT / "data" / "overrides" / "player_versions.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def load_attribution() -> dict:
    p = OUT / "player_attribution.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def season_final_winner(matches: list[dict]) -> tuple[str | None, str | None]:
    finals = [
        m for m in matches
        if "决赛" in (m.get("match_stage_desc") or "") or "final" in (m.get("match_stage_name") or "").lower()
    ]
    if finals:
        match = finals[-1]
    else:
        playoffs = [
            m for m in matches
            if "季后赛" in (m.get("match_stage_desc") or "") or m.get("match_stage_name") in ("playoffs", "postseason")
        ]
        pool = playoffs if playoffs else matches  # 多数 KPL 赛季全赛程标记为"常规赛"，决赛即时间最晚的一场
        if not pool:
            return None, None
        match = max(pool, key=lambda m: m.get("start_time") or "")
    c1, c2 = match.get("camp1", {}), match.get("camp2", {})
    winner = c1 if c1.get("is_win") else c2
    runner = c2 if c1.get("is_win") else c1
    return winner.get("team_id"), runner.get("team_id")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    leagues = (load_raw("leagues.json") or {}).get("results", [])
    seasons: list[dict] = []
    players: dict[str, dict] = {}
    stats: list[dict] = []
    franchises: dict[str, dict] = {}
    for lg in leagues:
        lid = str(lg["league_id"])
        players_raw = load_raw(f"league_{lid}_players.json")
        matches_raw = load_raw(f"league_{lid}_matches.json")
        if not players_raw or not matches_raw:
            continue

        season_id = lg.get("cc_league_id") or f"L{lid}"
        season = {
            "schema_version": "0.1",
            "data_version": DATA_VERSION,
            "league_id": lid,
            "season_id": season_id,
            "name": lg.get("league_name"),
            "year": lg.get("year"),
            "league_type": lg.get("league_type_name"),
            "start_time": (lg.get("start_time") or "")[:10],
            "end_time": (lg.get("end_time") or "")[:10],
            "status": lg.get("status"),
        }
        league_name = lg.get("league_name") or ""
        # 进行中但数据已全量爬取的赛季也算战场（如 KPL2026S2，赛程/比分已齐）
        FORCE_BATTLEFIELD = {"KPL2026S2"}
        season["is_battlefield"] = (
            (lg.get("status") == 2 or season_id in FORCE_BATTLEFIELD)
            and not any(key in league_name for key in ("选拔", "赛前", "预选", "季前"))
        )
        champion, runner = (
            (None, None)
            if lg.get("status") != 2
            else season_final_winner(matches_raw.get("results") or [])
        )
        season["champion_franchise"] = champion
        season["runner_up_franchise"] = runner
        seasons.append(season)

        for rec in players_raw.get("data") or []:
            info = rec.get("player_info") or {}
            st = rec.get("statistics_info") or {}
            pid = info.get("openid")
            if not pid:
                continue
            pos = info.get("position_desc") or str(info.get("position") or "")
            pl = players.setdefault(pid, {
                "player_id": pid,
                "name": info.get("player_name", ""),
                "real_name": info.get("real_name", ""),
                "positions": set(),
                "teams": {},
                "player_icon": info.get("player_icon", ""),
            })
            if pos:
                pl["positions"].add(pos)
            pl["teams"][season_id] = info.get("team_id")
            stats.append({
                "player_id": pid,
                "season_id": season_id,
                "league_id": lid,
                "team_franchise": info.get("team_id"),
                "team_name_current": info.get("team_name", ""),
                "position": pos,
                "is_captain": info.get("is_captain", 0),
                "games": st.get("battle_count", 0),
                "win_rate": st.get("win_rate"),
                "avg_kda": st.get("avg_kda"),
                "avg_kill_num": st.get("avg_kill_num"),
                "avg_death_num": st.get("avg_death_num"),
                "avg_assist_num": st.get("avg_assist_num"),
                "avg_gold": st.get("avg_gold"),
                "avg_gpm": st.get("avg_gpm"),
                "avg_per_min_hurt_total": st.get("avg_per_min_hurt_total"),
                "avg_participation_rate": st.get("avg_participation_rate"),
                "avg_gold_rate": st.get("avg_gold_rate"),
                "avg_hurt_to_hero_total_rate": st.get("avg_hurt_to_hero_total_rate"),
                "avg_be_hurt_by_hero_total_rate": st.get("avg_be_hurt_by_hero_total_rate"),
                "avg_damage_convert_rate": st.get("avg_damage_convert_rate"),
                "avg_push_tower_num": st.get("avg_push_tower_num"),
            })

        for match in matches_raw.get("results") or []:
            for camp in (match.get("camp1"), match.get("camp2")):
                tid = camp.get("team_id")
                if not tid:
                    continue
                f = franchises.setdefault(tid, {
                    "franchise_id": tid,
                    "names": set(),
                    "abbreviations": set(),
                    "seasons": set(),
                })
                if camp.get("team_name"):
                    f["names"].add(camp["team_name"])
                if camp.get("team_abbreviation"):
                    f["abbreviations"].add(camp["team_abbreviation"])
                f["seasons"].add(season_id)

    # 补齐榜单缺失选手（如 2019 秋 FMVP 老帅不在官方选手榜）：用 battle 统计合成
    attribution = load_attribution()
    settle_name_set = {
        (s["season_id"], players.get(s["player_id"], {}).get("name", ""))
        for s in stats
    }
    season_to_league = {s["season_id"]: s["league_id"] for s in seasons}
    battle_added = 0
    for rec in attribution.get("records", []):
        sid, name = rec["season_id"], rec["player_name"]
        if (sid, name) in settle_name_set or (rec["games"] or 0) < MIN_GAMES:
            continue
        pid = f"BTL{name}"
        pl = players.setdefault(pid, {
            "player_id": pid,
            "name": name,
            "real_name": "",
            "positions": set(),
            "teams": {},
            "player_icon": "",
        })
        if rec.get("position"):
            pl["positions"].add(rec["position"])
        pl["teams"][sid] = rec.get("team_franchise")
        stats.append({
            "player_id": pid,
            "season_id": sid,
            "league_id": season_to_league.get(sid, ""),
            "team_franchise": rec.get("team_franchise"),
            "team_name_current": "",
            "position": rec.get("position"),
            "is_captain": 0,
            "games": rec["games"],
            "win_rate": None,
            "avg_kda": rec.get("avg_kda"),
            "avg_kill_num": rec.get("avg_kill_num"),
            "avg_death_num": rec.get("avg_death_num"),
            "avg_assist_num": rec.get("avg_assist_num"),
            "avg_gold": None,
            "avg_gpm": rec.get("avg_gpm"),
            "avg_per_min_hurt_total": rec.get("avg_dpm"),
            "avg_participation_rate": rec.get("avg_participation_rate"),
            "avg_gold_rate": None,
            "avg_hurt_to_hero_total_rate": rec.get("avg_hurt_rate"),
            "avg_be_hurt_by_hero_total_rate": rec.get("avg_be_hurt_rate"),
            "avg_damage_convert_rate": None,
            "avg_push_tower_num": None,
            "mvp_count": rec.get("mvp_count", 0),
        })
        battle_added += 1
    if battle_added:
        print(f"battle-only players added: {battle_added} 条（榜单缺失选手补齐）")

    # 归属修正：先 battle 归因（数据驱动），再人工覆盖（最高优先级），随后才评分
    attr_by_key = {
        (r["season_id"], r["player_name"]): r
        for r in attribution.get("records", [])
    }
    name_by_pid = {pid: pl["name"] for pid, pl in players.items()}
    attr_applied = 0
    for s in stats:
        attr = attr_by_key.get((s["season_id"], name_by_pid.get(s["player_id"], "")))
        s["mvp_count"] = int(attr.get("mvp_count") or 0) if attr else 0
        if attr:
            if attr.get("team_franchise"):
                s["team_franchise"] = attr["team_franchise"]
            if attr.get("position"):
                s["position"] = attr["position"]
            attr_applied += 1
    if attr_applied:
        print(f"attribution applied: {attr_applied} 条归属修正")

    overrides = load_overrides()
    pos_overrides = overrides.get("positions", {})
    team_overrides = overrides.get("teams", {})
    applied = 0
    for s in stats:
        pos = pos_overrides.get(s["player_id"], {}).get(s["season_id"])
        if pos:
            s["position"] = pos
            applied += 1
        team = team_overrides.get(s["player_id"], {}).get(s["season_id"])
        if team:
            s["team_franchise"] = team
    if applied:
        print(f"overrides applied: {applied} 条位置修正")

    for s in stats:
        s["mvp_per_game"] = round((s.get("mvp_count") or 0) / s["games"], 4) if s["games"] else None

    # 评分 v2：分赛季×分位置百分位 + 分路权重 + 出场数对数折扣（无荣誉加成）
    # 评分 v3：分赛季标准化（z-score）后再跨赛季比较。
    # 每项指标先在"当季同位置"内归一（减中位数 ÷ IQR），消除版本漂移
    # （如 2019 发育路整体弱、2025 打野击杀普遍低），
    # 再用"全历史同位置 z 池"算百分位，兼顾跨赛季可比与版本公平。
    season_raw: dict[tuple[str, str, str], list[float]] = {}   # (season,pos,metric)->原始值
    season_pos_n: dict[tuple[str, str], int] = {}              # (season,pos)->人数
    for s in stats:
        if s["games"] < MIN_GAMES or s["position"] not in POS_WEIGHTS:
            continue
        pos = s["position"]
        spn = season_pos_n.setdefault((s["season_id"], pos), 0)
        season_pos_n[(s["season_id"], pos)] = spn + 1
        for m in POS_WEIGHTS[pos]:
            v = s[METRIC_FIELD[m]]
            if isinstance(v, (int, float)):
                season_raw.setdefault((s["season_id"], pos, m), []).append(v)

    # 赛季参数：中位数 + IQR（稳健尺度，抗离群）
    season_param: dict[tuple[str, str, str], tuple[float, float]] = {}
    for key, vals in season_raw.items():
        q = sorted(vals)
        med = q[len(q) // 2] if len(q) % 2 else (q[len(q)//2 - 1] + q[len(q)//2]) / 2
        q1 = q[len(q) // 4]
        q3 = q[(3 * len(q)) // 4]
        iqr = (q3 - q1) / 1.349 if q3 > q1 else 1e-9
        season_param[key] = (med, iqr if iqr > 0 else 1e-9)

    # 全历史 z 池（同位置同指标）+ 全历史原始池（小样本赛季回退用）
    all_z_pool: dict[tuple[str, str], list[float]] = {}
    all_raw_pool: dict[tuple[str, str], list[float]] = {}
    for s in stats:
        if s["games"] < MIN_GAMES or s["position"] not in POS_WEIGHTS:
            continue
        pos = s["position"]
        for m in POS_WEIGHTS[pos]:
            v = s[METRIC_FIELD[m]]
            if not isinstance(v, (int, float)):
                continue
            all_raw_pool.setdefault((pos, m), []).append(v)
            med, iqr = season_param.get((s["season_id"], pos, m), (0.0, 1e-9))
            z = (v - med) / iqr
            all_z_pool.setdefault((pos, m), []).append(z)

    for s in stats:
        pos = s["position"]
        if s["games"] < min_games_for(s["player_id"]) or pos not in POS_WEIGHTS:
            s["rating"] = 50.0
            s["rating_components"] = {}
            continue
        small_season = season_pos_n.get((s["season_id"], pos), 0) < 10
        available = []
        for m, w in POS_WEIGHTS[pos].items():
            v = s[METRIC_FIELD[m]]
            if not isinstance(v, (int, float)):
                continue
            if small_season:
                if all_raw_pool.get((pos, m)):
                    available.append((m, w, v, all_raw_pool[(pos, m)]))
            else:
                if all_z_pool.get((pos, m)):
                    med, iqr = season_param.get((s["season_id"], pos, m), (0.0, 1e-9))
                    z = (v - med) / iqr
                    available.append((m, w, z, all_z_pool[(pos, m)]))
        if not available:
            s["rating"] = 50.0
            s["rating_components"] = {}
            continue
        wsum = sum(w for _, w, _, _ in available)
        score = 0.0
        comps: dict[str, float] = {}
        for m, w, val, pool_vals in available:
            vals = sorted(pool_vals)
            pct = bisect.bisect_right(vals, val) / len(vals)
            score += w * pct / wsum
            comps[m] = round(w * pct * 100, 1)
        factor = min(1.0, math.log(1 + s["games"]) / math.log(21))  # 5场≈0.59，20场≈1.0 封顶
        s["rating"] = round(50 + 49 * score * factor, 1)
        s["rating_components"] = {"metrics": comps, "sample": round(factor, 2)}

    # 人气/荣誉战力校准：评分后应用 overrides.ratings（明星高光版本上调、数据虚高版本回调）
    rating_overrides = overrides.get("ratings", {})
    r_applied = 0
    for s in stats:
        v = rating_overrides.get(s["player_id"], {}).get(s["season_id"])
        if v is not None:
            s["rating"] = float(v)
            r_applied += 1
    if r_applied:
        print(f"rating overrides applied: {r_applied} 条战力校准")

    # 冠军赛季隐性补偿：当季冠军队伍成员 +2.5（在校准之后叠加，保证一诺等手动校准版本也能上浮；不对外明示"荣誉"）
    champ_fid = {s["season_id"]: s.get("champion_franchise") for s in seasons}
    c_applied = 0
    for s in stats:
        if champ_fid.get(s["season_id"]) and champ_fid[s["season_id"]] == s["team_franchise"]:
            s["rating"] = round(float(s["rating"]) + 2.5, 1)
            c_applied += 1
    if c_applied:
        print(f"champion bonus applied: {c_applied} 条冠军赛季补偿")

    def dump(name: str, obj) -> None:
        (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")

    # The raw player profile exposes only the latest/retirement position. Use
    # the corrected season records as the source of truth so role switchers
    # remain selectable at every position they actually played.
    final_positions: dict[str, set[str]] = {}
    for s in stats:
        if s.get("position") in POS_WEIGHTS:
            final_positions.setdefault(s["player_id"], set()).add(s["position"])
    for pid, pl in players.items():
        pl["positions"] = sorted(final_positions.get(pid, pl["positions"]))
    for f in franchises.values():
        f["names"] = sorted(f["names"])
        f["abbreviations"] = sorted(f["abbreviations"])
        f["seasons"] = sorted(f["seasons"])

    dump("seasons.json", {"schema_version": "0.1", "data_version": DATA_VERSION, "seasons": seasons})
    dump("players.json", {"schema_version": "0.1", "data_version": DATA_VERSION, "players": list(players.values())})
    dump("player_season_stats.json", {"schema_version": "0.1", "data_version": DATA_VERSION, "records": stats})
    dump("franchises_draft.json", {
        "schema_version": "0.1",
        "data_version": DATA_VERSION,
        "note": "smoba 俱乐部稳定 ID 草稿；显示名为当前名，历史改名映射待用 kpl.qq.com 赛季战队表对齐",
        "franchises": sorted(franchises.values(), key=lambda f: f["franchise_id"]),
    })

    print(f"seasons: {len(seasons)}")
    print(f"players: {len(players)}")
    print(f"player_season_records: {len(stats)}")
    print(f"franchises(draft): {len(franchises)}")
    print("各赛季冠军（franchise_id + 缩写，供核对）：")
    for s in seasons:
        if not s.get("is_battlefield"):
            continue
        ch = s["champion_franchise"]
        abbr = ""
        if ch and ch in franchises:
            abbr = "/".join(sorted(franchises[ch]["abbreviations"])[:2])
        print(f"  {s['season_id']:<12} {s['name']}: {ch} ({abbr})")

    top = sorted(
        [s for s in stats if s["league_id"] == "20190001"],
        key=lambda s: s["rating"],
        reverse=True,
    )[:12]
    print("2019 春季赛评分前 12：")
    for s in top:
        name = players.get(s["player_id"], {}).get("name", "?")
        print(f"  {name:>8} {s['position']:<6} rating={s['rating']:<6} kda={s['avg_kda']} wr={s['win_rate']}")


if __name__ == "__main__":
    main()
