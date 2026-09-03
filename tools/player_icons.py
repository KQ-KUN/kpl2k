"""Reuse Guessing's verified portrait cache in KPL 2K web builds."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUESSING_DATA = ROOT / "guessing" / "public" / "data" / "player_library.json"
GUESSING_ASSETS = ROOT / "guessing" / "public" / "assets" / "player-icons"
APP_ASSETS = ROOT / "app" / "assets" / "player-icons"
KPL_CACHE = ROOT / "data" / "processed" / "player_icon_cache.json"


def sync_player_icon_cache() -> dict[str, str]:
    """Copy cached portraits and return player ID -> app-relative icon path."""
    if not GUESSING_DATA.exists():
        return {}

    payload = json.loads(GUESSING_DATA.read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    APP_ASSETS.mkdir(parents=True, exist_ok=True)
    if KPL_CACHE.exists():
        cached = json.loads(KPL_CACHE.read_text(encoding="utf-8"))
        for player_id, icon in cached.get("icons", {}).items():
            if (ROOT / "app" / icon).is_file():
                mapping[player_id] = icon
    for player in payload.get("players", []):
        player_id = str(player.get("id", "")).split("@", 1)[0]
        icon = str(player.get("icon", ""))
        if not player_id or "/assets/player-icons/" not in icon:
            continue
        filename = Path(icon).name
        source = GUESSING_ASSETS / filename
        if not source.is_file():
            continue
        destination = APP_ASSETS / filename
        if not destination.exists():
            shutil.copy2(source, destination)
        mapping.setdefault(player_id, f"assets/player-icons/{filename}")
    return mapping
