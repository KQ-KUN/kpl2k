"""构建 KPL 2016—2018 历史档案与选手生涯元数据。

旧赛季官方接口没有选手首发和个人统计，因此这里仅生成可查阅档案，
不会把旧赛季加入模拟战场或推导虚构战力。
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
RAW_KPLOW = ROOT / "data" / "raw" / "kplow" / "kpl_history_2016_2018.json"
RAW_CAREERS = ROOT / "data" / "raw" / "liquipedia" / "career_history.json"
CURATED_CHAMPIONSHIPS = ROOT / "data" / "curated" / "championships.json"
PLAYERS = ROOT / "data" / "processed" / "players.json"
PROC_ARCHIVE = ROOT / "data" / "processed" / "historical_archive.json"
PROC_META = ROOT / "data" / "processed" / "historical_player_meta.json"
APP_ARCHIVE = ROOT / "app" / "history_archive.html"

EXPECTED_SEASONS = {
    "KPL2016QJS", "KPL2017CJS", "KPL2017QJS", "KPL2018CJS", "KPL2018QJS"
}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def dump(data: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build_archive(history: dict) -> dict:
    seasons = history.get("seasons") or []
    ids = {season.get("seasonId") for season in seasons}
    match_count = sum(len(season.get("matches") or []) for season in seasons)
    if ids != EXPECTED_SEASONS or match_count != 587:
        raise ValueError(f"历史赛程契约不符：seasons={sorted(ids)} matches={match_count}")

    built = []
    for season in seasons:
        matches = season.get("matches") or []
        finals = [match for match in matches if match.get("stageName") == "总决赛"]
        if len(finals) != 1:
            raise ValueError(f"{season['seasonId']} 总决赛数量应为 1，实际为 {len(finals)}")
        final = finals[0]
        a_score = int(final.get("teamAScore") or 0)
        b_score = int(final.get("teamBScore") or 0)
        champion = final["teamAName"] if a_score > b_score else final["teamBName"]
        runner_up = final["teamBName"] if a_score > b_score else final["teamAName"]
        stages = Counter(match.get("stageName") or "其他" for match in matches)
        built.append({
            "season_id": season["seasonId"],
            "name": season["seasonName"],
            "year": season["year"],
            "team_count": len(season.get("teams") or []),
            "match_count": len(matches),
            "stage_counts": dict(stages),
            "champion": champion,
            "runner_up": runner_up,
            "final_score": f"{a_score}:{b_score}",
            "final_team_a": final["teamAName"],
            "final_team_b": final["teamBName"],
            "teams": season.get("teams") or [],
            "matches": matches,
        })
    return {
        "schema_version": "1.0",
        "generated_at": history.get("generatedAt"),
        "source": history.get("source"),
        "scope": "2016—2018 KPL 官方赛程与赛果",
        "playable": False,
        "playable_note": "旧接口未提供可核验的首发阵容和个人统计，因此不进入模拟战场。",
        "season_count": len(built),
        "match_count": match_count,
        "seasons": built,
    }


def build_player_meta(careers: dict, championships: dict, players: dict) -> dict:
    events = championships.get("events") or []
    for event in events:
        starters = event.get("starters") or []
        if len(starters) != 5 or len(set(starters)) != 5:
            raise ValueError(f"{event.get('id')} 冠军首发必须是 5 名不同选手")
        text = f"{event.get('id', '')} {event.get('name', '')}".lower()
        if "kwc" in text or "资格赛" in text or "梦之队" in text:
            raise ValueError(f"冠军矩阵包含排除赛事：{event.get('id')}")

    counts = Counter(name for event in events for name in event.get("starters") or [])
    by_name: dict[str, list[str]] = {}
    for player in players.get("players") or []:
        by_name.setdefault(player["name"], []).append(player["player_id"])

    career_players = careers.get("players") or {}
    names = set(career_players) | set(counts)
    records = {}
    unmatched = []
    ambiguous = []
    for name in sorted(names):
        ids = by_name.get(name) or []
        if not ids:
            unmatched.append(name)
            continue
        if len(ids) != 1:
            ambiguous.append({"name": name, "player_ids": ids})
            continue
        career = career_players.get(name) or {}
        player_events = [event["id"] for event in events if name in (event.get("starters") or [])]
        records[ids[0]] = {
            "name": name,
            "debut_year": career.get("debutYear"),
            "debut_year_source": "liquipedia-career-v1" if career.get("debutYear") else None,
            "championship_count": counts.get(name, 0),
            "championship_events": player_events,
            "championship_count_source": "curated-finals-starters-v1",
        }

    def assert_record(name: str, key: str, expected: int) -> None:
        ids = by_name.get(name) or []
        actual = records.get(ids[0], {}).get(key) if len(ids) == 1 else None
        if actual != expected:
            raise ValueError(f"{name} {key} 应为 {expected}，实际为 {actual}")

    assert_record("一诺", "debut_year", 2018)
    assert_record("一诺", "championship_count", 7)
    assert_record("梦泪", "championship_count", 0)
    assert_record("钟意", "championship_count", 7)
    assert_record("钎城", "debut_year", 2019)
    assert_record("无畏", "debut_year", 2020)
    kcc_2024 = next(event for event in events if event["id"] == "KCC2024")
    if "小俞" not in kcc_2024["starters"] or "一诺" in kcc_2024["starters"]:
        raise ValueError("KCC2024 冠军首发契约不符")

    return {
        "schema_version": "1.0",
        "sources": {
            "debut_year": careers.get("source"),
            "championship_count": championships.get("source"),
        },
        "records": records,
        "mapping_report": {"matched": len(records), "unmatched_names": unmatched, "ambiguous": ambiguous},
    }


def build_html(archive: dict) -> str:
    data = json.dumps(archive, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return HTML_TEMPLATE.replace("__DATA__", data)


def main() -> None:
    archive = build_archive(load(RAW_KPLOW))
    player_meta = build_player_meta(load(RAW_CAREERS), load(CURATED_CHAMPIONSHIPS), load(PLAYERS))
    dump(archive, PROC_ARCHIVE)
    dump(player_meta, PROC_META)
    APP_ARCHIVE.write_text(build_html(archive), encoding="utf-8")
    report = player_meta["mapping_report"]
    print(f"历史档案：{archive['season_count']} 赛季 / {archive['match_count']} 场")
    print(f"生涯元数据：匹配 {report['matched']} 人 / 未匹配 {len(report['unmatched_names'])} 人")
    print(f"浏览页：app/history_archive.html（{APP_ARCHIVE.stat().st_size / 1024:.0f} KB）")


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b1a2e"><title>KPL 2K · 2016—2018 历史档案</title>
<style>
:root{--bg:#0b1a2e;--card:#12243f;--line:#29456e;--fg:#e9f1fb;--mut:#8fa8cc;--gold:#f0b90b;--blue:#5da8ff}
*{box-sizing:border-box}body{margin:0 auto;max-width:920px;padding:18px 14px 48px;background:var(--bg);color:var(--fg);font:14px/1.55 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
a{color:var(--blue)}header{display:flex;align-items:center;gap:12px;margin-bottom:14px}.back{text-decoration:none;font-size:24px;color:var(--mut)}h1{margin:0;font-size:20px}.lead{margin:0 0 14px;color:var(--mut)}
.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}.metric,.season{border:1px solid var(--line);border-radius:14px;background:var(--card)}.metric{padding:12px;text-align:center}.metric b{display:block;color:var(--gold);font-size:21px}.metric span{color:var(--mut);font-size:11px}
.toolbar{display:flex;gap:8px;position:sticky;top:0;z-index:3;padding:9px 0;background:rgba(11,26,46,.95)}select,input{min-height:40px;border:1px solid var(--line);border-radius:10px;background:#0d1e34;color:var(--fg);padding:0 10px}input{flex:1;min-width:0}
.season{margin:10px 0;overflow:hidden}.season-head{width:100%;padding:14px;border:0;background:none;color:inherit;text-align:left;cursor:pointer}.season-title{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:800}.season-title i{margin-left:auto;color:var(--gold);font-style:normal}.final{margin-top:5px;color:var(--mut);font-size:12px}.final b{color:var(--gold)}.season-body{display:none;padding:0 12px 12px}.season.open .season-body{display:block}
.match{display:grid;grid-template-columns:70px 1fr auto 1fr;align-items:center;gap:7px;padding:8px 3px;border-top:1px solid rgba(41,69,110,.65);font-size:12px}.stage{color:var(--mut)}.a{text-align:right}.score{color:var(--gold);font-weight:800}.empty{text-align:center;color:var(--mut);padding:28px}.note{margin-top:18px;padding:12px;border-left:3px solid var(--gold);background:rgba(240,185,11,.06);color:var(--mut);font-size:12px}
@media(max-width:560px){.match{grid-template-columns:56px 1fr auto 1fr;font-size:11px}.summary{gap:6px}.metric{padding:9px 4px}.metric b{font-size:18px}}
</style></head><body>
<header><a class="back" href="index.html" aria-label="返回首页">‹</a><h1>2016—2018 历史档案</h1></header>
<p class="lead">来自 KPL 官方旧赛程接口的真实赛程与赛果，可按赛季、阶段或战队检索。</p>
<div class="summary"><div class="metric"><b id="season-count"></b><span>历史赛季</span></div><div class="metric"><b id="match-count"></b><span>比赛记录</span></div><div class="metric"><b>官方</b><span>赛程赛果来源</span></div></div>
<div class="toolbar"><select id="season-filter"><option value="">全部赛季</option></select><select id="stage-filter"><option value="">全部阶段</option><option>常规赛</option><option>季后赛</option><option>总决赛</option></select><input id="query" placeholder="搜索战队"></div>
<main id="list"></main>
<div class="note"><b>为什么不能直接开赛？</b><br>旧接口没有提供可核验的首发阵容和个人统计。这里保留真实历史档案，但不据此虚构选手战力；模拟战场仍从 2019 年开始。</div>
<div class="note">赛程与赛果：KPL 官方旧接口。选手首次登场年份整理自 <a href="https://liquipedia.net/honorofkings/" target="_blank" rel="noopener">Liquipedia Honor of Kings Wiki</a>，依 <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA 3.0</a> 使用并转换为本项目字段。冠军数依据经交叉核对的总决赛冠军方五人首发计算，不含替补、资格赛、KWC 与梦之队邀请赛。</div>
<script id="archive-data" type="application/json">__DATA__</script><script>
const DATA=JSON.parse(document.getElementById('archive-data').textContent),$=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
$('#season-count').textContent=DATA.season_count;$('#match-count').textContent=DATA.match_count;
$('#season-filter').innerHTML+=[...DATA.seasons].reverse().map(s=>`<option value="${s.season_id}">${esc(s.name)}</option>`).join('');
function render(){const sid=$('#season-filter').value,stage=$('#stage-filter').value,q=$('#query').value.trim().toLowerCase();const seasons=[...DATA.seasons].reverse().filter(s=>!sid||s.season_id===sid);let shown=0;$('#list').innerHTML=seasons.map(s=>{const ms=s.matches.filter(m=>(!stage||m.stageName===stage)&&(!q||m.teamAName.toLowerCase().includes(q)||m.teamBName.toLowerCase().includes(q)));if(!ms.length)return'';shown+=ms.length;return `<section class="season"><button class="season-head" onclick="this.parentNode.classList.toggle('open')"><div class="season-title">${esc(s.name)}<i>${ms.length} 场⌄</i></div><div class="final">冠军 <b>${esc(s.champion)}</b> · 总决赛 ${esc(s.final_team_a)} ${s.final_score} ${esc(s.final_team_b)}</div></button><div class="season-body">${ms.map(m=>`<div class="match"><span class="stage">${esc(m.stageName)}</span><span class="a">${esc(m.teamAName)}</span><span class="score">${m.teamAScore}:${m.teamBScore}</span><span>${esc(m.teamBName)}</span></div>`).join('')}</div></section>`}).join('')||'<div class="empty">没有匹配的比赛</div>'}
['season-filter','stage-filter','query'].forEach(id=>$('#'+id).addEventListener('input',render));render();
</script></body></html>"""


if __name__ == "__main__":
    main()
