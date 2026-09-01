#!/usr/bin/env python3
"""Cache KPL debut years and scoped title counts from Liquipedia's MediaWiki API."""

from __future__ import annotations

import argparse
import gzip
import json
import re
import time
import urllib.parse
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAYERS = ROOT / "config" / "liquipedia_players.json"
DEFAULT_OUTPUT = ROOT / "config" / "career_history.json"
API_URL = "https://liquipedia.net/honorofkings/api.php"
USER_AGENT = "KPLGuessing/0.1 (personal non-commercial project; data audit)"
HTTP_OPENER = urllib.request.build_opener()

ROW_PATTERN = re.compile(r'<tr class="table2__row--body[^\"]*">(.*?)</tr>', re.DOTALL)
CELL_PATTERN = re.compile(r"<td\b([^>]*)>(.*?)</td>", re.DOTALL)
SORT_VALUE_PATTERN = re.compile(r'data-sort-value="([^"]*)"')
TAG_PATTERN = re.compile(r"<[^>]+>")
DATE_PATTERN = re.compile(r"(20\d{2}|19\d{2})-")
KPL_SEASON_PATTERN = re.compile(r"King Pro League (?:Spring|Summer|Fall|Autumn) \d{4}")

COUNTED_TOURNAMENT_PATTERNS = (
    r"King Pro League (?:Spring|Summer|Fall|Autumn) \d{4}",
    r"King Pro League Grand Finals \d{4}",
    r"Honor of Kings Challenger Cup \d{4}",
    r"Honor of Kings International Championship \d{4}",
    r"Honor of Kings World Champion Cup \d{4}",
    r"Honor of Kings Champion Cup(?: Winter Season)? \d{4}",
)
EXCLUDED_TOURNAMENT_PREFIXES = (
    "Honor of Kings World Cup ",
    "Honor of Kings Invitational Midseason ",
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_expanded_results(page: str) -> str:
    query = urllib.parse.urlencode(
        {
            "action": "expandtemplates",
            "text": "{{QuickResults}}",
            "title": f"{page}/Results",
            "prop": "wikitext",
            "format": "json",
            "formatversion": "2",
        }
    )
    request = urllib.request.Request(
        f"{API_URL}?{query}",
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Encoding": "gzip",
        },
    )
    payload: bytes | None = None
    for attempt in range(3):
        try:
            with HTTP_OPENER.open(request, timeout=30) as response:
                payload = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    payload = gzip.decompress(payload)
            break
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** (attempt + 1))
    if payload is None:
        raise RuntimeError(f"{page} API 返回空响应")
    document = json.loads(payload.decode("utf-8"))
    return str(document["expandtemplates"]["wikitext"])


def clean_cell(value: str) -> str:
    return TAG_PATTERN.sub("", value).replace("&nbsp;", " ").strip()


def result_rows(markup: str) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    for row_markup in ROW_PATTERN.findall(markup):
        cells = CELL_PATTERN.findall(row_markup)
        if len(cells) < 6:
            continue
        cell_values: list[tuple[str, str]] = []
        for attributes, content in cells:
            sort_match = SORT_VALUE_PATTERN.search(attributes)
            sort_value = sort_match.group(1) if sort_match else ""
            cell_values.append((sort_value, clean_cell(content)))
        results.append(
            {
                "date": cell_values[0][1],
                "place": cell_values[1][0],
                "tournament": cell_values[4][0],
                "team": cell_values[5][0],
            }
        )
    return results


def is_counted_tournament(name: str) -> bool:
    if name.startswith(EXCLUDED_TOURNAMENT_PREFIXES):
        return False
    return any(re.fullmatch(pattern, name) for pattern in COUNTED_TOURNAMENT_PATTERNS)


def build_career(nickname: str, page: str, markup: str) -> dict[str, Any]:
    rows = result_rows(markup)
    kpl_years = [
        int(match.group(1))
        for row in rows
        if KPL_SEASON_PATTERN.fullmatch(row["tournament"])
        if (match := DATE_PATTERN.match(row["date"]))
    ]
    if not kpl_years:
        raise ValueError(f"{nickname} ({page}) 没有可解析的 KPL 登场记录")

    championships = [
        {
            "date": row["date"],
            "tournament": row["tournament"],
            "team": row["team"],
        }
        for row in rows
        if row["place"] == "1" and is_counted_tournament(row["tournament"])
    ]
    championships.sort(key=lambda item: (item["date"], item["tournament"]))
    return {
        "page": page,
        "debutYear": min(kpl_years),
        "placementChampionshipCount": len(championships),
        "championships": championships,
    }


def write_json(path: Path, value: dict[str, Any]) -> None:
    content = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--players", type=Path, default=DEFAULT_PLAYERS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--delay", type=float, default=2.1)
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--missing-only", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pages = load_json(args.players)
    selected = {
        nickname: page
        for nickname, page in pages.items()
        if not args.only or nickname in set(args.only)
    }
    if args.only and len(selected) != len(set(args.only)):
        missing = sorted(set(args.only) - set(selected))
        raise ValueError(f"未配置的选手：{', '.join(missing)}")

    existing: dict[str, Any] = {}
    if args.output.is_file():
        existing = load_json(args.output).get("players", {})
    if args.missing_only:
        selected = {
            nickname: page
            for nickname, page in selected.items()
            if nickname not in existing
        }

    careers = dict(existing)
    source = {
        "provider": "Liquipedia Honor of Kings Wiki",
        "api": API_URL,
        "retrievedAt": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "license": "CC BY-SA 3.0",
        "championshipScope": {
            "includedPatterns": list(COUNTED_TOURNAMENT_PATTERNS),
            "excluded": list(EXCLUDED_TOURNAMENT_PREFIXES),
        },
    }
    for index, (nickname, page) in enumerate(selected.items()):
        if index:
            time.sleep(max(args.delay, 2.0))
        careers[nickname] = build_career(nickname, page, fetch_expanded_results(page))
        print(
            f"{nickname}: {careers[nickname]['debutYear']} 登场，"
            f"报名阵容口径 {careers[nickname]['placementChampionshipCount']} 冠"
        )
        write_json(
            args.output,
            {
                "schemaVersion": 1,
                "source": source,
                "players": dict(sorted(careers.items())),
            },
        )

    output = {
        "schemaVersion": 1,
        "source": source,
        "players": dict(sorted(careers.items())),
    }
    write_json(args.output, output)
    print(f"已写入 {args.output}（{len(careers)} 人）")


if __name__ == "__main__":
    main()
