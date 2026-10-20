"""Explicitly record/verify the final 2K consumption snapshot and local resource contract."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import subprocess
from collections import Counter, defaultdict
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/'app/data/consumption-manifest.json'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def entries(paths):return [{'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p),'bytes':p.stat().st_size} for p in sorted(paths)]
def resource_audit():
    links=set();external=set();missing=set();data_uris=0
    def walk(value):
        nonlocal data_uris
        if isinstance(value,dict):
            for v in value.values():walk(v)
        elif isinstance(value,list):
            for v in value:walk(v)
        elif isinstance(value,str):
            if value.startswith('data:image/'):data_uris+=1
            elif value.startswith(('https://','http://')):external.add(value)
            elif re.match(r'^(?:\./)?assets/',value):
                links.add(value)
                if not (ROOT/'app'/value.removeprefix('./')).is_file():missing.add(value)
    for p in (ROOT/'app/data').rglob('*.json'):
        if p!=MANIFEST:walk(json.loads(p.read_text(encoding='utf-8')))
    html=(ROOT/'app/player_library.html').read_text(encoding='utf-8')
    match=re.search(r'<script id="library-data" type="application/json">(.*?)</script>',html,re.S)
    if match:walk(json.loads(match[1]))
    return {'finalLocalImageReferences':len(links),'missingLocalImages':sorted(missing),'externalValues':len(external),
            'externalValuesNote':'Includes provenance URLs as well as image links; not a request count.',
            'externalImages':sorted(v for v in external if re.search(r'\.(png|jpe?g|webp|gif)(?:[?#]|$)',v,re.I)),
            'remainingDataImageValues':data_uris}

def identity_audit():
    def load(name,key):return json.loads((ROOT/'data/processed'/f'{name}.json').read_text(encoding='utf-8'))[key]
    players=load('players','players');teams=load('franchises','franchises');seasons=load('seasons','seasons');records=load('player_season_stats','records');library=load('player_library','players')
    groups={'players':(players,'player_id'),'teams':(teams,'franchise_id'),'seasons':(seasons,'season_id')}
    ids={name:{str(row[key]) for row in values} for name,(values,key) in groups.items()}
    duplicates={name:sorted(pid for pid,count in Counter(str(row[key]) for row in values).items() if count>1) for name,(values,key) in groups.items()}
    names=defaultdict(set);aliases=defaultdict(set)
    for player in players:names[player.get('name','')].add(str(player['player_id']))
    for team in teams:
        for season,name in team.get('names_by_season',{}).items():
            if isinstance(name,str):aliases[(season,name)].add(str(team['franchise_id']))
    missing=[]
    for row in records:
        for field,kind in [('player_id','players'),('team_franchise','teams'),('season_id','seasons')]:
            if str(row.get(field,'')) not in ids[kind]:missing.append({'field':field,'value':row.get(field),'playerId':row.get('player_id'),'seasonId':row.get('season_id')})
    return {'coverage':{'people':len(players),'teams':len(teams),'seasons':len(seasons),'seasonRecords':len(records),'libraryCards':len(library),'libraryPeople':len({str(p['id']).split('@')[0] for p in library})},
            'duplicateCanonicalIds':duplicates,'unresolvedRecordReferences':missing,
            'sameNamePeople':[{'name':name,'playerIds':sorted(values),'status':'keep-separate-unverified'} for name,values in sorted(names.items()) if name and len(values)>1],
            'sameSeasonNameConflicts':[{'seasonId':season,'name':name,'teamIds':sorted(values)} for (season,name),values in sorted(aliases.items()) if len(values)>1],
            'missingFacts':{'emptyRealNames':sum(not p.get('real_name') for p in players),'libraryUnknownDebut':sum(p.get('debut_year') is None for p in library),'libraryUnknownChampionship':sum(p.get('championship_count') is None for p in library)},
            'priorities':[{'priority':'P1','item':'Ambiguous names must be resolved by provider player_id and evidence; never nickname-merge.'},{'priority':'P1','item':'Full raw rebuild remains incomplete because complete raw inputs are absent.'},{'priority':'P2','item':'Historical fixed data_version fields are legacy snapshot metadata; consumption manifest input SHA256 is authoritative. Explicit generators now emit content versions.'}],
            'scope':'Structural checks do not verify historical identity continuity or the truth of existing facts.'}

def sync(source_repository: Path | None = None):
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source_repository or ROOT,text=True).strip()
    if not re.fullmatch('[a-f0-9]{40}',commit):raise ValueError('Source commit is not a real full SHA')
    inputs=[p for folder in ['processed','overrides','narrative','curated'] for p in (ROOT/'data'/folder).glob('*.json')]
    audit=identity_audit()
    (ROOT/'app/data/quality-report.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    outputs=[p for p in (ROOT/'app').rglob('*') if p.is_file() and p!=MANIFEST]
    players=json.loads((ROOT/'app/data/base.json').read_text(encoding='utf-8'))['players']
    resource=resource_audit()
    if resource['missingLocalImages']:raise ValueError(f"Missing image resources: {resource['missingLocalImages'][:5]}")
    result={'schemaVersion':1,'sourceCommit':commit,'inputs':entries(inputs),'outputs':entries(outputs),
      'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
      'generator':{'name':'tools/consumption_manifest.py','version':digest(Path(__file__))},
      'quality':{'report':'app/data/quality-report.json','sourceCommitBasis':'Actual repository ancestry; exact working-input hashes are authoritative. Raw upstream lineage is not claimed.'},
      'coverage':{'canonicalPlayers':len(players),'runtimeFiles':len(outputs),'rawRebuilt':False,
                  'scope':'Exact local canonical/consumer snapshot; raw upstream lineage is not independently established'},
      'exclusionRules':['Unknown/null values remain unknown; no synthetic zero or nickname merges.',
                        'No raw crawling, no full canonical reconstruction, no fact edits during snapshot maintenance.'],
      'semantics':{'identity':'String player_id is person identity; @franchise_id is a display card, not a new person.',
                   'missing':'Missing, null, empty string and zero remain distinct.',
                   'units':{'versions.win_rate':'fraction 0..1','library.versions.participation':'percent 0..100',
                            'library.versions.hurt_rate':'percent 0..100','season.avg_hurt_to_hero_total_rate':'source fraction; do not normalize by field name alone'}},
      'resources':resource}
    MANIFEST.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(f'Snapshot manifest: {len(inputs)} inputs / {len(outputs)} final outputs; {len(players)} canonical identities')
def verify():
    obj=json.loads(MANIFEST.read_text(encoding='utf-8'))
    if obj.get('schemaVersion')!=1 or not re.fullmatch('[a-f0-9]{40}',obj.get('sourceCommit','')):raise ValueError('Invalid manifest identity/version')
    for key in ['inputs','outputs']:
        for row in obj[key]:
            p=(ROOT/row['path']).resolve()
            if not p.is_relative_to(ROOT) or not p.is_file() or digest(p)!=row['sha256']:raise ValueError(f'Stale or missing {key}: {row["path"]}; run npm run snapshot:sync explicitly')
    expected={p.relative_to(ROOT).as_posix() for p in (ROOT/'app').rglob('*') if p.is_file() and p!=MANIFEST}
    if expected!={row['path'] for row in obj['outputs']}:raise ValueError('Runtime file inventory changed; synchronize manifest explicitly')
    if resource_audit()['missingLocalImages']:raise ValueError('Missing final image resource')
    print('Final consumption snapshot hashes and resource inventory verified.')
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');parser.add_argument('--source-repository',type=Path);args=parser.parse_args();verify() if args.check else sync(args.source_repository)
