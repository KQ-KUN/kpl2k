"""KPL 2K Web 数据构建 v1

把 processed 数据切成手机友好的静态分片（供浏览器端引擎 + UI 使用）：
  app/data/manifest.json        赛季清单 + 2026 战队
  app/data/base.json            franchise/选手/叙事/覆盖表（首屏小包）
  app/data/seasons/{sid}.json   赛制 + 当季选手记录 + 组合胜率（按赛季加载）
  app/data/teams/{fid}.json     该队历届选手版本卡（组队换人用）

用法：
  python tools/build_web.py
"""

from __future__ import annotations

import json
import pathlib
import re
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"
NARR = ROOT / "data" / "narrative"
OUT = ROOT / "app" / "data"

# 王朝战队预设：真实历史主力五人组；版本取王朝年代赛季（若该赛季无记录则就近回退），
# 该选手当年战力差的部分由该赛季真实同场默契 + 组合胜率化学补偿
DYNASTIES = [
    {"id": "2019qg", "label": "19QG 王朝", "team_fid": "10001", "desc": "2019 秋冠，Fly 时代起点",
     "season": "L20190004", "players": ["Fly", "Hurt", "Mojo", "Giao", "770"]},
    {"id": "2019estar", "label": "19eStar 五虎", "team_fid": "10006", "desc": "2019 双冠，诺言花海 Cat",
     "season": "L20190003", "players": ["诺言", "花海", "Cat", "Alan", "无铭"]},
    {"id": "2020dyg", "label": "20DYG 大魔王", "team_fid": "10008", "desc": "2020 秋冠，清清久诚易峥",
     "season": "KPL2020S2", "players": ["清清", "小义", "久诚", "易峥", "星宇"]},
    {"id": "2021hero", "label": "21Hero 双冠", "team_fid": "10007", "desc": "20冬+21春，星痕无畏清融",
     "season": "KPL2021S1", "players": ["星痕", "无畏", "清融", "久酷", "子阳"]},
    {"id": "2021ttg", "label": "21TTG 无冕", "team_fid": "10017", "desc": "巅峰亚军五虎，通天边路清清",
     "season": "KPL2021S2", "players": ["清清", "不然", "九尾", "钎城", "冰尘"]},
    {"id": "2022estar", "label": "22eStar 王朝", "team_fid": "10006", "desc": "21-22 六连决赛五夺冠",
     "season": "KPL2022S1", "players": ["坦然", "花海", "清融", "易峥", "子阳"]},
    {"id": "2023wolf", "label": "23狼队王朝", "team_fid": "10001", "desc": "2023 春+世冠，胖鱼刀帆",
     "season": "KPL2023S1", "players": ["Fly", "小胖", "向鱼", "妖刀", "帆帆"]},
    {"id": "2024ag", "label": "24-25AG 红色王朝", "team_fid": "10027", "desc": "九连决赛 · 六连冠",
     "season": "KPL2024S1", "players": ["轩染", "钟意", "长生", "一诺", "大帅"]},
    {"id": "2026ksg", "label": "26KSG 新王", "team_fid": "10005", "desc": "2026 春冠，4:0 横扫狼队，队史首冠",
     "season": "KPL2026S1", "players": ["无言", "句号", "流浪", "小屿", "一笙"]},
    {"id": "2026wolf", "label": "26狼队", "team_fid": "10001", "desc": "2026 挑战者杯冠军，队史十一冠",
     "season": "KCC2026", "players": ["清清", "皖皖", "紫幻", "道崽", "信"]},
]

ROSTER_KEEP = [
    "player_id", "season_id", "team_franchise", "position", "games", "win_rate",
    "avg_kda", "avg_kill_num", "avg_death_num", "avg_assist_num", "avg_gpm",
    "avg_participation_rate", "avg_hurt_to_hero_total_rate",
    "avg_be_hurt_by_hero_total_rate", "avg_damage_convert_rate",
    "avg_push_tower_num", "mvp_count", "rating",
]


def load(name: str, base: pathlib.Path = PROC) -> dict:
    return json.loads((base / name).read_text(encoding="utf-8"))


def dump(obj: dict, path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    formats = load("formats.json")
    players = load("players.json")["players"]
    records = load("player_season_stats.json")["records"]
    library = load("player_library.json")["players"]
    franchises = load("franchises.json")["franchises"]
    pair_win = load("pair_win.json").get("pair_win", {})
    ov = json.loads((ROOT / "data" / "overrides" / "player_versions.json").read_text(encoding="utf-8"))

    # ---- 1. base.json ----
    name_by_id = {p["player_id"]: p["name"] for p in players}
    icon_by_id = {p["id"].split("@")[0]: p["icon"] for p in library if p.get("icon")}
    players_min = {
        p["player_id"]: {
            "name": p["name"],
            "positions": p.get("positions", []),
            "icon": icon_by_id.get(p["player_id"], ""),
        }
        for p in players
    }
    franchises_min = [
        {
            "id": f["franchise_id"],
            "name": (f.get("current_names") or ["?"])[0],
            "abbr": (f.get("abbreviations") or [""])[0],
            "names_by_season": f.get("names_by_season") or {},
        }
        for f in franchises
    ]
    templates = json.loads((NARR / "templates.json").read_text(encoding="utf-8"))
    templates["heroes_pool"] = json.loads((NARR / "heroes_pool.json").read_text(encoding="utf-8"))
    base = {
        "franchises": franchises_min,
        "players": players_min,
        "narrative": {
            "templates": templates,
            "player_flavor": json.loads((NARR / "player_flavor.json").read_text(encoding="utf-8")),
            "team_flavor": json.loads((NARR / "team_flavor.json").read_text(encoding="utf-8")),
            "rivalries": json.loads((NARR / "rivalry_flavor.json").read_text(encoding="utf-8")),
            "heroes_pool": json.loads((NARR / "heroes_pool.json").read_text(encoding="utf-8")),
        },
        "overrides": ov,
    }
    dump(base, OUT / "base.json")

    # ---- 2. 按赛季记录 + pair_win ----
    by_season: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        by_season[r["season_id"]].append({k: r.get(k) for k in ROSTER_KEEP})

    pair_by_season: dict[str, dict[str, dict[str, dict]]] = defaultdict(lambda: defaultdict(dict))
    for key, rec in pair_win.items():
        parts = key.split("|")
        if len(parts) != 4:
            continue
        sid, tid, n1, n2 = parts
        pair_by_season[sid][tid][f"{n1}|{n2}"] = {"w": rec["wins"], "g": rec["games"]}

    for sid, fmt in formats["seasons"].items():
        rounds_min = [
            {
                "name": r["name"],
                "type": r["type"],
                "bo": r.get("bo"),
                "matches": [
                    {"a_id": m["a_id"], "b_id": m["b_id"], "ts": m.get("ts")}
                    for m in r.get("matches", [])
                ],
            }
            for r in fmt["rounds"]
        ]
        dump({
            "season_id": sid,
            "name": fmt["name"],
            "source": fmt.get("source", ""),
            "playoff_config": fmt.get("playoff_config") or {},
            "teams_by_group": fmt.get("teams_by_group") or {},
            "rounds": rounds_min,
            "rosters": by_season.get(sid, []),
            "pair_win": pair_by_season.get(sid, {}),
        }, OUT / "seasons" / f"{sid}.json")

    # ---- 3. 战队版本卡分片（选手×战队，版本补 season_id）----
    rec_by_pid = defaultdict(list)
    for r in records:
        rec_by_pid[r["player_id"]].append(r)

    def version_season(pid: str, team_fid: str, year: int) -> str | None:
        """该选手在该队当年 games 最多的正式赛季，作为版本的代表 season_id。"""
        best, best_g = None, -1
        for r in rec_by_pid.get(pid, []):
            if r["team_franchise"] != team_fid:
                continue
            m = re.search(r"(20\d{2})", r["season_id"])
            if not m or int(m.group(1)) != year:
                continue
            g = r.get("games") or 0
            if g > best_g:
                best, best_g = r["season_id"], g
        return best

    by_team: dict[str, dict] = defaultdict(lambda: {"name": "", "abbr": "", "players": []})
    name_by_fid = {f["franchise_id"]: (f.get("current_names") or ["?"])[0] for f in franchises}
    abbr_by_fid = {f["franchise_id"]: (f.get("abbreviations") or [""])[0] for f in franchises}
    for p in library:
        fid = p.get("team_fid")
        if not fid:
            continue
        versions = []
        for v in p.get("versions", []):
            sid = version_season(p["id"].split("@")[0], fid, v.get("year"))
            if not sid:
                continue
            versions.append({
                "season_id": sid,
                "year": v["year"],
                "label": v["season_label"],
                "position": v["position"],
                "rating": v["rating"],
                "peak": bool(v.get("peak")),
                "games": v["games"],
                "kda": v.get("kda"),
                "kills": v.get("kills"),
                "assists": v.get("assists"),
                "participation": v.get("participation"),
                "hurt_rate": v.get("hurt_rate"),
                "be_hurt_rate": v.get("be_hurt_rate"),
                "mvp_count": v.get("mvp_count"),
                "heroes": v.get("heroes") or [],
            })
        if not versions:
            continue
        by_team[fid]["name"] = name_by_fid.get(fid, p.get("team", ""))
        by_team[fid]["abbr"] = abbr_by_fid.get(fid, "")
        by_team[fid]["players"].append({
            "player_id": p["id"].split("@")[0],
            "name": p["name"],
            "icon": p.get("icon", ""),
            "positions": p.get("positions", []),
            "active": bool(p.get("active")),
            "current_team": p.get("current_team"),
            "mvp_total": p.get("mvp_total", 0),
            "versions": versions,
        })
    for fid, data in by_team.items():
        dump(data, OUT / "teams" / f"{fid}.json")

    # ---- 4. manifest.json ----
    seasons = []
    for sid, fmt in formats["seasons"].items():
        rtypes = [r["type"] for r in fmt["rounds"]]
        seasons.append({
            "season_id": sid,
            "name": fmt["name"],
            "source": fmt.get("source", ""),
            "has_regular": "round_robin" in rtypes,
            "playoff_type": (fmt.get("playoff_config") or {}).get("type", ""),
            "year": next((int(y) for y in ("2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026") if sid.startswith(("KPL" + y, "KCC" + y, "L" + y))), None),
        })
    seasons.sort(key=lambda s: s["season_id"])

    teams2026: list[dict] = []
    seen: set[str] = set()
    for g in (formats["seasons"].get("KPL2026S1") or {}).get("teams_by_group", {}).values():
        for fid in g:
            if fid in seen:
                continue
            seen.add(fid)
            teams2026.append({
                "id": fid,
                "name": name_by_fid.get(fid, fid),
                "abbr": abbr_by_fid.get(fid, ""),
            })

    manifest = {
        "generated": "2026-08-16",
        "seasons": seasons,
        "teams2026": teams2026,
    }
    dump(manifest, OUT / "manifest.json")

    # ---- 5. 王朝战队预设（选手取王朝年代赛季版本，缺记录时按时间就近回退）----
    name_by_id = {p["player_id"]: p["name"] for p in players}
    id_by_name = {p["name"]: p["player_id"] for p in players}
    avail_sids = set(formats["seasons"].keys())
    season_order = list(formats["seasons"].keys())
    dyn_out = []
    for d in DYNASTIES:
        roster = []
        for pn in d["players"]:
            pid = id_by_name.get(pn)
            if not pid:
                continue
            cand = [r for r in records
                    if r["player_id"] == pid and r["team_franchise"] == d["team_fid"]
                    and r["season_id"] in avail_sids
                    and (r["games"] or 0) >= 5
                    and r["position"] in ("对抗路", "打野", "中路", "发育路", "游走")]
            if not cand:
                continue
            era = next((r for r in cand if r["season_id"] == d["season"]), None)
            if era is not None:
                roster.append({"player_id": pid, "season_id": era["season_id"]})
                continue
            # 年代赛季无记录：按时间就近回退，保证王朝可点开
            target = season_order.index(d["season"])
            near = min(cand, key=lambda r: (abs(season_order.index(r["season_id"]) - target),
                                            season_order.index(r["season_id"])))
            print(f"[warn] 王朝 {d['label']} {pn} 在 {d['season']} 无记录，回退 {near['season_id']}")
            roster.append({"player_id": pid, "season_id": near["season_id"]})
        if len(roster) == 5:
            dyn_out.append({
                "id": d["id"], "label": d["label"], "team_fid": d["team_fid"],
                "desc": d["desc"], "era_season": d["season"], "players": roster,
            })
        else:
            print(f"[warn] 王朝预设 {d['label']} 仅凑齐 {len(roster)} 人，跳过")
    dump({"dynasties": dyn_out}, OUT / "dynasties.json")

    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"web 数据已生成：{len(seasons)} 赛季 / {len(teams2026)} 队 / {len(by_team)} 队卡 / {len(dyn_out)} 王朝 / {total/1024:.0f} KB")


if __name__ == "__main__":
    main()
