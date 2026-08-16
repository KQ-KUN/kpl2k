"""KPL 2K 数据爬虫 v0.1

数据源：
- prod.comp.smoba.qq.com（pvp.qq.com/matchdata 后端，2019-2026 选手/战队/赛程/小局）
- kplshop-op.timi-esports.qq.com（kpl.qq.com 官网接口，赛季/战队/荣誉，备用源）

用法：
  python tools/crawl_kpl.py --leagues            # 只拉赛事列表
  python tools/crawl_kpl.py --league 20190001    # 拉单个赛事的选手/战队/赛程
  python tools/crawl_kpl.py --all                # 拉全部赛事
  python tools/crawl_kpl.py --all --battles      # 拉全部赛事 + 每场小局详情（慢）
  python tools/crawl_kpl.py --kpl                # 拉 kpl.qq.com 赛季/战队/赛程（改名映射与赛制用）
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.parse
import urllib.request

SMOBA_HOST = "https://prod.comp.smoba.qq.com"
KPL_HOST = "https://kplshop-op.timi-esports.qq.com/kplow"
MOBILE_UA = (
    "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
)
RAW_DIR = os.path.join("data", "raw")
SLEEP = 0.25
MAX_RETRY = 3


def _request(url: str, data: bytes | None = None, headers: dict | None = None) -> dict:
    last_err: Exception | None = None
    for attempt in range(MAX_RETRY):
        try:
            req = urllib.request.Request(url, data=data, headers=headers or {})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - 网络抖动重试
            last_err = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"request failed: {url} ({last_err})")


def smoba_get(path: str, params: dict | None = None) -> dict:
    url = SMOBA_HOST + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {
        "User-Agent": MOBILE_UA,
        "Referer": "https://pvp.qq.com/",
        "Origin": "https://pvp.qq.com",
    }
    time.sleep(SLEEP)
    return _request(url, headers=headers)


def kpl_post(endpoint: str, body: dict) -> dict:
    url = f"{KPL_HOST}/{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": MOBILE_UA,
        "Referer": "https://kpl.qq.com/",
        "Origin": "https://kpl.qq.com",
    }
    time.sleep(SLEEP)
    return _request(url, data=json.dumps(body).encode("utf-8"), headers=headers)


def save(rel_path: str, obj: dict) -> str:
    path = os.path.join(RAW_DIR, rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False)
    return path


def fetch_leagues() -> list[dict]:
    obj = smoba_get("/leaguesite/leagues/open")
    leagues = obj.get("results", [])
    save("leagues.json", obj)
    print(f"[ok] leagues: {len(leagues)} -> data/raw/leagues.json")
    return leagues


def fetch_kpl() -> None:
    obj = kpl_post("getSeasonAndStageAndTeamList", {})
    seasons = (obj.get("data") or {}).get("seasons", [])
    save("kpl_seasons.json", obj)
    print(f"[ok] kpl seasons: {len(seasons)} -> data/raw/kpl_seasons.json")
    for season in seasons:
        sid = season.get("seasonid")
        if not sid:
            continue
        meta = kpl_post("getSeasonAndStageAndTeamList", {"seasonid": sid})
        save(f"kpl_season_{sid}_meta.json", meta)
        sched = kpl_post("getScheduleList", {"seasonid": sid})
        save(f"kpl_season_{sid}_schedule.json", sched)
    print("[ok] kpl season meta + schedules saved")


def fetch_league(league_id: str, with_battles: bool = False) -> None:
    specs = [
        ("players", "/leaguesite/league/player/settle_list/open", "data"),
        ("teams", "/leaguesite/league/team/settle_list/open", "data"),
        ("matches", "/leaguesite/matches/open", "results"),
    ]
    for kind, path, key in specs:
        obj = smoba_get(path, {"league_id": league_id})
        raw = obj.get(key, obj.get("data") or {})
        count = len(raw) if isinstance(raw, list) else len(raw)
        save(f"league_{league_id}_{kind}.json", obj)
        print(f"[ok] {league_id} {kind}: {count}")

    if with_battles:
        with open(
            os.path.join(RAW_DIR, f"league_{league_id}_matches.json"), encoding="utf-8"
        ) as fh:
            matches = json.load(fh).get("results", [])
        total = 0
        for match in matches:
            mid = match.get("match_id")
            blist = smoba_get("/leaguesite/match/battles/open", {"match_id": mid})
            details = []
            for battle in blist.get("results", []):
                bid = battle.get("battle_id")
                if bid:
                    details.append(smoba_get("/leaguesite/battle/open", {"battle_id": bid}))
                    total += 1
            save(f"match_{mid}_battles.json", {"match_id": mid, "battles": details})
        print(f"[ok] {league_id} battles: {total}")


def main() -> None:
    ap = argparse.ArgumentParser(description="KPL 2K 数据爬虫")
    ap.add_argument("--leagues", action="store_true", help="只拉赛事列表")
    ap.add_argument("--league", help="拉取指定 league_id（选手/战队/赛程）")
    ap.add_argument("--all", action="store_true", help="拉取全部赛事")
    ap.add_argument("--battles", action="store_true", help="同时拉取每场小局详情（慢）")
    ap.add_argument("--kpl", action="store_true", help="拉取 kpl.qq.com 赛季/战队/赛程")
    args = ap.parse_args()

    if args.kpl:
        fetch_kpl()
        return

    leagues = fetch_leagues()
    if args.league:
        targets = [args.league]
    elif args.all:
        targets = [str(lg["league_id"]) for lg in leagues]
    else:
        return

    for lid in targets:
        try:
            fetch_league(lid, with_battles=args.battles)
        except Exception as exc:  # noqa: BLE001
            print(f"[fail] {lid}: {exc}")


if __name__ == "__main__":
    main()
