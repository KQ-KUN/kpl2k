"""KPL 2K 选手库构建 v2

合并 processed 数据，生成：
- data/processed/player_library.json（选手库数据，选人界面同源）
- app/player_library.html（单文件移动端浏览页，内嵌数据，可直接打开/分享）

规则：
- 只保留 2026 年仍存在的 KPL 战队（白名单 ACTIVE_2026）。
- 按"选手 × 战队"拆卡：选手在每个效力过的现存队下各有一张卡，
  数据只统计该队时期的比赛；同一队按年合并版本（每年一条，当年合计）。
  （例：钟意在狼队与 AG 各一张卡；一诺在黑凤梨打的比赛并入 AG 卡。）
- 战队内排序：现役（2026 在该队有效力）最前 → 已离队按离队时间 → 无头像最后。

用法：
  python tools/build_player_library.py
"""

from __future__ import annotations

import json
import hashlib
try:
    from .attribution import IdentityResolver, index_records, team_attribution
except ImportError:
    from attribution import IdentityResolver, index_records, team_attribution
from copy import deepcopy
from pathlib import Path

from player_icons import sync_player_icon_cache
from official_rosters import load_roster, update_library

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"
APP = ROOT / "app"

# 传奇小样本例外：与 clean_kpl.py 保持一致，允许更少场次进库
LEGEND_MIN_GAMES = {
    "43062C3D029AD48A789256BE11349345": 4,  # 梦泪：2019KPL秋季赛仅 4 场
}

# 2026 年仍存在的 KPL 战队（KPL2026S1 / KPL2026S2 参赛队）
ACTIVE_2026 = {
    "10001": "重庆狼队",
    "10002": "上海EDG.M",
    "10003": "北京WB",
    "10005": "KSG",
    "10006": "武汉eStarPro",
    "10007": "南通Hero久竞",
    "10008": "深圳DYG",
    "10009": "上海RNG.M",
    "10010": "西安WE",
    "10016": "佛山DRG",
    "10017": "广州TTG",
    "10018": "济南RW侠",
    "10020": "北京JDG",
    "10027": "成都AG超玩会",
    "10028": "长沙TES.A",
    "10031": "杭州LGD.NBW",
    "10601": "无锡TCG",
    "10903": "桐乡情久",
    "10910": "WST",
    "12202": "SYG",
}

# 同一俱乐部的重复 ID（kpl 与 smoba 双轨），统一归到主力 ID
FID_ALIAS = {
    "10019": "10028",  # 长沙TES.A
    "10303": "10601",  # 无锡TCG
    "10403": "10903",  # 桐乡情久
}

# 并购/席位继承：历史队 -> 现存队（如 BA黑凤梨席位被 AG 收购）
MERGE_HISTORIC = {
    "10004": "10027",  # BA黑凤梨 -> 成都AG超玩会
}

# 各分路最能体现水准的核心指标（卡片展示用，替代一刀切 KDA）
POS_KEY_STATS = {
    "对抗路": [("kills", "场均击杀"), ("hurt_rate", "输出占比"), ("towers", "场均推塔")],
    "打野": [("kills", "场均击杀"), ("participation", "参团率"), ("gpm", "分均经济")],
    "中路": [("hurt_rate", "输出占比"), ("damage_convert", "伤害转化"), ("participation", "参团率")],
    "发育路": [("hurt_rate", "输出占比"), ("gpm", "分均经济"), ("kills", "场均击杀")],
    "游走": [("participation", "参团率"), ("be_hurt_rate", "承伤占比"), ("assists", "场均助攻")],
}


def load(name: str) -> dict:
    return json.loads((PROC / name).read_text(encoding="utf-8"))


def main() -> None:
    players = load("players.json")["players"]
    stats = load("player_season_stats.json")["records"]
    seasons = load("seasons.json")["seasons"]
    attr = load("player_attribution.json").get("records", [])
    franchises = load("franchises.json")["franchises"]
    flavor = json.loads((ROOT / "data" / "narrative" / "player_flavor.json").read_text(encoding="utf-8")).get("flavors", {})
    meta_path = PROC / "historical_player_meta.json"
    career_meta = load("historical_player_meta.json").get("records", {}) if meta_path.exists() else {}

    season_names = {s["season_id"]: s["name"] for s in seasons}
    franchise_display = {}
    for f in franchises:
        nbs = f.get("names_by_season") or {}
        franchise_display[f["franchise_id"]] = (
            nbs[sorted(nbs, reverse=True)[0]] if nbs else (f.get("current_names") or ["?"])[0]
        )
    corrections = json.loads((ROOT / 'data/curated/player_identity_corrections.json').read_text(encoding='utf-8'))
    attr_by_key = index_records(attr, IdentityResolver(players, corrections))
    name_by_pid = {p["player_id"]: p["name"] for p in players}
    icon_by_pid = {p["player_id"]: p.get("player_icon", "") for p in players}
    year_by_season = {s["season_id"]: s.get("year") for s in seasons}
    season_order = {s["season_id"]: i for i, s in enumerate(seasons)}
    battlefield_seasons = {s["season_id"] for s in seasons if s.get("is_battlefield")}

    stats_by_pid: dict[str, list[dict]] = {}
    for r in stats:
        min_games = LEGEND_MIN_GAMES.get(r["player_id"], 5)
        if r["rating"] is None or (r["games"] or 0) < min_games:
            continue
        stats_by_pid.setdefault(r["player_id"], []).append(r)

    def active_fid(fid: str) -> str | None:
        fid = FID_ALIAS.get(fid, fid)
        fid = MERGE_HISTORIC.get(fid, fid)
        return fid if fid in ACTIVE_2026 else None

    # 按 (选手, 映射后现存队) 分组
    team_rows: dict[tuple[str, str], list[dict]] = {}
    for p in players:
        for r in stats_by_pid.get(p["player_id"], []):
            fid = active_fid(r["team_franchise"])
            if fid:
                team_rows.setdefault((p["player_id"], fid), []).append(r)

    active_seasons = {"KPL2026S1", "KPL2026S2", "KCC2026"}
    # 选手当前（2026）归属：取 2026 赛季最新记录所在现存队
    player_current_team: dict[str, tuple[int, str]] = {}
    for r in stats:
        if r["season_id"] not in active_seasons:
            continue
        fid = active_fid(r["team_franchise"])
        if not fid:
            continue
        order = season_order.get(r["season_id"], 0)
        if r["player_id"] not in player_current_team or order > player_current_team[r["player_id"]][0]:
            player_current_team[r["player_id"]] = (order, ACTIVE_2026[fid])

    library = []
    for (pid, fid), rows in team_rows.items():
        p = next(x for x in players if x["player_id"] == pid)
        ordered = sorted(rows, key=lambda r: season_order.get(r["season_id"], 0))

        # 按年合并该队版本的记录
        by_year: dict[int, list[dict]] = {}
        for r in ordered:
            y = year_by_season.get(r["season_id"])
            if y is None:
                continue
            by_year.setdefault(int(y), []).append(r)
        versions = []
        for year in sorted(by_year):
            recs = by_year[year]
            games = sum(r["games"] for r in recs)
            def wavg(key):
                items = [(r[key], r["games"]) for r in recs if isinstance(r.get(key), (int, float))]
                if not items:
                    return None
                return sum(v * g for v, g in items) / sum(g for _, g in items)
            mvp_total = sum(
                int(team_attribution(attr_by_key.get((r["season_id"], pid)), r['team_franchise']).get("mvp_count") or 0)
                for r in recs
            )
            heroes = []
            for r in recs:
                for h in team_attribution(attr_by_key.get((r["season_id"], pid)), r['team_franchise']).get("heroes", []):
                    if h not in heroes:
                        heroes.append(h)
            # 年度战力：只统计正式战场赛季（排除季前赛/选拔赛等 is_battlefield=False 的小赛事），
            # 取当年"真实评分"（非 50 分保底）赛季的战力峰值，避免小样本虚高/稀释
            valid = [r for r in recs if r["season_id"] in battlefield_seasons and (r["rating"] or 0) > 50]
            if valid:
                rating = round(max(r["rating"] for r in valid), 1)
            else:
                rating = 50.0
            versions.append({
                "year": year,
                "season_label": f"{year}年",
                "team": ACTIVE_2026[fid],
                "position": max(recs, key=lambda r: r["games"])["position"],
                "rating": rating,
                "peak": False,
                "games": games,
                "win_rate": round(wavg("win_rate") or 0, 4),
                "kda": round(wavg("avg_kda") or 0, 2),
                "kills": round(wavg("avg_kill_num") or 0, 2),
                "assists": round(wavg("avg_assist_num") or 0, 2),
                "gpm": round(wavg("avg_gpm") or 0, 1),
                "dpm": round(wavg("avg_per_min_hurt_total") or 0, 1),
                "participation": round(wavg("avg_participation_rate") or 0, 1),
                "hurt_rate": round((wavg("avg_hurt_to_hero_total_rate") or 0) * 100, 1),
                "be_hurt_rate": round((wavg("avg_be_hurt_by_hero_total_rate") or 0) * 100, 1),
                "damage_convert": round(wavg("avg_damage_convert_rate") or 0, 2),
                "towers": round(wavg("avg_push_tower_num") or 0, 2),
                "mvp_count": mvp_total,
                "mvp_per_game": round(mvp_total / games, 3) if games else None,
                "heroes": heroes,
            })
        versions.sort(key=lambda v: -v["rating"])
        for idx, v in enumerate(versions):
            v["peak"] = idx == 0
        peak = versions[0]["rating"] if versions else 0
        is_legend = pid in LEGEND_MIN_GAMES
        last_order = max(season_order.get(r["season_id"], 0) for r in rows)
        # 卡片所在队之外的"现役去处"：选手当前在其他队则为现役转会，无当前队则为退役
        cur = player_current_team.get(pid)
        current_team = cur[1] if cur else None
        current_team = None if current_team == ACTIVE_2026[fid] else current_team
        # 现役 = 选手 2026 最新归属队就是这张卡所在的队（赛季中转会的老队卡不算现役）
        is_active = bool(cur and cur[1] == ACTIVE_2026[fid])
        library.append({
            "id": f"{pid}@{fid}",
            "name": p["name"],
            "real_name": p.get("real_name", ""),
            "icon": icon_by_pid.get(pid, ""),
            "positions": sorted({v["position"] for v in versions}),
            "legend": is_legend,
            "peak_rating": peak,
            "version_count": len(versions),
            "team": ACTIVE_2026[fid],
            "team_fid": fid,
            "active": is_active,
            "current_team": current_team if current_team != ACTIVE_2026[fid] else None,
            "last_order": last_order,
            "mvp_total": sum(v["mvp_count"] for v in versions),
            "debut_year": (career_meta.get(pid) or {}).get("debut_year"),
            "championship_count": (career_meta.get(pid) or {}).get("championship_count"),
            "championship_events": (career_meta.get(pid) or {}).get("championship_events", []),
            "versions": versions,
        })

    library.sort(key=lambda pl: -pl["peak_rating"])
    out = {
        "schema_version": "0.2",
        "players": library,
    }
    update_library(out, load_roster())
    # Snapshot identity follows the actual post-roster payload, never a fixed calendar date.
    out["data_version"] = "sha256:" + hashlib.sha256(json.dumps(out["players"], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    (PROC / "player_library.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"选手库：{len(library)} 名选手，{sum(pl['version_count'] for pl in library)} 个版本")
    for pl in library[:8]:
        print(f"  {pl['name']:<6} 巅峰战力={pl['peak_rating']:<6} 版本数={pl['version_count']} 位置={','.join(pl['positions'])}")

    web_out = deepcopy(out)
    local_icons = sync_player_icon_cache()
    for player in web_out["players"]:
        player_id = player["id"].split("@", 1)[0]
        if player_id in local_icons:
            player["icon"] = local_icons[player_id]
    data_json = json.dumps(web_out, ensure_ascii=False, separators=(",", ":"))
    APP.mkdir(parents=True, exist_ok=True)
    html = HTML_TEMPLATE.replace("__DATA__", data_json)
    (APP / "player_library.html").write_text(html, encoding="utf-8")
    print(f"浏览页：app/player_library.html（{len(html) / 1024:.0f} KB）")


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#F6F2E9">
<title>KPL 2K · 选手图鉴</title>
<script src="js/subpage-theme.js"></script>
<link rel="stylesheet" href="library.css">

</head>
<body>
<div class="achievement-toast" id="achievement-toast" role="status" aria-live="polite" aria-atomic="true"><span class="achievement-toast-icon" aria-hidden="true">🏆</span><span class="achievement-toast-copy"><small>成就已解锁</small><strong id="achievement-toast-name"></strong></span></div>
<div class="lib-head">
  <a class="back" href="index.html" aria-label="返回首页">‹</a>
  <h1>KPL 2K · 选手图鉴</h1>
  <button class="theme-toggle" id="theme-toggle" type="button" aria-label="切换深色模式">◐ 深色</button>
  <button class="rules-btn" id="rules-btn">战力规则</button>
</div>
<div class="sub" id="meta"></div>
<div class="toolbar">
  <input id="q" aria-label="搜索选手" placeholder="搜索选手（如 Fly / 小胖 / 一诺）">
  <select id="team" aria-label="筛选战队"><option value="">全部战队</option></select>
  <select id="pos" aria-label="筛选位置"><option value="">全部位置</option><option>对抗路</option><option>打野</option><option>中路</option><option>发育路</option><option>游走</option></select>
  <select id="sort" aria-label="排序方式"><option value="-peak">巅峰战力 ↓</option><option value="peak">巅峰战力 ↑</option><option value="name">名字</option><option value="-mvp">MVP 总数 ↓</option></select>
</div>
<div id="list"></div><button id="load-more" class="rules-btn" type="button">加载更多</button>
<div class="rules-mask" id="rules-mask">
  <div class="rules-box" role="dialog" aria-modal="true" aria-labelledby="rules-title">
    <h3 id="rules-title">战力计算规则</h3>
    <div class="r">
      <b>1. 基础评分（100 分制）</b><br>
      先按赛季内同位置数据标准化（z 值），再放入全历史同位置池计算百分位，按分路权重加权、按出场场次打折，得出最终评分。<br><br>
      <b>2. 分路看不同数据</b><br>
      对抗路：承伤 / 输出 / 推塔；打野：击杀 / 参团 / 经济；中路：输出 / 伤害转化 / 参团；发育路：KDA / 输出 / 经济；游走：参团 / 承伤 / 助攻。<br><br>
      <b>3. 出场折扣</b><br>
      约 3 场即可出分，10 场以上基本拉满；样本过小时战力会偏低，属正常现象。<br><br>
      <b>4. 阵容强度</b><br>
      阵容战力 = 首发均分 + 位置覆盖 + 同场默契 + 组合胜率化学 + 风格修正（约 60% 压缩）。冠军阵容的"化学反应"来自该阵容当年的真实同场胜率。<br><br>
      <b>5. 年度版本</b><br>
      选手图鉴每年只展示一张年度卡，战力取该年正式赛事中的最高赛季值；同年具体赛事直接沿用这项年度战力，不再重复计算。赛事数据、位置与效力战队仍按实际赛事记录展示。
    </div>
    <button class="rules-close" id="rules-close">知道了</button>
  </div>
</div>
<script id="library-data" type="application/json">__DATA__</script>
<script src="js/library.js"></script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
