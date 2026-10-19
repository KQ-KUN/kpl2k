"""KPL 2K 选手归属构建 v0.2

扫描 data/raw/battles 的逐局阵容，按"选手-赛季"投票出：
- team_franchise：采样出场次数唯一最大队伍（并列为空）
- position：采样出场次数唯一最大位置（并列为空）
- heroes：英雄池（去重）

产出 data/processed/player_attribution.json，供 clean_kpl.py 修正污染数据。

用法：
  python tools/build_attribution.py --output output/attribution-candidate.json
"""

from __future__ import annotations

import argparse
import json
try:
    from .attribution import FIELDS, IdentityResolver, aggregate, difference_report
except ImportError:
    from attribution import FIELDS, IdentityResolver, aggregate, difference_report
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
BATTLE_DIR = RAW / "battles"

# The official battle feed leaves this player's name and position blank in
# every AG game from his tenure. The remaining row (team, hero and stats) is
# complete, so recover the identity at the narrowest reliable boundary.
MISSING_PLAYER_BY_SEASON_TEAM = {
    ("L20190004", "10027"): ("六点六", "对抗路"),
    ("L20200001", "10027"): ("六点六", "对抗路"),
    ("L20200003", "10027"): ("六点六", "对抗路"),
    ("KPL2020S2", "10027"): ("六点六", "对抗路"),
}


def load(name: str) -> dict:
    return json.loads((PROC / name).read_text(encoding="utf-8"))


def build_candidate() -> tuple[dict, dict]:
    corrections = json.loads((ROOT / "data/curated/player_identity_corrections.json").read_text(encoding="utf-8"))
    overrides = json.loads((ROOT / "data/overrides/player_versions.json").read_text(encoding="utf-8"))
    players = load("players.json")["players"]
    seasons = load("seasons.json")["seasons"]
    league_to_season = {str(s["league_id"]): s["season_id"] for s in seasons}
    if not BATTLE_DIR.exists():
        raise FileNotFoundError("data/raw/battles is missing; existing attribution was not changed")
    paths = sorted(BATTLE_DIR.glob("*.json"))
    if not paths:
        raise ValueError("No battle input; existing attribution was not changed")
    battles = []
    ignored = []
    for path in paths:
        season = league_to_season.get(path.stem.split("_")[0])
        if not season:
            ignored.append(path.name)
            continue
        data = json.loads(path.read_text(encoding="utf-8")).get("data") or {}
        for row in data.get("battle_player_list") or []:
            recovered = MISSING_PLAYER_BY_SEASON_TEAM.get((season, str(row.get("team_id") or "")))
            if not row.get("player_name") and recovered:
                row["player_name"], row["position_desc"] = recovered
        # The feed embeds equipment and skill HTML for every row. Keep only
        # attribution inputs rather than retaining gigabytes of unrelated data.
        keys = (*FIELDS, 'player_id', 'openid', 'player_name', 'player_icon',
                'team_id', 'position_desc', 'hero_name', 'is_mvp')
        battles.append((path.name, season, {
            'game_duration': data.get('game_duration'),
            'battle_player_list': [{key: row[key] for key in keys if key in row}
                                   for row in data.get('battle_player_list') or []],
        }))
    result = aggregate(battles, IdentityResolver(players, corrections), overrides.get("positions", {}))
    missing = [f"league_{s['league_id']}_{kind}.json" for s in seasons for kind in ('players', 'matches')
               if not (RAW / f"league_{s['league_id']}_{kind}.json").exists()]
    actual_names = {path.name for path in paths}
    expected_names = set()
    for season in seasons:
        matches_path = RAW / f"league_{season['league_id']}_matches.json"
        if not matches_path.exists():
            continue
        for match in json.loads(matches_path.read_text(encoding='utf-8')).get('results') or []:
            for battle in match.get('match_battle_video_list') or []:
                if battle.get('battle_id'):
                    expected_names.add(f"{season['league_id']}_{match['match_id']}_{battle['battle_id']}.json")
    result['input_audit'] = {
        'battle_files': len(paths), 'mapped_battle_files': len(battles), 'ignored_files': ignored,
        'covered_seasons': sorted({season for _, season, _ in battles}),
        'missing_league_inputs': missing,
        'expected_battle_files_from_local_match_lists': len(expected_names),
        'missing_expected_battle_files': sorted(expected_names - actual_names),
        'local_source_inventory_complete': not missing and bool(expected_names) and expected_names == actual_names,
        'full_rebuild_completed': False,
        'completeness': 'local sampled battles only; no authoritative expected-battle inventory',
    }
    return result, difference_report(players, result, corrections, overrides)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=PROC / 'player_attribution.json')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--write-canonical', action='store_true', help='Explicitly replace canonical only with complete local inputs and no unresolved identities')
    args = parser.parse_args()
    # The full raw-input archive is not versioned. Never replace the sole
    # canonical snapshot with a partial local reconstruction by default.
    canonical_output = args.output.resolve() == (PROC / 'player_attribution.json').resolve()
    if canonical_output and not args.write_canonical:
        raise SystemExit('Refusing canonical replacement: input completeness is unverified. Use --output for a reviewable candidate.')
    result, report = build_candidate()
    if canonical_output and (not result['input_audit']['local_source_inventory_complete'] or result['pending_review']):
        raise SystemExit('Refusing canonical replacement: incomplete local inventory or unresolved identities. Export a candidate for review.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"attribution records: {len(result['records'])}; pending battle rows: {len(result['pending_review'])}")
    print(f"input coverage: {result['input_audit']}")


if __name__ == "__main__":
    main()
