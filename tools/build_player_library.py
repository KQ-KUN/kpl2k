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
from copy import deepcopy
from pathlib import Path

from player_icons import sync_player_icon_cache

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
    attr_by_key = {(r["season_id"], r["player_name"]): r for r in attr}
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
                int((attr_by_key.get((r["season_id"], p["name"])) or {}).get("mvp_count") or 0)
                for r in recs
            )
            heroes = []
            for r in recs:
                for h in (attr_by_key.get((r["season_id"], p["name"])) or {}).get("heroes", []):
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
        "data_version": "2026-08-30",
        "players": library,
    }
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
<title>KPL 2K · 选手图鉴</title>
<style>
:root{--bg:#080d1b;--card:#101a2e;--line:rgba(151,178,220,.2);--fg:#f4f7fc;--mut:#91a4c2;--gold:#f0b90b;--blue:#3e7bfa;--green:#3fb950}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(circle at 8% 12%,rgba(216,43,70,.12),transparent 28%),radial-gradient(circle at 92% 18%,rgba(48,104,234,.14),transparent 30%),var(--bg);color:var(--fg);font:14px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px 18px 52px;max-width:1180px;margin:0 auto}
h1{font-size:26px;margin-bottom:4px}
.sub{color:var(--mut);font-size:12px;margin-bottom:14px}
.toolbar{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;position:sticky;top:0;background:rgba(8,13,27,.92);padding:10px;z-index:5;border:1px solid var(--line);border-radius:16px;backdrop-filter:blur(16px)}
input,select{min-height:44px;background:#0a1427;border:1px solid var(--line);color:var(--fg);border-radius:11px;padding:8px 12px;font-size:13px}
input{flex:1;min-width:150px}
.team{margin-bottom:18px}
.team h2{font-size:17px;margin-bottom:10px;padding-left:10px;border-left:3px solid var(--blue);display:flex;justify-content:space-between;align-items:center}
.team h2 span{color:var(--mut);font-size:12px;font-weight:400}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.card{background:linear-gradient(145deg,rgba(18,29,49,.98),rgba(10,17,30,.99));border:1px solid var(--line);border-radius:18px;padding:14px;cursor:pointer;transition:transform .14s cubic-bezier(.23,1,.32,1),border-color .14s ease}
.card.open{border-color:var(--blue)}
.head{display:flex;align-items:center;gap:10px}
.ava{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#fff;flex:none}
img.ava{object-fit:cover;background:#21262d}
.nm{font-size:15px;font-weight:600;line-height:1.2}
.tm{font-size:11px;color:var(--mut);margin-top:2px}
.st{margin-top:4px}
.pk{color:var(--gold);font-size:17px;font-weight:700;margin-left:auto;text-align:right}
.pk small{display:block;color:var(--mut);font-size:10px;font-weight:400}
.brief{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}
.b{background:#0a1427;border:1px solid var(--line);border-radius:8px;padding:3px 8px;font-size:11px;color:var(--mut)}
.b b{color:var(--fg);font-weight:600}
.tags{margin-top:7px;font-size:11px;color:var(--mut)}
.tag{display:inline-block;background:#21262d;border-radius:6px;padding:1px 7px;margin-right:5px}
.versions{margin-top:10px;display:none}
.card.open .versions{display:block}
.ver{background:#0a1427;border:1px solid var(--line);border-radius:11px;padding:10px 12px;margin-top:8px}
.ver-top{display:flex;justify-content:space-between;align-items:center;font-size:12px}
.v-rating{color:var(--blue);font-weight:700}
.v-stats{color:var(--mut);font-size:11px;margin-top:3px}
.v-mvp{color:var(--gold)}
.badge{display:inline-block;font-size:10px;border-radius:5px;padding:1px 5px;margin-left:5px}
.b-peak{background:#0f2a1e;color:var(--green);border:1px solid #1f6f43}
.b-legend{background:#2b1d05;color:var(--gold);border:1px solid #7a5c12}
.b-active{background:#0f2a1e;color:var(--green);border:1px solid #1f6f43}
.b-move{background:#101f2e;color:var(--blue);border:1px solid #1f6f9f}
.b-retire{background:#2d0f0f;color:#ff7b72;border:1px solid #8b3a3a}
.heroes{margin-top:4px;font-size:11px;color:var(--mut)}
.meme{color:var(--mut);font-size:11px;margin-top:7px;padding:5px 8px;background:#0a1427;border:1px solid var(--line);border-radius:8px}
.empty{color:var(--mut);text-align:center;padding:30px 0}
.lib-head{display:grid;grid-template-columns:42px 1fr auto;gap:12px;align-items:center;margin-bottom:8px}
.back{display:grid;place-items:center;width:42px;height:42px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--mut);font-size:26px;text-decoration:none}
.rules-btn{min-height:42px;background:var(--card);border:1px solid var(--line);color:#c9d8f2;border-radius:11px;padding:0 14px;font-size:13px;cursor:pointer;flex:none}
.rules-btn:hover{border-color:var(--blue)}
.rules-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:20;padding:14px}
.rules-mask.show{display:flex}
.rules-box{background:var(--card);border:1px solid var(--line);border-radius:12px;max-width:520px;width:100%;max-height:80vh;overflow:auto;padding:16px}
.rules-box h3{font-size:15px;margin-bottom:10px;color:var(--gold)}
.rules-box .r{color:var(--mut);font-size:12px;line-height:1.7}
.rules-box .r b{color:var(--fg)}
.rules-close{width:100%;min-height:44px;margin-top:12px;background:linear-gradient(110deg,#e83e57,#386ee3);border:0;color:#fff;border-radius:11px;padding:8px;cursor:pointer}
.achievement-toast{position:fixed;left:20px;bottom:20px;z-index:30;display:grid;grid-template-columns:44px minmax(0,1fr);align-items:center;gap:12px;width:min(360px,calc(100vw - 40px));min-height:68px;padding:11px 16px 11px 12px;border:1px solid rgba(240,185,11,.55);border-radius:8px;background:linear-gradient(105deg,#171b20,#222831);box-shadow:0 14px 42px rgba(0,0,0,.52),inset 3px 0 0 var(--gold);opacity:0;pointer-events:none;transform:translateY(calc(100% + 24px));transition:opacity .16s cubic-bezier(.23,1,.32,1),transform .22s cubic-bezier(.23,1,.32,1)}
.achievement-toast.show{opacity:1;transform:translateY(0)}
.achievement-toast-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:6px;background:linear-gradient(145deg,#473b14,#211d0d);font-size:23px}
.achievement-toast-copy{min-width:0;display:flex;flex-direction:column;line-height:1.25}.achievement-toast-copy small{color:#aeb6c1;font-size:11px;font-weight:700;letter-spacing:.08em}.achievement-toast-copy strong{margin-top:4px;overflow:hidden;color:#ffe08a;font-size:14px;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:600px){.achievement-toast{left:50%;bottom:max(12px,env(safe-area-inset-bottom));width:calc(100vw - 24px);transform:translate(-50%,calc(100% + 24px))}.achievement-toast.show{transform:translate(-50%,0)}}
@media(hover:hover) and (pointer:fine){.card:hover{transform:translateY(-2px);border-color:rgba(93,126,187,.55)}}
@media(max-width:600px){body{padding:16px 12px 42px}.lib-head{grid-template-columns:38px 1fr auto;gap:9px}.back{width:38px;height:38px}.lib-head h1{font-size:20px}.rules-btn{padding:0 10px;font-size:12px}.toolbar{position:static}}
@media(prefers-reduced-motion:reduce){.achievement-toast{transition:opacity .01ms}}
</style>
</head>
<body>
<div class="achievement-toast" id="achievement-toast" role="status" aria-live="polite" aria-atomic="true"><span class="achievement-toast-icon" aria-hidden="true">🏆</span><span class="achievement-toast-copy"><small>成就已解锁</small><strong id="achievement-toast-name"></strong></span></div>
<div class="lib-head">
  <a class="back" href="index.html" aria-label="返回首页">‹</a>
  <h1>KPL 2K · 选手图鉴</h1>
  <button class="rules-btn" id="rules-btn">战力规则</button>
</div>
<div class="sub" id="meta"></div>
<div class="toolbar">
  <input id="q" placeholder="搜索选手（如 Fly / 小胖 / 一诺）">
  <select id="team"><option value="">全部战队</option></select>
  <select id="pos"><option value="">全部位置</option><option>对抗路</option><option>打野</option><option>中路</option><option>发育路</option><option>游走</option></select>
  <select id="sort"><option value="-peak">巅峰战力 ↓</option><option value="peak">巅峰战力 ↑</option><option value="name">名字</option><option value="-mvp">MVP 总数 ↓</option></select>
</div>
<div id="list"></div>
<div class="rules-mask" id="rules-mask">
  <div class="rules-box">
    <h3>战力计算规则</h3>
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
<script>
const DATA=JSON.parse(document.getElementById('library-data').textContent);
const $=s=>document.querySelector(s);
const ACHIEVEMENT_KEY='kpl2k_achievements_v1';
let achievementToastTimer=null;
function fmt(v,d=1){return v==null||isNaN(v)?'-':(+v).toFixed(d)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function hue(s){let h=0;for(const c of String(s))h=(h*31+c.codePointAt(0))>>>0;return h%360}
function recordLibraryRead(id){
  try{
    const progress=JSON.parse(localStorage.getItem(ACHIEVEMENT_KEY)||'{}');
    if(!progress.libraryPlayers||typeof progress.libraryPlayers!=='object'||Array.isArray(progress.libraryPlayers))progress.libraryPlayers={};
    if(!progress.unlocked||typeof progress.unlocked!=='object'||Array.isArray(progress.unlocked))progress.unlocked={};
    const before=Object.keys(progress.libraryPlayers).length;
    progress.libraryPlayers[id]=true;
    const count=Object.keys(progress.libraryPlayers).length,names=[];
    if(before<1&&count>=1&&!progress.unlocked.library_read){progress.unlocked.library_read=Date.now();names.push('初识群星')}
    if(before<10&&count>=10&&!progress.unlocked.library_ten){progress.unlocked.library_ten=Date.now();names.push('群星观察家')}
    localStorage.setItem(ACHIEVEMENT_KEY,JSON.stringify(progress));
    if(names.length){
      $('#achievement-toast-name').textContent=names.join('、');
      $('#achievement-toast').classList.add('show');
      clearTimeout(achievementToastTimer);
      achievementToastTimer=setTimeout(()=>$('#achievement-toast').classList.remove('show'),6500);
    }
  }catch(e){}
}
function toggleCard(el,id){const opening=!el.classList.contains('open');el.classList.toggle('open');if(opening)recordLibraryRead(id)}
const KEY_STATS={
  '对抗路':[['be_hurt_rate','承伤'],['hurt_rate','输出'],['towers','推塔']],
  '打野':[['kills','击杀'],['participation','参团'],['gpm','经济']],
  '中路':[['hurt_rate','输出'],['damage_convert','转化'],['participation','参团']],
  '发育路':[['kda','KDA'],['hurt_rate','输出'],['gpm','经济']],
  '游走':[['participation','参团'],['be_hurt_rate','承伤'],['assists','助攻']]
};
function keyStats(v){
  const defs=KEY_STATS[v.position]||[['kda','KDA']];
  return defs.map(([k,label])=>{
    const val=v[k];
    if(val==null||isNaN(val))return `${label} -`;
    if(k==='hurt_rate'||k==='be_hurt_rate')return `${label} ${fmt(val,0)}%`;
    if(k==='participation')return `${label} ${fmt(val,0)}%`;
    return `${label} ${fmt(val)}`;
  }).join(' · ');
}
function card(p){
  const vers=p.versions.map(v=>`
    <div class="ver">
      <div class="ver-top"><span>${esc(v.season_label)} · ${esc(v.team)} · ${esc(v.position)}
        ${v.peak?'<span class="badge b-peak">巅峰</span>':''}
      </span><span class="v-rating">战力 ${fmt(v.rating)}</span></div>
      <div class="v-stats">${keyStats(v)} · 胜率 ${fmt(v.win_rate*100,0)}% · ${v.games} 场
        ${v.mvp_count?`<span class="v-mvp">· MVP ${v.mvp_count} 次（${fmt(v.mvp_per_game,2)}/场）</span>`:''}</div>
      ${v.heroes.length?`<div class="heroes">英雄池：${v.heroes.slice(0,12).map(esc).join(' / ')}${v.heroes.length>12?' …':''}</div>`:''}
    </div>`).join('');
  const peak=p.versions.find(v=>v.peak)||p.versions[0];
  const status=p.active?'<span class="badge b-active">现役</span>'
    :(p.current_team?`<span class="badge b-move">现役：${esc(p.current_team)}</span>`
    :'<span class="badge b-retire">退役</span>');
  const avatar=p.icon
    ? `<img class="ava" src="${esc(p.icon)}" alt="${esc(p.name)}" onerror="this.outerHTML='<div class=\'ava\' style=\'background:hsl(${hue(p.name)},65%,46%)\'>${esc(p.name[0])}</div>'">`
    : `<div class="ava" style="background:hsl(${hue(p.name)},65%,46%)">${esc(p.name[0])}</div>`;
  return `<div class="card" onclick="toggleCard(this,'${esc(p.id)}')">
    <div class="head">
      ${avatar}
      <div>
        <div class="nm">${esc(p.name)}${p.legend?'<span class="badge b-legend">传奇</span>':''}</div>
        <div class="tm">${esc(p.team)}</div>
        <div class="st">${status}</div>
      </div>
      <div class="pk">${fmt(p.peak_rating)}<small>巅峰战力</small></div>
    </div>
    <div class="brief">
      <span class="b"><b>${p.version_count}</b> 版本</span>
      <span class="b"><b>${p.mvp_total}</b> 次 MVP</span>
      ${p.debut_year?`<span class="b"><b>${p.debut_year}</b> KPL 首秀</span>`:''}
      ${p.championship_count!=null?`<span class="b"><b>${p.championship_count}</b> 冠</span>`:''}
      <span class="b">${keyStats(peak)}</span>
    </div>
    <div class="tags">${p.positions.map(x=>`<span class="tag">${x}</span>`).join('')}</div>
    <div class="versions">${vers}</div>
  </div>`;
}
function render(){
  const q=$('#q').value.trim().toLowerCase(), team=$('#team').value, pos=$('#pos').value, sort=$('#sort').value;
  let list=DATA.players.filter(p=>(!q||p.name.toLowerCase().includes(q))&&(!team||p.team===team)&&(!pos||p.positions.includes(pos)));
  list.sort((a,b)=>{
    if(sort==='name')return a.name.localeCompare(b.name,'zh');
    if(sort==='peak')return a.peak_rating-b.peak_rating;
    if(sort==='-mvp')return b.mvp_total-a.mvp_total;
    // 默认排序：现役在前 → 离队时间新→旧 → 有头像在前 → 巅峰战力降序
    if(!!a.icon!==!!b.icon)return (a.icon?0:1)-(b.icon?0:1);
    if(a.active!==b.active)return (a.active?0:1)-(b.active?0:1);
    if(a.last_order!==b.last_order)return b.last_order-a.last_order;
    return b.peak_rating-a.peak_rating;
  });
  const groups={};
  for(const p of list)(groups[p.team]=groups[p.team]||[]).push(p);
  $('#meta').textContent=`${DATA.players.length} 位选手 · 共 ${DATA.players.reduce((s,p)=>s+p.version_count,0)} 个版本 · 民间算法 · 平行时空`;
  const teams=Object.keys(groups).sort((a,b)=>groups[b].length-groups[a].length||a.localeCompare(b,'zh'));
  $('#list').innerHTML=list.length?teams.map(t=>`<div class="team"><h2>${esc(t)}<span>${groups[t].length} 人</span></h2><div class="cards">${groups[t].map(card).join('')}</div></div>`).join(''):'<div class="empty">没有匹配的选手</div>';
}
$('#team').innerHTML='<option value="">全部战队</option>'+[...new Set(DATA.players.map(p=>p.team))].sort((a,b)=>a.localeCompare(b,'zh')).map(t=>`<option>${esc(t)}</option>`).join('');
['q','team','pos','sort'].forEach(id=>$('#'+id).addEventListener('input',render));
$('#rules-btn').addEventListener('click',function(){$('#rules-mask').classList.add('show');});
$('#rules-close').addEventListener('click',function(){$('#rules-mask').classList.remove('show');});
$('#rules-mask').addEventListener('click',function(e){if(e.target===this)this.classList.remove('show');});
render();
</script>
</body>
</html>"""


if __name__ == "__main__":
    main()
