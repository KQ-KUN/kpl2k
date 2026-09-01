#!/usr/bin/env python3
"""抓取 KPL 官网 API 中仍可访问的 2016—2018 历史赛事数据。"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "public" / "data" / "kpl_history_2016_2018.json"
KPL_API = "https://kplshop-op.timi-esports.qq.com/kplow"
HEADERS = {
    "Content-Type": "application/json",
    "Origin": "https://kpl.qq.com",
    "Referer": "https://kpl.qq.com/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36"
    ),
}


def post(endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{KPL_API}/{endpoint}",
        data=json.dumps(body).encode("utf-8"),
        headers=HEADERS,
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                value = json.loads(response.read().decode("utf-8"))
            if value.get("result") != 0:
                raise RuntimeError(f"{endpoint}: {value.get('result')} {value.get('msg')}")
            return value
        except Exception as error:  # noqa: BLE001 - 网络错误需要重试
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"KPL API 请求失败：{endpoint} ({last_error})")


def count_rank_players(rank_data: Any) -> int:
    if not isinstance(rank_data, dict):
        return 0
    return len(
        {
            str(player.get("player_id", ""))
            for ranking in rank_data.values()
            if isinstance(ranking, list)
            for player in ranking
            if isinstance(player, dict) and player.get("player_id")
        }
    )


def team_summary(team: dict[str, Any]) -> dict[str, str]:
    return {
        "teamId": str(team.get("teamid", "")),
        "teamName": str(team.get("team_name", "")),
        "teamLogo": str(team.get("team_logo", "")),
    }


def match_summary(match: dict[str, Any]) -> dict[str, Any]:
    return {
        "scheduleId": str(match.get("scheduleid", "")),
        "stageId": str(match.get("stageid", "")),
        "stageName": str(match.get("stage_name", "")),
        "startTimestamp": int(match.get("start_timestamp") or 0),
        "teamAId": str(match.get("team_a_id", "")),
        "teamAName": str(match.get("team_a_name", "")),
        "teamAScore": int(match.get("team_a_score") or 0),
        "teamBId": str(match.get("team_b_id", "")),
        "teamBName": str(match.get("team_b_name", "")),
        "teamBScore": int(match.get("team_b_score") or 0),
        "status": int(match.get("schedule_status") or 0),
        "hasStarterInfo": bool(match.get("has_starter_info")),
    }


def build_season(season: dict[str, Any]) -> dict[str, Any]:
    season_id = str(season["seasonid"])
    meta = post("getSeasonAndStageAndTeamList", {"seasonid": season_id}).get("data", {})
    matches = post("getScheduleList", {"seasonid": season_id}).get("data", {}).get("list", [])
    completed = [match for match in matches if int(match.get("schedule_status") or 0) == 4]
    if not completed:
        raise ValueError(f"{season_id} 没有已完成赛程，无法判定冠军")
    finals = [
        match
        for match in completed
        if str(match.get("stageid", "")).casefold() in {"zjs", "js"}
        or "决赛" in str(match.get("stage_name", ""))
    ]
    final = max(finals or completed, key=lambda match: int(match.get("start_timestamp") or 0))
    if int(final.get("team_a_score") or 0) > int(final.get("team_b_score") or 0):
        champion_id = str(final.get("team_a_id", ""))
        champion_name = str(final.get("team_a_name", ""))
        runner_up_id = str(final.get("team_b_id", ""))
        runner_up_name = str(final.get("team_b_name", ""))
    else:
        champion_id = str(final.get("team_b_id", ""))
        champion_name = str(final.get("team_b_name", ""))
        runner_up_id = str(final.get("team_a_id", ""))
        runner_up_name = str(final.get("team_a_name", ""))

    rank_data = post("getPlayerRank", {"seasonid": season_id}).get("data", {})
    team_intro = post(
        "getTeamsIntro", {"seasonid": season_id, "teamid": champion_id}
    ).get("data", {})
    detail = post(
        "getScheduleDetail",
        {"seasonid": season_id, "scheduleid": str(final.get("scheduleid", ""))},
    ).get("data", {})
    roster = team_intro.get("player_msg") if isinstance(team_intro, dict) else []
    team_info = team_intro.get("team_info") if isinstance(team_intro, dict) else {}
    detail_players = detail.get("players") if isinstance(detail, dict) else []
    return {
        "seasonId": season_id,
        "seasonName": str(season.get("season_name", "")),
        "year": int(season.get("season_year") or 0),
        "teams": [team_summary(team) for team in meta.get("teams", [])],
        "matches": [match_summary(match) for match in matches],
        "final": match_summary(final),
        "champion": {"teamId": champion_id, "teamName": champion_name},
        "runnerUp": {"teamId": runner_up_id, "teamName": runner_up_name},
        "championTeamHonors": (
            team_info.get("team_honor", []) if isinstance(team_info, dict) else []
        ),
        "championRoster": roster if isinstance(roster, list) else [],
        "coverage": {
            "scheduleMatches": len(matches),
            "playerRankUniquePlayers": count_rank_players(rank_data),
            "championRosterPlayers": len(roster) if isinstance(roster, list) else 0,
            "finalDetailPlayers": len(detail_players) if isinstance(detail_players, list) else 0,
            "finalHasStarterInfo": bool(final.get("has_starter_info")),
        },
    }


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-year", type=int, default=2016)
    parser.add_argument("--to-year", type=int, default=2018)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    season_data = post("getSeasonAndStageAndTeamList", {}).get("data", {})
    seasons = [
        season
        for season in season_data.get("seasons", [])
        if args.from_year <= int(season.get("season_year") or 0) <= args.to_year
    ]
    seasons.sort(key=lambda season: str(season.get("seasonid", "")))
    if not seasons:
        raise ValueError(f"官方 API 未返回 {args.from_year}—{args.to_year} 赛季")
    output = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": KPL_API,
        "range": {"fromYear": args.from_year, "toYear": args.to_year},
        "seasons": [build_season(season) for season in seasons],
        "limitations": [
            "2016—2018 的赛季、参赛队和赛程仍可由官方 API 返回。",
            "这些赛季的 getPlayerRank、getTeamsIntro.player_msg 和决赛详情 players 已返回空数组，无法只依靠现存 API 恢复历史选手阵容。",
        ],
    }
    write_json(args.output.resolve(), output)
    print(
        f"已抓取 {len(output['seasons'])} 个赛季："
        + "、".join(
            f"{season['seasonName']}（{season['champion']['teamName']}）"
            for season in output["seasons"]
        )
    )


if __name__ == "__main__":
    main()
