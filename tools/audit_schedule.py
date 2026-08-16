"""KPL 2K 赛程审计 v0（校验门禁）

目标：保证"赛程一模一样"——
- 每个可用战场的 formats 轮次场次 = 权威来源场次（KPL 赛季用 kpl.qq.com，杯赛用 smoba）
- 赛季内不得混入季前赛/选拔赛等非正式轮次
- 冠军与决赛 winner 一致（复用 build_kpl_maps 已校验，这里只做场次审计）

用法：
  python tools/audit_schedule.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"


def load_raw(name: str) -> dict:
    return json.loads((RAW / name).read_text(encoding="utf-8"))


def load_proc(name: str) -> dict:
    return json.loads((PROC / name).read_text(encoding="utf-8"))


def main() -> None:
    leagues = {str(lg["league_id"]): lg for lg in load_raw("leagues.json").get("results", [])}
    seasons = load_proc("seasons.json")["seasons"]
    formats = load_proc("formats.json")["seasons"]
    issues: list[str] = []
    checked = 0
    for s in seasons:
        if not s.get("is_battlefield"):
            continue
        sid = s["season_id"]
        lid = s["league_id"]
        fmt = formats.get(sid)
        if not fmt:
            issues.append(f"{sid}: formats 缺失")
            continue
        fmt_count = sum(len(r["matches"]) for r in fmt["rounds"])
        source = fmt.get("source")
        if source == "kpl":
            kpl_sid = sid if sid in [x["seasonid"] for x in (load_raw("kpl_seasons.json").get("data") or {}).get("seasons", [])] else None
            if not kpl_sid:
                names = {n: x["seasonid"] for x in (load_raw("kpl_seasons.json").get("data") or {}).get("seasons", []) for n in [x.get("season_name", "")]}
                kpl_sid = names.get(s.get("name") or "")
            if not kpl_sid:
                issues.append(f"{sid}: 找不到 kpl 赛季")
                continue
            matches = (load_raw(f"kpl_season_{kpl_sid}_schedule.json").get("data") or {}).get("list") or []
            matches = [
                m for m in matches
                if "季前" not in (m.get("stage_name") or "")
                and not ((m.get("stage_name") or "") == "" and not m.get("stageid"))
            ]
            expected = len(matches)
        else:
            matches = (load_raw(f"league_{lid}_matches.json")).get("results") or []
            expected = len(matches)
        checked += 1
        if fmt_count != expected:
            issues.append(f"{sid}: formats={fmt_count} vs 权威={expected}（来源 {source}）")
    if issues:
        print(f"审计失败：{len(issues)} 项")
        for i in issues:
            print(f"  ✗ {i}")
        raise SystemExit(1)
    print(f"赛程审计通过：{checked} 个战场，场次数与权威来源全部一致")


if __name__ == "__main__":
    main()
