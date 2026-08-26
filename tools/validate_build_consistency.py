"""Validate deterministic avatar output and one annual player rating."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
TEAM_ICONS = ROOT / "app" / "data" / "team_icons.json"


def validate_avatar_build() -> None:
    hashes = []
    for _ in range(2):
        subprocess.run(
            [sys.executable, "tools/build_team_icons.py"],
            cwd=ROOT,
            check=True,
        )
        hashes.append(hashlib.sha256(TEAM_ICONS.read_bytes()).hexdigest())
    if hashes[0] != hashes[1]:
        raise SystemExit("[FAIL] consecutive team-avatar builds differ")

    icon_keys = list(json.loads(TEAM_ICONS.read_text(encoding="utf-8"))["icons"])
    if icon_keys != sorted(icon_keys):
        raise SystemExit("[FAIL] team-avatar output is not ordered by team ID")


def validate_annual_ratings() -> None:
    seasons = json.loads((PROCESSED / "seasons.json").read_text(encoding="utf-8"))["seasons"]
    records = json.loads((PROCESSED / "player_season_stats.json").read_text(encoding="utf-8"))["records"]
    library = json.loads((PROCESSED / "player_library.json").read_text(encoding="utf-8"))["players"]
    season_info = {season["season_id"]: season for season in seasons}
    ratings: dict[tuple[str, int], set[float]] = defaultdict(set)
    has_battlefield_rating: set[tuple[str, int]] = set()

    for record in records:
        season = season_info.get(record["season_id"], {})
        year = season.get("year")
        rating = record.get("rating")
        if year is None or rating is None:
            continue
        key = (record["player_id"], int(year))
        ratings[key].add(float(rating))
        if season.get("is_battlefield") and rating > 50:
            has_battlefield_rating.add(key)

    inconsistent = [key for key in has_battlefield_rating if len(ratings[key]) != 1]
    if inconsistent:
        raise SystemExit(f"[FAIL] event ratings differ within player-year: {inconsistent[:5]}")

    library_mismatches = []
    for player in library:
        player_id = player["id"].split("@", 1)[0]
        for version in player.get("versions", []):
            values = ratings.get((player_id, int(version["year"])), set())
            if values and values != {float(version["rating"])}:
                library_mismatches.append((player_id, version["year"]))
    if library_mismatches:
        raise SystemExit(f"[FAIL] player-library and event ratings differ: {library_mismatches[:5]}")


def main() -> None:
    validate_avatar_build()
    validate_annual_ratings()
    print("Deterministic avatars and annual ratings passed.")


if __name__ == "__main__":
    main()
