"""采集玩加公开历史页面；只记录实际页面证据，不把可见页数视作完整赛事。"""
import html
import argparse
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://wanplus.cn"
EVENTS = {"414": "KPL2016S2", "416": "KPL2017S1", "498": "KCC2017", "533": "KPL2017S2", "592": "KPL2018S1", "690": "KCC2018", "704": "KPL2018S2", "765": "KCC2018W"}
CACHE = ROOT / "data/raw/wanplus"


def fetch(path):
    cache = CACHE / (path.strip("/").replace("/", "_") + ".html")
    if cache.exists():
        return cache.read_text(encoding="utf-8")
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as response:
        text = response.read().decode("utf-8")
    if "<title>" not in text:
        raise ValueError("非预期页面，停止解析")
    CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(text, encoding="utf-8")
    time.sleep(0.15)
    return text


def players_in_match(text):
    links = re.findall(r'<a[^>]+href=["\x27](/kog/player/\d+)["\x27][^>]*>(.*?)</a>', text, re.S)
    players = {}
    for path, label in links:
        name = html.unescape(re.sub("<[^>]+>", "", label)).strip()
        if name:
            players[path.rsplit("/", 1)[-1]] = name
    if len(players) != 10:
        raise ValueError(f"单局应有十名选手，实际 {len(players)}")
    result = [{"wanplusPlayerId": key, "nickname": value} for key, value in players.items()]
    # 原站左右两队的选手交错排列，不能按前五/后五归队。
    header = re.search(r'<div class="bssj_top">(.*?)</div>', text, re.S)
    teams = re.findall(r'/kog/team/(\d+)', header[1]) if header else []
    chunks = re.split(r'<div class="bans_([lr])">', text)
    sides = {}
    for index in range(1, len(chunks), 2):
        ids = set(re.findall(r'/kog/player/(\d+)', chunks[index + 1]))
        if len(ids) != 1:
            continue
        sides[ids.pop()] = chunks[index]
    if len(teams) == 2 and len(set(teams)) == 2 and set(sides) == set(players) and list(sides.values()).count("l") == 5 and list(sides.values()).count("r") == 5:
        for player in result:
            player["wanplusTeamId"] = teams[0 if sides[player["wanplusPlayerId"]] == "l" else 1]
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="采集全部八届，按届保存检查点")
    args = parser.parse_args()
    events = []
    for key, canonical in EVENTS.items():
        path = f"/event/{key}.html"
        text = fetch(path)
        schedules = sorted(set(re.findall(r'/schedule/(\d+)\.html', text)))
        events.append({"eventId": canonical, "source": BASE + path, "scheduleIds": schedules})
    if args.all:
        for key, event in zip(EVENTS, events):
            collect_event(key, event, events, ROOT / f'data/curated/wanplus_{event["eventId"]}.json')
        return
    collect_event("414", events[0], events, ROOT / "data/curated/wanplus_history_evidence.json")


def collect_event(key, event, events, output):
    schedules = event["scheduleIds"]
    print(json.dumps({"starting": event["eventId"], "schedules": len(schedules)}), flush=True)
    def schedule(sid):
        try:
            return {"id": sid, "text": fetch(f"/schedule/{sid}.html")}
        except Exception as error:
            return {"id": sid, "error": str(error), "text": ""}
    with ThreadPoolExecutor(max_workers=2) as pool:
        pages = list(pool.map(schedule, schedules))
    match_ids = sorted({mid for page in pages for mid in re.findall(r'\bmatch=["\x27]?(\+?\d+)', page["text"]) if int(mid) > 0})
    def match(mid):
        path = f"/match/{mid}.html"
        try:
            text = fetch(path)
            # 页面必须属于当前赛事，避免历史链接迁移导致串赛季。
            if f'/event/{key}.html' not in text:
                raise ValueError("赛事归属不一致")
            return {"matchId": mid, "source": BASE + path, "players": players_in_match(text)}
        except Exception as error:
            return {"matchId": mid, "source": BASE + path, "error": str(error)}
    with ThreadPoolExecutor(max_workers=2) as pool:
        matches = list(pool.map(match, match_ids))
    doc = {"checkedAt": datetime.now(timezone.utc).isoformat(), "provider": "WanPlus (non-official)",
           "complete": False, "scope": "Only schedules linked from public event page; no completeness assumption",
           "events": events, "sampleEventId": event["eventId"], "matches": matches,
           "scheduleErrors": [{"id": p["id"], "error": p["error"]} for p in pages if "error" in p]}
    output.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"event": event["eventId"], "schedules": len(schedules), "matches": len(matches), "validMatches": sum("players" in m for m in matches), "players": len({p["wanplusPlayerId"] for m in matches for p in m.get("players", [])})}), flush=True)


if __name__ == "__main__":
    main()
