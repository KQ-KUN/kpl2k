"""从 raw league matches 提取战队头像 fid，压缩 64x64 并 base64 内联进 app/data/team_icons.json

头像文件存放在 app/assets/team_icons/{fid}.png（下载步骤获得）。
内联后 img src 为 data URI，零网络请求，任何环境都能显示。
"""

import base64
import glob
import io
import json
import os
import sys

from PIL import Image

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

fids = []
for f in sorted(glob.glob("data/raw/league_*.json")):
    if not f.endswith("_matches.json"):
        continue
    try:
        d = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    for m in d.get("results") or []:
        for camp in ("camp1", "camp2"):
            c = m.get(camp) or {}
            tid = c.get("team_id")
            icon = c.get("team_icon")
            if tid and icon and tid not in fids:
                fids.append(tid)

icons = {}
for fid in fids:
    path = f"app/assets/team_icons/{fid}.png"
    if not os.path.exists(path):
        continue
    try:
        img = Image.open(path).convert("RGBA")
        img.thumbnail((64, 64), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        icons[fid] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        continue

out = {"schema_version": "0.1", "data_version": "2026-08-23", "icons": icons}
os.makedirs("app/data", exist_ok=True)
with open("app/data/team_icons.json", "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False)
print("战队头像:", len(icons))
