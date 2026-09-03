"""Cache every remaining remote KPL 2K portrait as a same-origin WebP asset."""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "guessing" / "tools"))

from cache_player_icons import download_icon  # noqa: E402

PLAYERS = ROOT / "data" / "processed" / "players.json"
OUTPUT = ROOT / "data" / "processed" / "player_icon_cache.json"
ASSETS = ROOT / "app" / "assets" / "player-icons"


def main() -> None:
    players = json.loads(PLAYERS.read_text(encoding="utf-8"))["players"]
    pending = {
        player["player_id"]: player["player_icon"]
        for player in players
        if str(player.get("player_icon", "")).startswith(("http://", "https://"))
    }
    by_url: dict[str, list[str]] = {}
    for player_id, url in pending.items():
        by_url.setdefault(url, []).append(player_id)

    downloaded: dict[str, str] = {}
    remaining = set(by_url)
    for _ in range(3):
        if not remaining:
            break
        failed: set[str] = set()
        with ThreadPoolExecutor(max_workers=16) as executor:
            futures = [executor.submit(download_icon, url, ASSETS) for url in sorted(remaining)]
            for future in as_completed(futures):
                url, local = future.result()
                if local:
                    downloaded[url] = local.lstrip("/")
                else:
                    failed.add(url)
        remaining = failed

    icons = {
        player_id: downloaded[url]
        for url, player_ids in by_url.items()
        if url in downloaded
        for player_id in player_ids
    }
    OUTPUT.write_text(
        json.dumps({"schema_version": "0.1", "icons": dict(sorted(icons.items()))}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"KPL 2K 头像缓存：本地 {len(icons)}，远程回退 {len(pending) - len(icons)}")


if __name__ == "__main__":
    main()
