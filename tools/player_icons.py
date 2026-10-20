"""Read canonical/local portrait paths; optional explicit external input, never Guessing."""
from __future__ import annotations
import argparse
import json
import shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
APP_ASSETS=ROOT/'app/assets/player-icons'
KPL_CACHE=ROOT/'data/processed/player_icon_cache.json'

def sync_player_icon_cache(source: Path | None = None, assets: Path | None = None) -> dict[str,str]:
    mapping={}
    if KPL_CACHE.exists():
        for pid, icon in json.loads(KPL_CACHE.read_text(encoding='utf-8')).get('icons',{}).items():
            candidate=(ROOT/'app'/icon).resolve()
            if candidate.is_relative_to((ROOT/'app').resolve()) and candidate.is_file():mapping[pid]=icon
    library=source or ROOT/'data/processed/player_library.json'
    if not library.exists():return mapping
    if source is not None and assets is None:raise ValueError('Explicit --source requires --assets')
    for player in json.loads(library.read_text(encoding='utf-8')).get('players',[]):
        pid=str(player.get('player_id') or player.get('id') or '').split('@')[0]
        icon=str(player.get('icon') or '')
        if not pid or not icon or '://' in icon or icon.startswith('data:'):continue
        if assets is None:
            candidate=(ROOT/'app'/icon).resolve()
            if candidate.is_relative_to((ROOT/'app').resolve()) and candidate.is_file():mapping.setdefault(pid,icon)
        else:
            candidate=assets.resolve()/Path(icon).name
            if not candidate.is_file():continue
            APP_ASSETS.mkdir(parents=True,exist_ok=True)
            destination=APP_ASSETS/candidate.name
            if destination.exists() and destination.read_bytes()!=candidate.read_bytes():
                raise ValueError(f'Portrait filename collision: {candidate.name}')
            if not destination.exists():shutil.copy2(candidate,destination)
            mapping.setdefault(pid,f'assets/player-icons/{candidate.name}')
    return dict(sorted(mapping.items()))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path);parser.add_argument('--assets',type=Path)
    args=parser.parse_args()
    mapping=sync_player_icon_cache(args.source,args.assets)
    KPL_CACHE.parent.mkdir(parents=True,exist_ok=True)
    KPL_CACHE.write_text(json.dumps({'schema_version':'0.1','icons':mapping},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'Local canonical portrait paths: {len(mapping)}')
if __name__=='__main__':main()
