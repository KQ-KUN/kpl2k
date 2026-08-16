"""KPL 2K 逐局阵容爬虫 v1

目的：修正"选手历史归属/位置被当前值污染"。
对每个赛事按赛程顺序抓 battle 详情（含选手名+队伍+位置+MVP），
全量抓取所有小局（MVP 统计需要完整 battle，不能按名字覆盖率提前停止）；
可断点续爬（已保存文件跳过）。

用法：
  python tools/crawl_battles.py --league 20190001
  python tools/crawl_battles.py --leagues 20190001,20210004,20230001
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crawl_kpl as ck  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
BATTLE_DIR = RAW / "battles"
COVERAGE = 0.95


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def league_players(league_id: str) -> set[str]:
    obj = load_json(RAW / f"league_{league_id}_players.json")
    return {rec["player_info"]["player_name"] for rec in obj.get("data") or [] if rec.get("player_info")}


def battle_players(path: Path) -> set[str]:
    obj = load_json(path)
    data = obj.get("data") or {}
    return {p.get("player_name") for p in data.get("battle_player_list") or [] if p.get("player_name")}


def crawl_league(league_id: str) -> None:
    matches = (load_json(RAW / f"league_{league_id}_matches.json")).get("results") or []
    players = league_players(league_id)
    if not players:
        print(f"[skip] {league_id} 无选手名单")
        return
    seen: set[str] = set()
    total_battles = 0
    for idx, m in enumerate(matches, start=1):
        mid = m.get("match_id")
        blist = ck.smoba_get("/leaguesite/match/battles/open", {"match_id": mid})
        for b in blist.get("results") or []:
            bid = b.get("battle_id")
            if not bid:
                continue
            out = BATTLE_DIR / f"{league_id}_{mid}_{bid}.json"
            if out.exists():
                seen |= battle_players(out)
            else:
                detail = ck.smoba_get("/leaguesite/battle/open", {"battle_id": bid})
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(detail, ensure_ascii=False), encoding="utf-8")
                seen |= battle_players(out)
                total_battles += 1
        if idx % 10 == 0 or idx == len(matches):
            print(f"[{league_id}] 第{idx}/{len(matches)}场 本场新增 {total_battles} 局")
    print(f"[done] {league_id} 共 {len(matches)} 场，本场新增 {total_battles} 局")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", help="单个赛事 league_id")
    ap.add_argument("--leagues", help="逗号分隔的多个 league_id")
    args = ap.parse_args()
    ids = []
    if args.league:
        ids = [args.league]
    if args.leagues:
        ids += [s.strip() for s in args.leagues.split(",") if s.strip()]
    for lid in ids:
        try:
            crawl_league(lid)
        except Exception as exc:  # noqa: BLE001
            print(f"[fail] {lid}: {exc}")


if __name__ == "__main__":
    main()
