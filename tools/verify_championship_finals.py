"""Compare the curated finals roster with cached official per-game responses.

Run after crawl_kpl.py. Missing archives are reported, never counted as passes.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    events = read(ROOT / "data/curated/championships.json")["events"]
    matches_by_date = {}
    for path in sorted((ROOT / "data/raw").glob("league_*_matches.json")):
        for match in read(path).get("results", []):
            scores = [int(match.get(camp, {}).get("score", 0)) for camp in ("camp1", "camp2")]
            if max(scores) < 4 or match.get("status") != 2:
                continue
            matches_by_date.setdefault(match["start_time"][:10], []).append(match)
    results = []
    for event in events:
        matches = matches_by_date.get(event["date"], [])
        if len(matches) != 1:
            results.append({"eventId": event["id"], "status": "no-unique-official-match"})
            continue
        match = matches[0]
        winner = max((match["camp1"], match["camp2"]), key=lambda camp: int(camp["score"]))
        names, sources = set(), []
        for battle in match.get("match_battle_video_list", []):
            path = ROOT / f'data/raw/battles/{match["league_id"]}_{match["match_id"]}_{battle["battle_id"]}.json'
            if not path.exists():
                continue
            response = read(path)
            if response.get("code") != 200:
                continue
            for player in response.get("data", {}).get("battle_player_list", []):
                if str(player.get("team_id")) == str(winner["team_id"]):
                    name = str(player.get("actual_player_name") or player.get("player_name") or "").rsplit(".", 1)[-1]
                    names.add({"1dao": "妖刀", "6.6": "六点六"}.get(name, name))
            sources.append(f'https://prod.comp.smoba.qq.com/leaguesite/battle/open?battle_id={battle["battle_id"]}')
        results.append({
            "eventId": event["id"], "matchId": match["match_id"],
            "status": "matched" if names == set(event["starters"]) else "needs-manual-evidence",
            "officialNames": sorted(names), "expectedNames": event["starters"], "sources": sources,
        })
    output = {"verifiedAt": "2026-09-05", "source": "Cached responses of Tencent official smoba match API", "events": results}
    (ROOT / "data/curated/finals_verification.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for result in results:
        print(result["eventId"], result["status"])


if __name__ == "__main__":
    main()
