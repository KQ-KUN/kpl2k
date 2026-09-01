#!/usr/bin/env python3
"""Build the KPL quiz snapshot from a checked KPL 2K workspace."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT.parent / "KPL 2K"
DEFAULT_OUTPUT = ROOT / "public" / "data"
DEFAULT_CONFIG = ROOT / "config" / "quiz.json"
POSITION_ORDER = ("对抗路", "打野", "中路", "发育路", "游走")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def normalized_search_key(value: str) -> str:
    return "".join(value.casefold().split())


def source_commit(source: Path) -> str:
    try:
        result = subprocess.run(
            [
                "git",
                "-c",
                f"safe.directory={source.as_posix()}",
                "-C",
                str(source),
                "rev-parse",
                "--short",
                "HEAD",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def current_franchise_name(franchise: dict[str, Any]) -> str:
    for key in ("current_names", "abbreviations"):
        names = franchise.get(key, [])
        if names:
            return str(names[0])
    return str(franchise["franchise_id"])


def build_snapshot(source: Path, config_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    processed = source / "data" / "processed"
    required = (
        "players.json",
        "player_season_stats.json",
        "seasons.json",
        "franchises.json",
    )
    missing = [name for name in required if not (processed / name).is_file()]
    if missing:
        raise FileNotFoundError(f"KPL 2K 数据缺失：{', '.join(missing)}")

    config = load_json(config_path)
    career_path = config_path.with_name("career_history.json")
    career_doc = load_json(career_path) if career_path.is_file() else {"players": {}}
    career_by_nickname = {
        str(nickname): value
        for nickname, value in career_doc.get("players", {}).items()
    }
    roster_path = config_path.with_name("championship_rosters.json")
    roster_doc = load_json(roster_path) if roster_path.is_file() else {"events": []}
    roster_tracked_names = {
        str(nickname) for nickname in roster_doc.get("trackedNicknames", [])
    }
    roster_title_counts: Counter[str] = Counter()
    roster_event_ids: set[str] = set()
    for event in roster_doc.get("events", []):
        event_id = str(event["id"])
        if event_id in roster_event_ids:
            raise ValueError(f"冠军首发赛事 ID 重复：{event_id}")
        roster_event_ids.add(event_id)
        starters = [str(nickname) for nickname in event["starters"]]
        if len(starters) != 5 or len(set(starters)) != 5:
            raise ValueError(f"冠军首发名单必须恰好五人且不重复：{event_id}")
        roster_title_counts.update(starters)
    players_doc = load_json(processed / "players.json")
    stats_doc = load_json(processed / "player_season_stats.json")
    seasons_doc = load_json(processed / "seasons.json")
    franchises_doc = load_json(processed / "franchises.json")

    data_versions = {
        players_doc.get("data_version"),
        stats_doc.get("data_version"),
        seasons_doc.get("data_version"),
        franchises_doc.get("data_version"),
    }
    if None in data_versions or len(data_versions) != 1:
        raise ValueError(f"processed 数据版本不一致：{sorted(str(v) for v in data_versions)}")
    data_version = str(next(iter(data_versions)))

    player_by_id = {str(item["player_id"]): item for item in players_doc["players"]}
    season_by_id = {
        str(item["season_id"]): item
        for item in seasons_doc["seasons"]
        if item.get("is_battlefield") is True
    }
    franchise_by_id = {
        str(item["franchise_id"]): item for item in franchises_doc["franchises"]
    }
    minimum_games = int(config["minimumGamesPerEvent"])
    minimum_games_overrides = {
        str(name): int(value)
        for name, value in config.get("minimumGamesPerEventOverrides", {}).items()
    }
    popular_names = {str(name) for name in config["popularNames"]}
    fmvp_names = {str(name) for name in config["fmvpNames"]}
    active_seasons = {str(value) for value in config["activeSeasonIds"]}
    unknown_player_ids: set[str] = set()
    records_by_player: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for record in stats_doc["records"]:
        player_id = str(record["player_id"])
        if player_id not in player_by_id:
            unknown_player_ids.add(player_id)
            continue
        if str(record["season_id"]) not in season_by_id:
            continue
        nickname = str(player_by_id[player_id].get("name", "")).strip()
        required_games = minimum_games_overrides.get(nickname, minimum_games)
        if int(record.get("games", 0)) < required_games:
            continue
        if record.get("position") not in POSITION_ORDER:
            continue
        records_by_player[player_id].append(record)

    championship_seasons_by_player: dict[str, set[str]] = defaultdict(set)
    for player_id, records in records_by_player.items():
        for record in records:
            season_id = str(record["season_id"])
            team_franchise = str(record.get("team_franchise", ""))
            if season_by_id[season_id].get("champion_franchise") != team_franchise:
                continue
            championship_seasons_by_player[player_id].add(season_id)

    quiz_players: list[dict[str, Any]] = []
    career_audit: list[dict[str, Any]] = []
    roster_audit: list[dict[str, Any]] = []
    eligible_http_icons = 0
    for player_id, records in records_by_player.items():
        player = player_by_id[player_id]
        nickname = str(player.get("name", "")).strip()
        if not nickname:
            continue

        ordered_records = sorted(
            records,
            key=lambda row: (
                str(season_by_id[str(row["season_id"])].get("end_time", "")),
                str(row["season_id"]),
            ),
        )
        latest = ordered_records[-1]
        latest_team_id = str(latest.get("team_franchise", ""))
        latest_franchise = franchise_by_id.get(latest_team_id)
        latest_team_name = (
            current_franchise_name(latest_franchise)
            if latest_franchise
            else str(latest.get("team_name_current", latest_team_id))
        )
        position_set = {str(row["position"]) for row in records}
        team_history = list(
            dict.fromkeys(str(row.get("team_franchise", "")) for row in ordered_records if row.get("team_franchise"))
        )
        team_history_names = [
            current_franchise_name(franchise_by_id[team_id])
            if team_id in franchise_by_id
            else team_id
            for team_id in team_history
        ]
        event_ids = {str(row["season_id"]) for row in records}
        event_count = len(event_ids)
        total_games = sum(int(row.get("games", 0)) for row in records)
        peak_rating = max(float(row.get("rating", 0)) for row in records)
        source_championship_count = len(championship_seasons_by_player[player_id])
        years = [int(season_by_id[str(row["season_id"])]["year"]) for row in records]
        source_debut_year = min(years)
        career = career_by_nickname.get(nickname)
        debut_year = int(career["debutYear"]) if career else source_debut_year
        championship_count = (
            int(roster_title_counts[nickname])
            if nickname in roster_tracked_names
            else source_championship_count
        )
        if career:
            career_audit.append(
                {
                    "playerId": player_id,
                    "nickname": nickname,
                    "page": str(career["page"]),
                    "debutYear": debut_year,
                    "sourceDebutYear": source_debut_year,
                }
            )
        if nickname in roster_tracked_names:
            roster_audit.append(
                {
                    "playerId": player_id,
                    "nickname": nickname,
                    "championshipCount": championship_count,
                    "sourceChampionshipCount": source_championship_count,
                }
            )

        difficulties = ["hardcore"]
        normal = config["normal"]
        if (
            nickname in popular_names
            or (
                event_count >= int(normal["minimumEvents"])
                and total_games >= int(normal["minimumGames"])
            )
        ):
            difficulties.insert(0, "normal")
        if nickname in popular_names:
            difficulties.insert(0, "popular")

        raw_icon = str(player.get("player_icon", "")).strip()
        if raw_icon.startswith("http://"):
            eligible_http_icons += 1
        icon_url = raw_icon if raw_icon.startswith("https://") else ""
        search_key = normalized_search_key(nickname)
        quiz_players.append(
            {
                "id": player_id,
                "nickname": nickname,
                "aliases": [search_key] if search_key else [],
                "iconUrl": icon_url,
                "positions": [position for position in POSITION_ORDER if position in position_set],
                "latestTeamId": latest_team_id,
                "latestTeamName": latest_team_name,
                "teamHistory": team_history,
                "teamHistoryNames": team_history_names,
                "debutYear": debut_year,
                "latestYear": max(years),
                "hasFmvp": nickname in fmvp_names,
                "championshipCount": championship_count,
                "totalGames": total_games,
                "peakRating": round(peak_rating, 1),
                "active": bool(event_ids & active_seasons),
                "difficulty": difficulties,
            }
        )

    quiz_players.sort(key=lambda player: str(player["id"]))
    nickname_groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for player in quiz_players:
        nickname_groups[normalized_search_key(str(player["nickname"]))].append(
            {"id": str(player["id"]), "nickname": str(player["nickname"])}
        )
    duplicate_nicknames = [group for group in nickname_groups.values() if len(group) > 1]

    fingerprints: dict[tuple[Any, ...], list[str]] = defaultdict(list)
    for player in quiz_players:
        fingerprint = (
            tuple(player["positions"]),
            player["latestTeamId"],
            player["debutYear"],
            player["latestYear"],
            player["hasFmvp"],
            player["championshipCount"],
            player["active"],
        )
        fingerprints[fingerprint].append(str(player["id"]))
    collisions = [ids for ids in fingerprints.values() if len(ids) > 1]

    canonical_players = json.dumps(
        quiz_players, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    snapshot = {
        "schemaVersion": 1,
        "dataVersion": data_version,
        "sourceCommit": source_commit(source),
        "playersHash": hashlib.sha256(canonical_players).hexdigest(),
        "players": quiz_players,
    }
    pool_counts = Counter(
        difficulty for player in quiz_players for difficulty in player["difficulty"]
    )
    audit = {
        "schemaVersion": 1,
        "dataVersion": data_version,
        "sourceCommit": snapshot["sourceCommit"],
        "playersHash": snapshot["playersHash"],
        "sourcePlayers": len(player_by_id),
        "eligiblePlayers": len(quiz_players),
        "poolCounts": {name: pool_counts[name] for name in ("popular", "normal", "hardcore")},
        "eligibleHttpsIcons": sum(bool(player["iconUrl"]) for player in quiz_players),
        "eligibleHttpIcons": eligible_http_icons,
        "sourceHttpsIcons": sum(
            str(player.get("player_icon", "")).strip().startswith("https://")
            for player in player_by_id.values()
        ),
        "sourceHttpIcons": sum(
            str(player.get("player_icon", "")).strip().startswith("http://")
            for player in player_by_id.values()
        ),
        "duplicateNicknameGroups": duplicate_nicknames,
        "attributeCollisionGroups": collisions,
        "unknownPlayerIds": sorted(unknown_player_ids),
        "missingPopularNames": sorted(popular_names - {str(player["nickname"]) for player in quiz_players}),
        "missingFmvpNames": sorted(fmvp_names - {str(player["nickname"]) for player in quiz_players}),
        "careerHistorySource": career_doc.get("source"),
        "careerHistoryOverrides": sorted(
            career_audit, key=lambda item: (item["nickname"], item["playerId"])
        ),
        "championshipRosterSource": roster_doc.get("source"),
        "championshipRosterOverrides": sorted(
            roster_audit, key=lambda item: (item["nickname"], item["playerId"])
        ),
    }
    validate(snapshot, audit)
    return snapshot, audit


def validate(snapshot: dict[str, Any], audit: dict[str, Any]) -> None:
    players = snapshot["players"]
    ids = [player["id"] for player in players]
    if len(ids) != len(set(ids)):
        raise ValueError("题库包含重复 player_id")
    if not players:
        raise ValueError("题库为空")
    if audit["poolCounts"]["popular"] > audit["poolCounts"]["normal"]:
        raise ValueError("热门池必须包含于常规池")
    if audit["poolCounts"]["normal"] > audit["poolCounts"]["hardcore"]:
        raise ValueError("常规池必须包含于硬核池")
    if audit["missingPopularNames"]:
        raise ValueError(f"入门明星未进入题库：{', '.join(audit['missingPopularNames'])}")
    if audit["missingFmvpNames"]:
        raise ValueError(f"FMVP 选手未进入题库：{', '.join(audit['missingFmvpNames'])}")
    for player in players:
        if not player["nickname"] or not player["positions"]:
            raise ValueError(f"选手缺少必要字段：{player['id']}")
        if player["debutYear"] > player["latestYear"]:
            raise ValueError(f"选手年份倒置：{player['id']}")


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def copy_library(source: Path, output: Path | None) -> tuple[int, int]:
    library_path = source / "data" / "processed" / "player_library.json"
    raw = library_path.read_text(encoding="utf-8")
    value = json.loads(raw)
    players = value.get("players")
    if not isinstance(players, list) or not players:
        raise ValueError("KPL 2K 选手图鉴数据为空或格式不兼容")
    version_count = sum(int(player.get("version_count", 0)) for player in players)
    if output is not None:
        destination = output / "player_library.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_text(raw.rstrip() + "\n", encoding="utf-8")
        temporary.replace(destination)
    return len(players), version_count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--check", action="store_true", help="只构建和校验，不写文件")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    snapshot, audit = build_snapshot(source, args.config.resolve())
    if not args.check:
        from cache_player_icons import cache_player_icons

        write_json(args.output / "quiz_players.json", snapshot)
        write_json(args.output / "quiz_data_audit.json", audit)
        library_players, library_versions = copy_library(source, args.output)
        cached_icons, remote_icons = cache_player_icons(args.output)
    else:
        library_players, library_versions = copy_library(source, None)
        cached_icons, remote_icons = 0, 0
    pools = audit["poolCounts"]
    print(
        "题库校验通过："
        f"{audit['eligiblePlayers']} 人，热门 {pools['popular']} / "
        f"常规 {pools['normal']} / 硬核 {pools['hardcore']}，"
        f"HTTPS 照片 {audit['eligibleHttpsIcons']}；"
        f"图鉴 {library_players} 人 / {library_versions} 个年度版本；"
        f"本地头像 {cached_icons} / 远程回退 {remote_icons}"
    )


if __name__ == "__main__":
    main()
