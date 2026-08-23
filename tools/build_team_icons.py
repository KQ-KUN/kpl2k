"""从 raw league matches 提取战队头像（fid -> icon），输出 app/data/team_icons.json"""

import glob
import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

icons = {}
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
            if tid and icon and not icon.startswith("http"):
                icon = "https:" + icon
            if tid and icon and tid not in icons:
                icons[tid] = icon

out = {"schema_version": "0.1", "data_version": "2026-08-23", "icons": icons}
os.makedirs("app/data", exist_ok=True)
with open("app/data/team_icons.json", "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False)
print("战队头像:", len(icons))
