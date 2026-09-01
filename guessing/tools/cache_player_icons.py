#!/usr/bin/env python3
"""Cache remote player portraits as small same-origin WebP assets."""

from __future__ import annotations

import hashlib
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "public" / "data"
MAX_WORKERS = 16
MAX_SOURCE_BYTES = 5 * 1024 * 1024
THUMBNAIL_SIZE = (128, 128)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def safe_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, quote(unquote(parts.path), safe="/%:@"), parts.query, ""))


def local_path(url: str) -> str:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:20]
    return f"/assets/player-icons/{digest}.webp"


def download_icon(url: str, icon_dir: Path) -> tuple[str, str | None]:
    relative = local_path(url)
    destination = icon_dir / Path(relative).name
    if destination.is_file() and destination.stat().st_size > 0:
        return url, relative

    request = urllib.request.Request(
        safe_url(url),
        headers={"User-Agent": "KPL-Friberg-Asset-Cache/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            source = response.read(MAX_SOURCE_BYTES + 1)
        if len(source) > MAX_SOURCE_BYTES:
            return url, None
        with Image.open(BytesIO(source)) as image:
            image.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            converted = image.convert("RGBA" if image.mode in {"RGBA", "LA"} else "RGB")
            temporary = destination.with_suffix(".tmp")
            converted.save(temporary, format="WEBP", quality=82, method=6)
            temporary.replace(destination)
        return url, relative
    except (OSError, ValueError):
        return url, None


def write_json(path: Path, value: dict[str, Any], *, pretty: bool) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    if pretty:
        content = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    else:
        content = json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def cache_player_icons(data_dir: Path = DEFAULT_DATA) -> tuple[int, int]:
    quiz_path = data_dir / "quiz_players.json"
    audit_path = data_dir / "quiz_data_audit.json"
    library_path = data_dir / "player_library.json"
    quiz = load_json(quiz_path)
    audit = load_json(audit_path)
    library = load_json(library_path)
    urls = {
        str(player.get(field, "")).strip()
        for players, field in ((quiz["players"], "iconUrl"), (library["players"], "icon"))
        for player in players
        if str(player.get(field, "")).strip().startswith(("http://", "https://"))
    }

    icon_dir = data_dir.parent / "assets" / "player-icons"
    icon_dir.mkdir(parents=True, exist_ok=True)
    mapping: dict[str, str] = {}
    remaining = set(urls)
    for _ in range(3):
        if not remaining:
            break
        failed: set[str] = set()
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = [executor.submit(download_icon, url, icon_dir) for url in sorted(remaining)]
            for future in as_completed(futures):
                url, relative = future.result()
                if relative:
                    mapping[url] = relative
                else:
                    failed.add(url)
        remaining = failed

    for player in quiz["players"]:
        player["iconUrl"] = mapping.get(str(player.get("iconUrl", "")), player.get("iconUrl", ""))
    for player in library["players"]:
        player["icon"] = mapping.get(str(player.get("icon", "")), player.get("icon", ""))
    final_icons = {
        str(player.get(field, "")).strip()
        for players, field in ((quiz["players"], "iconUrl"), (library["players"], "icon"))
        for player in players
        if str(player.get(field, "")).strip()
    }
    local_count = sum(value.startswith("/assets/player-icons/") for value in final_icons)
    remote_count = sum(value.startswith(("http://", "https://")) for value in final_icons)
    canonical_players = json.dumps(
        quiz["players"], ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    quiz["playersHash"] = hashlib.sha256(canonical_players).hexdigest()
    audit["playersHash"] = quiz["playersHash"]
    audit["localIconCount"] = local_count
    audit["remoteIconCount"] = remote_count
    write_json(quiz_path, quiz, pretty=True)
    write_json(audit_path, audit, pretty=True)
    write_json(library_path, library, pretty=False)
    return local_count, remote_count


if __name__ == "__main__":
    cached, remote = cache_player_icons()
    print(f"头像缓存完成：本地 {cached}，远程回退 {remote}")
