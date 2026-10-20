"""Build the KPL Link teammate graph from KPL 2K processed data.

Modern edges use season/team attribution. Historical edges require a recorded
same-side match lineup and reviewed provider-to-canonical identity mappings.
"""

from __future__ import annotations

import json
import argparse
import hashlib
from datetime import datetime, timezone
import re
from collections import defaultdict, deque
from itertools import combinations
from pathlib import Path
from typing import Any
try:
    from .official_rosters import load_roster
    from .attribution import membership_records
except ImportError:
    from official_rosters import load_roster
    from attribution import membership_records


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


def build_data(source_root: Path, quiz_data: Path, quiz_config: Path) -> tuple[dict, dict]:
    processed = source_root / 'data/processed'
    players_doc = load(processed / "players.json")
    attribution_doc = load(processed / "player_attribution.json")
    seasons_doc = load(processed / "seasons.json")
    franchises_doc = load(processed / "franchises.json")
    icons_doc = load(processed / "player_icon_cache.json")
    quiz_doc = load(quiz_data)
    quiz_config = load(quiz_config)
    registration = load(source_root / 'data/curated/official_rosters_2026_annual.json')
    registered = [p['playerId'] for team in registration['teams'] for p in team['players']]
    if registration['seasonId'] != 'KPL2026S3' or len(registration['teams']) != 12 or len(registered) != 84 or len(set(registered)) != 84:
        raise ValueError('Unexpected or duplicate official registration identities')
    canonical_players = {p['player_id']: p for p in players_doc['players']}
    registered_teams = set()
    for team in registration['teams']:
        if team['franchiseId'] in registered_teams or len(team['players']) != 7:
            raise ValueError('Duplicate team or incomplete seven-player roster')
        registered_teams.add(team['franchiseId'])
        for player in team['players']:
            pid = player['playerId']
            if not player['name'] or not player['realName']: raise ValueError('Unidentified registered player')
            if player['identityKind'] == 'canonical':
                if pid not in canonical_players or canonical_players[pid]['name'] != player['name']:
                    raise ValueError(f'Unreviewed canonical registration identity: {pid}')
            elif player['identityKind'] == 'smoba-openid':
                if not re.fullmatch('[A-F0-9]{32}', pid): raise ValueError('Invalid official openid')
            elif player['identityKind'] != 'registration-only' or pid != 'REGISTERED_EDGM_ZHAOHAOWEI':
                raise ValueError('Unreviewed registration identity')
    corrections = load(source_root / "data/curated/player_identity_corrections.json")
    attribution_ids = {(r["season_id"], r["team_franchise"], r["player_name"]): r["player_id"]
                       for r in corrections["attributionIdentities"]}

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
    for record in membership_records(attribution_doc["records"]):
        season_id = str(record.get("season_id") or "")
        team_id = str(record.get("team_franchise") or "")
        player_name = str(record.get("player_name") or "").strip()
        if not season_id or not team_id or not player_name:
            continue
        # A reviewed context binding takes precedence over a unique nickname.
        # GK's 2019 未央 is not AG's later namesake even when only AG is in the leaderboard.
        bound_id = attribution_ids.get((season_id, team_id, player_name)) or record.get("player_id")
        if bound_id and canonical(bound_id) not in merged:
            raise ValueError(f"unknown reviewed attribution identity: {bound_id}")
        candidates = {canonical(bound_id)} if bound_id else set(candidates_by_name.get(player_name, set()))
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

    identities = load(source_root / "data/curated/wanplus_identity_map.json")
    documents = {}
    for path in sorted((source_root / "data/curated").glob("wanplus_K*.json")):
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
        correction = corrections["players"].get(player_id, {})
        item["aliases"].update(correction.get("aliases", []))
        if correction.get("link_name"):
            item["name"] = correction["link_name"]
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
                "recentTeamName": correction.get("team_names", {}).get(team_id, team_label),
                "active": registration['seasonId'] in item['teams'] or bool(quiz.get("active", False)),
                "debutYear": quiz.get("debutYear") or (min(known_years) if known_years else None),
                "totalGames": (sum(int(r.get("games") or 0) for r in attribution_doc["records"]
                                   if attribution_ids.get((r["season_id"], r["team_franchise"], r["player_name"])) == player_id)
                               + len({(sid, source) for sid, _, roster, source in history if player_id in roster}))
                              if player_id == "WP26473" else int(quiz.get("totalGames") or 0),
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
        for player_id in (left, right):
            reviewed_team = corrections["players"].get(player_id, {}).get("team_names", {}).get(team_id)
            if reviewed_team:
                proof["teamName"] = reviewed_team
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

    data_version = max(registration['checkedAt'], corrections['checkedAt'])
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
                **({"pendingAttributionRows": len(attribution_doc["pending_review"]),
                    "attributionInputAudit": attribution_doc.get("input_audit")}
                   if "pending_review" in attribution_doc else {}),
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
    parser = argparse.ArgumentParser(description='Explicit full build or fact-preserving frozen snapshot split')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--source', type=Path, help='canonical repository root; requires explicit quiz inputs')
    mode.add_argument('--snapshot-source', type=Path, help='directory containing frozen players.json/link_graph.json')
    parser.add_argument('--quiz-data', type=Path)
    parser.add_argument('--quiz-config', type=Path)
    parser.add_argument('--quiz-source-commit', help='verified commit containing the explicit quiz inputs for a full build')
    parser.add_argument('--output', type=Path, required=True, help='Link public/data output directory')
    parser.add_argument('--source-commit', required=True, help='verified 40-character commit of actual primary input repository')
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.source_commit): parser.error('source-commit must be a full commit SHA')
    if args.source:
        if not args.quiz_data or not args.quiz_config: parser.error('full build requires --quiz-data and --quiz-config')
        if not args.quiz_source_commit or not re.fullmatch('[0-9a-f]{40}', args.quiz_source_commit): parser.error('full build requires a complete --quiz-source-commit')
        players, graph = build_data(args.source, args.quiz_data, args.quiz_config)
        input_paths = [*sorted((args.source / 'data/processed').glob('*.json')), *sorted((args.source / 'data/curated').glob('*.json')), args.quiz_data, args.quiz_config]
        input_locations = [({'path': path.relative_to(args.source).as_posix(), 'sourceCommit': args.source_commit}
                            if path not in (args.quiz_data, args.quiz_config) else
                            {'path': 'quiz/' + path.name, 'sourceCommit': args.quiz_source_commit}) for path in input_paths]
    else:
        input_paths = [args.snapshot_source / 'players.json', args.snapshot_source / 'link_graph.json']
        input_locations = [{'path': 'public/data/' + path.name, 'sourceCommit': args.source_commit} for path in input_paths]
        players, graph = (load(path) for path in input_paths)
        if 'evidence' not in graph: parser.error('snapshot-source must contain the original frozen full evidence graph')
    emit_snapshot(players, graph, args.output, args.source_commit, input_paths, frozen=bool(args.snapshot_source), input_locations=input_locations)
    print_stats(graph['stats'])


def emit_snapshot(players, graph, output, source_commit, input_paths, *, frozen, input_locations=None):
    # Capture hashes before writing, including when output equals the input directory.
    digest = lambda data: hashlib.sha256(data).hexdigest()
    if not re.fullmatch('[0-9a-f]{40}', source_commit): raise ValueError('source_commit must be a full commit SHA')
    if input_locations is None: input_locations = [{'path': path.name, 'sourceCommit': source_commit} for path in input_paths]
    if len(input_locations) != len(input_paths): raise ValueError('input location count mismatch')
    inputs = [{**location, 'sha256': digest(path.read_bytes())} for path, location in zip(input_paths, input_locations)]
    ids = {p['id'] for p in players['players']}
    if len(ids) != len(players['players']) or set(graph['adjacency']) != ids: raise ValueError('player/graph ID mismatch')
    if players['dataVersion'] != graph['dataVersion']: raise ValueError('input versions differ')
    # The legacy checked date describes the frozen facts, not the generated version.
    legacy_version = graph['dataVersion']
    data_version = 'source:' + source_commit
    for left, neighbors in graph['adjacency'].items():
        if len(set(neighbors)) != len(neighbors) or left in neighbors: raise ValueError('duplicate neighbor or self edge')
        for right in neighbors:
            if right not in ids or left not in graph['adjacency'][right]: raise ValueError('asymmetric or unknown neighbor')
            if '|'.join(sorted((left, right))) not in graph['evidence']: raise ValueError('edge missing evidence')
    latest = {pid: None for pid in ids}
    for key, proofs in graph['evidence'].items():
        left, right = key.split('|')
        if left not in ids or right not in graph['adjacency'][left]: raise ValueError(f'orphan evidence {key}')
        for proof in proofs:
            year = year_from_season(proof['seasonId'])
            if year is not None:
                for pid in (left, right): latest[pid] = max(latest[pid] or year, year)
    runtime = {key: value for key, value in graph.items() if key != 'evidence'}
    runtime['dataVersion'] = data_version
    runtime['sourceAudit'] = {**graph.get('sourceAudit', {}), 'legacyDataVersion': legacy_version}
    runtime['latestYear'] = {pid: latest[pid] for pid in sorted(latest)}
    evidence = {'schemaVersion': 1, 'dataVersion': data_version, 'evidence': graph['evidence']}
    write(output / 'players.json', {**players, 'dataVersion': data_version})
    write(output / 'link_graph.json', runtime)
    write(output / 'link_evidence.json', evidence)
    public = output.parent
    files = [output / name for name in ('players.json', 'link_graph.json', 'link_evidence.json')]
    files += sorted({public / p['avatar'].removeprefix('./') for p in players['players'] if p.get('avatar')})
    missing = [str(path) for path in files if not path.is_file()]
    if missing: raise ValueError(f'missing final assets: {missing[:3]}')
    manifest = {'schemaVersion': 1, 'sourceCommit': source_commit, 'dataVersion': data_version,
        'inputs': inputs, 'outputs': [{'path': 'public/' + path.relative_to(public).as_posix(), 'sha256': digest(path.read_bytes()), 'bytes': path.stat().st_size} for path in files],
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'generator': {'name': 'tools/build_link_graph.py', 'version': digest(Path(__file__).read_bytes())},
        'coverage': {**graph['stats'], 'evidenceEdges': len(graph['evidence']), 'evidenceRecords': sum(map(len, graph['evidence'].values()))},
        'exclusionRules': ['No nickname identity merge', 'No missing historical lineup edges', 'No fact changes when deriving frozen snapshot'],
        'semantics': {'latestYear': 'maximum evidence season year per player; null means unknown', 'totalGames': 'source appearance count; not inferred from graph degree', 'frozenDerivation': frozen, 'upstreamRawRebuild': not frozen},
        'identities': {'canonicalIds': len(ids), 'duplicates': len(players['players']) - len(ids), 'unmappedAttribution': graph.get('sourceAudit', {}).get('unmappedRecords')},
        'resources': {'avatarRefs': sum(bool(p.get('avatar')) for p in players['players']), 'localAvatars': len(files) - 3, 'missingAvatars': sum(not p.get('avatar') for p in players['players']), 'externalAvatars': sum(str(p.get('avatar', '')).startswith('http') for p in players['players'])},
        'quality': {'historicalComplete': graph.get('sourceAudit', {}).get('historical', {}).get('complete'), 'sourceChain': 'frozen consumer snapshot; original provenance retained in sourceAudit' if frozen else 'explicit canonical and quiz inputs'}}
    write(output / 'manifest.json', manifest)


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
