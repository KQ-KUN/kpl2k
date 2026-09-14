"""从已采集逐局证据构建历史补充；不推断缺失阵容，不覆盖官方已有赛事。"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build(identities, evidence):
    profiles = {}
    used_ids = set()
    for pid, identity in identities["players"].items():
        source_id = identity["wanplusPlayerId"]
        if source_id in used_ids or source_id in identities.get("excludedAmbiguousIds", {}):
            raise ValueError(f"重复或有歧义的身份映射: {source_id}")
        used_ids.add(source_id)
        events = []
        def event_order(item):
            event_id = item[0]
            stage = 3 if event_id.endswith("W") else 1 if event_id.startswith("KCC") else 2 if event_id.endswith("S2") else 0
            return int(re.search(r"20\d{2}", event_id)[0]), stage
        for event_id, doc in sorted(evidence.items(), key=event_order):
            mids = set()
            team_matches = {}
            for match in doc["matches"]:
                for player in match.get("players", []):
                    if player["wanplusPlayerId"] != source_id:
                        continue
                    if player["nickname"] not in identity["aliases"]:
                        raise ValueError(f"未审查的别名: {source_id} {player['nickname']}")
                    mids.add(match["matchId"])
                    team_id = player.get("wanplusTeamId")
                    if team_id:
                        if team_id not in identities["teams"]:
                            raise ValueError(f"未审查的战队: {team_id}")
                        fid = identities["teams"][team_id]["franchiseId"]
                        team_matches.setdefault(fid, set()).add(match["matchId"])
            if mids:
                events.append({"eventId": event_id, "year": int(re.search(r"20\d{2}", event_id)[0]),
                               "matchIds": sorted(mids, key=int),
                               "teamMatchIds": {fid: sorted(ids, key=int) for fid, ids in sorted(team_matches.items())}})
        if not events:
            raise ValueError(f"身份没有逐局证据: {pid}")
        profiles[pid] = {**identity, "events": events}
    return {"schemaVersion": 1, "checkedAt": max(doc["checkedAt"] for doc in evidence.values()),
            "provider": "WanPlus (non-official)",
            "countingRule": "Only individually recorded match appearances; partial event coverage, not full-season totals",
            "teams": identities["teams"], "players": profiles}


def main():
    folder = ROOT / "data/curated"
    identities = json.loads((folder / "wanplus_identity_map.json").read_text(encoding="utf-8"))
    evidence = {}
    for path in sorted(folder.glob("wanplus_K*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        event_id = doc["sampleEventId"]
        if event_id in evidence:
            raise ValueError(f"重复赛事证据: {event_id}")
        evidence[event_id] = doc
    result = build(identities, evidence)
    (folder / "historical_appearances.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"players": len(result["players"]), "events": len(evidence),
                      "playerEvents": sum(len(p["events"]) for p in result["players"].values())}))


if __name__ == "__main__":
    main()
