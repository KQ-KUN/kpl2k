"""Build the KPL Link teammate graph from KPL 2K processed data.

Modern edges use season/team attribution. Historical edges require a recorded
same-side match lineup and reviewed provider-to-canonical identity mappings.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict, deque
from itertools import combinations
from pathlib import Path
from typing import Any
try:
    from .official_rosters import load_roster
except ImportError:
    from official_rosters import load_roster


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
OUTPUT = ROOT / "link" / "public" / "data"
QUIZ_DATA = ROOT / "guessing" / "public" / "data" / "quiz_players.json"
QUIZ_CONFIG = ROOT / "guessing" / "config" / "quiz.json"
HISTORICAL_EVENTS = {
    "KPL2016S2": ("2016 KPL 秋季赛", "2016-12-18", "KPL2016QJS"),
    "KPL2017S1": ("2017 KPL 春季赛", "2017-07-08", "KPL2017CJS"),
    "KCC2017": ("2017 冠军杯", "2017-08-19", "KPL2017CJS"),
    "KPL2017S2": ("2017 KPL 秋季赛", "2017-12-23", "KPL2017QJS"),
    "KPL2018S1": ("2018 KPL 春季赛", "2018-07-08", "KPL2018CJS"),
    "KCC2018": ("2018 冠军杯", "2018-08-11", "KPL2018CJS"),
    "KPL2018S2": ("2018 KPL 秋季赛", "2018-12-22", "KPL2018QJS"),
    "KCC2018W": ("2018 冬季冠军杯", "2019-01-13", "KPL2018QJS"),
}


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def year_from_season(season_id: str) -> int | None:
    match = re.search(r"20\d{2}", season_id)
    return int(match.group()) if match else None


def teammate_pairs(rosters: dict[tuple[str, str], set[str]]):
    """Yield only players listed together in one concrete season/team roster."""
    for (season_id, team_id), roster in sorted(rosters.items()):
        for left, right in combinations(sorted(roster), 2):
            yield left, right, season_id, team_id


def historical_lineups(identities, documents, known_ids, aliases):
    """Map reviewed identities only; preserve each match's actual team side."""
    by_provider = {}
    for source_id, identity in identities["players"].items():
        provider_id = identity["wanplusPlayerId"]
        player_id = aliases.get(source_id, source_id)
        if provider_id in by_provider or provider_id in identities.get("excludedAmbiguousIds", {}):
            raise ValueError(f"duplicate/ambiguous historical identity: {provider_id}")
        if player_id not in known_ids:
            raise ValueError(f"unknown historical canonical identity: {player_id}")
        by_provider[provider_id] = (player_id, identity)
    lineups = []
    seen_matches = set()
    excluded = defaultdict(set)
    missing_lineups = 0
    for event_id, doc in sorted(documents.items()):
        if event_id not in HISTORICAL_EVENTS or doc["sampleEventId"] != event_id:
            raise ValueError(f"unknown/mismatched historical event: {event_id}")
        for match in doc["matches"]:
            match_id = match["matchId"]
            key = (event_id, match_id)
            if key in seen_matches:
                raise ValueError(f"duplicate historical match: {key}")
            seen_matches.add(key)
            if "players" not in match:
                missing_lineups += 1
                continue
            players = match["players"]
            sides = defaultdict(list)
            for player in players:
                sides[player.get("wanplusTeamId", "")].append(player)
            if (len(players) != 10 or len({p["wanplusPlayerId"] for p in players}) != 10
                    or len(sides) != 2 or "" in sides or any(len(s) != 5 for s in sides.values())):
                raise ValueError(f"invalid historical team sides: {key}")
            if match["source"] != f"https://wanplus.cn/match/{match_id}.html":
                raise ValueError(f"invalid historical match source: {key}")
            for team_id, side in sides.items():
                roster = set()
                for player in side:
                    provider_id = player["wanplusPlayerId"]
                    if provider_id not in by_provider:
                        excluded[provider_id].add(player["nickname"])
                        continue
                    player_id, identity = by_provider[provider_id]
                    if player["nickname"] not in identity["aliases"]:
                        raise ValueError(f"unreviewed historical alias: {provider_id}/{player['nickname']}")
                    roster.add(player_id)
                if not roster:
                    continue
                if team_id not in identities["teams"]:
                    raise ValueError(f"unreviewed historical team: {team_id}")
                lineups.append((event_id, identities["teams"][team_id]["franchiseId"], roster, match["source"]))
    return lineups, {
        "events": len(documents), "matches": len(seen_matches),
        "missingLineups": missing_lineups, "reviewedIdentities": len(by_provider),
        "excludedIdentities": [{"providerId": key, "names": sorted(value)} for key, value in sorted(excluded.items())],
        "complete": False, "provider": "WanPlus (non-official)",
    }


def build_data() -> tuple[dict, dict]:
    players_doc = load(PROCESSED / "players.json")
    attribution_doc = load(PROCESSED / "player_attribution.json")
    seasons_doc = load(PROCESSED / "seasons.json")
    franchises_doc = load(PROCESSED / "franchises.json")
    icons_doc = load(PROCESSED / "player_icon_cache.json")
    quiz_doc = load(QUIZ_DATA)
    quiz_config = load(QUIZ_CONFIG)
    registration = load_roster()

    aliases: dict[str, str] = quiz_config.get("playerIdAliases", {})
    canonical = lambda player_id: aliases.get(player_id, player_id)

    season_by_id = {str(item["season_id"]): item for item in seasons_doc["seasons"]}
    season_by_id[registration['seasonId']] = {
        'name': registration['seasonName'], 'start_time': registration['startTime'],
        'end_time': registration['endTime'],
    }
    for event_id, (name, end_time, _) in HISTORICAL_EVENTS.items():
        season_by_id[event_id] = {"name": name, "end_time": end_time}
    season_order = {
        season_id: index
        for index, season_id in enumerate(
            sorted(
                season_by_id,
                key=lambda value: (
                    season_by_id[value].get("end_time") or "",
                    season_by_id[value].get("start_time") or "",
                    value,
                ),
            )
        )
    }
    franchise_by_id = {
        str(item["franchise_id"]): item for item in franchises_doc["franchises"]
    }
    icon_by_id: dict[str, str] = icons_doc.get("icons", {})
    quiz_by_id = {str(item["id"]): item for item in quiz_doc["players"]}

    merged: dict[str, dict[str, Any]] = {}
    for source in players_doc["players"]:
        source_id = str(source["player_id"])
        player_id = canonical(source_id)
        item = merged.setdefault(
            player_id,
            {
                "id": player_id,
                "name": "",
                "aliases": set(),
                "positions": set(),
                "teams": defaultdict(set),
                "source_ids": set(),
            },
        )
        item["source_ids"].add(source_id)
        source_name = str(source.get("name") or "").strip()
        if source_name:
            item["aliases"].add(source_name)
            if source_id == player_id or not item["name"]:
                item["name"] = source_name
        item["positions"].update(str(value) for value in source.get("positions", []) if value)
    # The raw player list is authoritative for identity, but its team field can
    # reflect the current franchise across historical seasons.  Team-season
    # membership therefore comes exclusively from the battle-derived
    # player_attribution records.
    sources_by_id = {str(item["player_id"]): item for item in players_doc["players"]}
    candidates_by_name: dict[str, set[str]] = defaultdict(set)
    for source_id, source in sources_by_id.items():
        name = str(source.get("name") or "").strip()
        if name:
            candidates_by_name[name].add(canonical(source_id))

    unmapped: list[tuple[str, str, str]] = []
    ambiguous: list[tuple[str, str, str]] = []
    for record in attribution_doc["records"]:
        season_id = str(record.get("season_id") or "")
        team_id = str(record.get("team_franchise") or "")
        player_name = str(record.get("player_name") or "").strip()
        if not season_id or not team_id or not player_name:
            continue
        candidates = set(candidates_by_name.get(player_name, set()))
        if len(candidates) > 1:
            by_season = {
                candidate
                for candidate in candidates
                if any(
                    season_id in sources_by_id[source_id].get("teams", {})
                    for source_id in merged[candidate]["source_ids"]
                )
            }
            if by_season:
                candidates = by_season
        if len(candidates) > 1:
            by_raw_team = {
                candidate
                for candidate in candidates
                if any(
                    str(sources_by_id[source_id].get("teams", {}).get(season_id) or "") == team_id
                    for source_id in merged[candidate]["source_ids"]
                )
            }
            if by_raw_team:
                candidates = by_raw_team
        if not candidates:
            unmapped.append((season_id, player_name, team_id))
            continue
        if len(candidates) != 1:
            ambiguous.append((season_id, player_name, team_id))
            continue
        player_id = next(iter(candidates))
        merged[player_id]["teams"][season_id].add(team_id)

    if ambiguous:
        sample = ", ".join(f"{season}/{name}/{team}" for season, name, team in ambiguous[:8])
        raise ValueError(f"ambiguous attribution identities ({len(ambiguous)}): {sample}")

    identities = load(ROOT / "data/curated/wanplus_identity_map.json")
    documents = {}
    for path in sorted((ROOT / "data/curated").glob("wanplus_K*.json")):
        doc = load(path)
        event_id = doc["sampleEventId"]
        if event_id in documents:
            raise ValueError(f"duplicate historical event: {event_id}")
        documents[event_id] = doc
    history, historical_audit = historical_lineups(identities, documents, set(merged), aliases)

    def team_name(team_id: str, season_id: str) -> str:
        team = franchise_by_id.get(team_id, {})
        by_season = team.get("names_by_season", {})
        current = team.get("current_names", [])
        historical_season = HISTORICAL_EVENTS.get(season_id, ("", "", ""))[2]
        historical_team = next((t["name"] for t in identities["teams"].values() if t["franchiseId"] == team_id), "")
        return str(by_season.get(season_id) or by_season.get(historical_season)
                   or historical_team or (current[0] if current else team_id))

    # Historical appearances supplement metadata, but historical edges below
    # are built per match so transfers within an event cannot join two rosters.
    modern_rosters = defaultdict(set)
    for player_id, item in merged.items():
        for season_id, team_ids in item["teams"].items():
            for team_id in team_ids:
                modern_rosters[(season_id, team_id)].add(player_id)
    for season_id, team_id, roster, _ in history:
        for player_id in roster:
            merged[player_id]["teams"][season_id].add(team_id)

    for team in registration['teams']:
        for player in team['players']:
            item = merged.setdefault(player['playerId'], {
                'id': player['playerId'], 'name': player['name'], 'aliases': set(),
                'positions': set(), 'teams': defaultdict(set), 'source_ids': set(),
            })
            item['aliases'].add(player['name'])
            item['positions'].add(player['position'])
            item['teams'][registration['seasonId']].add(team['franchiseId'])

    def latest_team(item: dict[str, Any]) -> tuple[str, str]:
        if not item["teams"]:
            return "", ""
        season_id = max(
            item["teams"].keys(),
            key=lambda value: (season_order.get(value, -1), year_from_season(value) or 0, value),
        )
        team_id = sorted(item["teams"][season_id])[0]
        return team_id, team_name(team_id, season_id)

    public_players: list[dict[str, Any]] = []
    for player_id, item in merged.items():
        quiz = quiz_by_id.get(player_id, {})
        item["aliases"].update(str(value) for value in quiz.get("aliases", []) if value)
        team_id, team_label = latest_team(item)
        source_icon = next(
            (icon_by_id.get(source_id, "") for source_id in sorted(
                item["source_ids"], key=lambda value: (value != player_id, value)
            ) if icon_by_id.get(source_id)),
            "",
        )
        # Link owns its avatar snapshot and can be deployed independently.
        avatar = f"./{source_icon}" if source_icon else ""
        years = [year_from_season(value) for value in item["teams"]]
        known_years = [value for value in years if value is not None]
        difficulty = quiz.get("difficulty", [])
        tier = "popular" if "popular" in difficulty else "normal" if "normal" in difficulty else "hardcore"
        public_players.append(
            {
                "id": player_id,
                "name": item["name"] or player_id,
                "aliases": sorted(item["aliases"], key=lambda value: (value.casefold(), value)),
                "avatar": avatar,
                "positions": sorted(item["positions"]),
                "recentTeamId": team_id,
                "recentTeamName": team_label,
                "active": registration['seasonId'] in item['teams'] or bool(quiz.get("active", False)),
                "debutYear": quiz.get("debutYear") or (min(known_years) if known_years else None),
                "totalGames": int(quiz.get("totalGames") or 0),
                "tier": tier,
            }
        )
    public_players.sort(key=lambda item: (str(item["name"]).casefold(), str(item["id"])))

    evidence: dict[str, list[dict[str, Any]]] = defaultdict(list)
    adjacency: dict[str, set[str]] = {item["id"]: set() for item in public_players}
    for left, right, season_id, team_id in teammate_pairs(modern_rosters):
        proof = {
            "teamId": team_id,
            "teamName": team_name(team_id, season_id),
            "seasonId": season_id,
            "seasonName": str(season_by_id.get(season_id, {}).get("name") or season_id),
        }
        adjacency[left].add(right)
        adjacency[right].add(left)
        evidence[f"{left}|{right}"].append(proof)

    historical_proofs = {}
    for season_id, team_id, roster, source in history:
        for left, right in combinations(sorted(roster), 2):
            key = (left, right, season_id, team_id)
            historical_proofs.setdefault(key, set()).add(source)
    for (left, right, season_id, team_id), sources in sorted(historical_proofs.items()):
        adjacency[left].add(right)
        adjacency[right].add(left)
        evidence[f"{left}|{right}"].append({
            "teamId": team_id, "teamName": team_name(team_id, season_id),
            "seasonId": season_id, "seasonName": season_by_id[season_id]["name"],
            "provider": historical_audit["provider"], "sourceUrls": sorted(sources),
        })
    historical_audit["teammatePairs"] = len({(l, r) for l, r, _, _ in historical_proofs})

    for team in registration['teams']:
        for left, right in combinations(sorted(p['playerId'] for p in team['players']), 2):
            adjacency[left].add(right)
            adjacency[right].add(left)
            evidence[f'{left}|{right}'].append({
                'teamId': team['franchiseId'], 'teamName': team['name'],
                'seasonId': registration['seasonId'], 'seasonName': registration['seasonName'],
                'provider': 'KPL official registered roster',
                'sourceUrls': [registration['sourceUrl'], team['sourceImage']],
            })

    for proofs in evidence.values():
        proofs.sort(
            key=lambda item: (season_order.get(item["seasonId"], -1), item["seasonId"], item["teamId"]),
            reverse=True,
        )

    compact_adjacency = {key: sorted(value) for key, value in sorted(adjacency.items())}
    compact_evidence = {key: value for key, value in sorted(evidence.items())}
    stats = graph_stats(compact_adjacency)

    data_version = registration['checkedAt']
    return (
        {
            "schemaVersion": 1,
            "dataVersion": data_version,
            "source": "KPL 2K processed players, official registered rosters, reviewed WanPlus historical lineups, and KPL Guessing metadata",
            "players": public_players,
        },
        {
            "schemaVersion": 1,
            "dataVersion": data_version,
            "rule": "same season_id and same franchise_id",
            "adjacency": compact_adjacency,
            "evidence": compact_evidence,
            "stats": stats,
            "sourceAudit": {
                "attributionRecords": len(attribution_doc["records"]),
                "unmappedRecords": len(unmapped),
                "unmappedReason": "source nickname has no canonical player identity; excluded rather than guessed",
                "historical": historical_audit,
                "registeredRoster": {
                    'seasonId': registration['seasonId'], 'teams': len(registration['teams']),
                    'players': sum(len(t['players']) for t in registration['teams']),
                    'teammatePairs': 252, 'sourceUrl': registration['sourceUrl'],
                },
            },
        },
    )


def main() -> None:
    players, graph = build_data()
    write(OUTPUT / "players.json", players)
    write(OUTPUT / "link_graph.json", graph)
    print(f"KPL Link graph built: {OUTPUT}")
    print(f"excluded attribution records: {graph['sourceAudit']['unmappedRecords']}")
    print_stats(graph["stats"])


def graph_stats(adjacency: dict[str, list[str]]) -> dict[str, Any]:
    unseen = set(adjacency)
    components: list[list[str]] = []
    while unseen:
        start = min(unseen)
        queue = deque([start])
        unseen.remove(start)
        component: list[str] = []
        while queue:
            current = queue.popleft()
            component.append(current)
            for neighbor in adjacency[current]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    queue.append(neighbor)
        components.append(component)
    components.sort(key=lambda value: (-len(value), value[0]))

    distance_distribution: dict[int, int] = defaultdict(int)
    diameter = 0
    for component in components:
        for start_index, start in enumerate(component):
            distances = {start: 0}
            queue = deque([start])
            while queue:
                current = queue.popleft()
                for neighbor in adjacency[current]:
                    if neighbor not in distances:
                        distances[neighbor] = distances[current] + 1
                        queue.append(neighbor)
            for target in component[start_index + 1 :]:
                distance = distances[target]
                distance_distribution[distance] += 1
                diameter = max(diameter, distance)

    edge_count = sum(len(value) for value in adjacency.values()) // 2
    node_count = len(adjacency)
    return {
        "playerCount": node_count,
        "edgeCount": edge_count,
        "componentCount": len(components),
        "largestComponent": len(components[0]) if components else 0,
        "isolatedPlayers": sum(1 for value in adjacency.values() if not value),
        "averageDegree": round((2 * edge_count / node_count) if node_count else 0, 3),
        "diameter": diameter,
        "distanceDistribution": {str(key): value for key, value in sorted(distance_distribution.items())},
    }


def print_stats(stats: dict[str, Any]) -> None:
    print(f"players={stats['playerCount']} edges={stats['edgeCount']}")
    print(
        f"components={stats['componentCount']} largest={stats['largestComponent']} "
        f"isolated={stats['isolatedPlayers']} average_degree={stats['averageDegree']}"
    )
    print(f"diameter={stats['diameter']} distance_distribution={stats['distanceDistribution']}")


if __name__ == "__main__":
    main()
