"""按同届赛事、同队、同名的唯一交集建立两套官方选手 ID 对照。"""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def build():
    raw = read("data/raw/kplow/player_perf.json")
    players = read("data/processed/players.json")["players"]
    records = read("data/processed/player_season_stats.json")["records"]
    teams = {p["slug"]: p["franchise_id"] for p in read("data/processed/franchises.json")["franchises"]}
    names = {p["player_id"]: p["name"] for p in players}
    aliases = read("guessing/config/quiz.json").get("playerIdAliases", {})
    lookup = defaultdict(set)
    for row in records:
        if row.get("games", 0) > 0:
            lookup[(row["season_id"], row.get("team_franchise"), names.get(row["player_id"]))].add(aliases.get(row["player_id"], row["player_id"]))
    evidence = defaultdict(set)
    appearances = []
    for season in raw["seasons"]:
        if season.get("status") != 0:
            continue
        for row in season.get("response", {}).get("data", []):
            fid = teams.get(row["team_id"].split("_", 1)[-1])
            candidates = lookup[(season["name"], fid, row["player_short_name"])]
            if len(candidates) == 1:
                evidence[row["player_id"]].update(candidates)
            appearances.append({"seasonId": season["name"], "franchiseId": fid, **row})
    profiles = {}
    unresolved = []
    for row in appearances:
        candidates = evidence[row["player_id"]]
        if len(candidates) != 1:
            unresolved.append(row)
            continue
        canonical = next(iter(candidates))
        profile = profiles.setdefault(canonical, {"playerId": canonical, "officialPlayerIds": set(), "realNames": set(), "nicknames": set(), "appearances": []})
        profile["officialPlayerIds"].add(row["player_id"])
        profile["realNames"].add(row["player_real_name"])
        profile["nicknames"].add(row["player_short_name"])
        profile["appearances"].append(row)
    for profile in profiles.values():
        for field in ["officialPlayerIds", "realNames", "nicknames"]:
            profile[field] = sorted(profile[field] - {""})
    return {"schemaVersion": 1, "checkedAt": raw["checkedAt"],
            "source": "https://kplshop-op.timi-esports.qq.com/kplow/getSeasonPlayerPerf",
            "identityRule": "Unique same-season, same-franchise, same-nickname match; conflicting IDs excluded",
            "profiles": sorted(profiles.values(), key=lambda p: p["playerId"]), "unresolved": unresolved}


if __name__ == "__main__":
    doc = build()
    output = ROOT / "data/curated/official_player_profiles.json"
    output.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"profiles": len(doc["profiles"]), "rows": sum(len(p["appearances"]) for p in doc["profiles"]), "unresolvedRows": len(doc["unresolved"]), "conflictingRealNames": [p["playerId"] for p in doc["profiles"] if len(p["realNames"]) != 1]}))
