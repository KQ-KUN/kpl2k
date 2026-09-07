"""只读探测公开赛事接口，保存独立来源快照，不覆盖游戏数据库。"""
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBES = [
    ("smoba_leagues", "https://prod.comp.smoba.qq.com/leaguesite/leagues/open", None),
    ("smoba_players_2019", "https://prod.comp.smoba.qq.com/leaguesite/league/player/settle_list/open?league_id=20190001", None),
    ("kpl_seasons", "https://kplshop-op.timi-esports.qq.com/kplow/getSeasonAndStageAndTeamList", {}),
    ("kpl_players_2018", "https://kplshop-op.timi-esports.qq.com/kplow/getPlayerRank", {"seasonid": "KPL2018QJS"}),
    ("kpl_players_2026", "https://kplshop-op.timi-esports.qq.com/kplow/getPlayerRank", {"seasonid": "KPL2026S1"}),
]


def probe(spec):
    name, url, body = spec
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers={
        "User-Agent": "Mozilla/5.0", "Content-Type": "application/json",
        "Origin": "https://kpl.qq.com" if body is not None else "https://pvp.qq.com",
        "Referer": "https://kpl.qq.com/" if body is not None else "https://pvp.qq.com/",
    })
    result = {"name": name, "url": url, "body": body}
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            value = json.load(response)
        result["status"] = value.get("code", value.get("result"))
        payload = value.get("results", value.get("data"))
        result["shape"] = type(payload).__name__
        result["count"] = len(payload) if isinstance(payload, (list, dict)) else 0
        result["response"] = value
    except Exception as error:
        result["error"] = str(error)
    return result


def main():
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(probe, PROBES))
    output = ROOT / "data/raw/source_probe_2026-09-07.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"checkedAt": datetime.now(timezone.utc).isoformat(), "probes": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    for result in results:
        print(json.dumps({k: v for k, v in result.items() if k != "response"}, ensure_ascii=True))


if __name__ == "__main__":
    main()
