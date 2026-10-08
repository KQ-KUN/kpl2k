"""Official registration is distinct from played matches and rated versions."""
from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/curated/official_rosters_2026_annual.json'


def load_roster():
    doc = json.loads(SOURCE.read_text(encoding='utf-8'))
    if doc['seasonId'] != 'KPL2026S3' or len(doc['teams']) != 12:
        raise ValueError('Unexpected annual registration event/team count')
    ids, teams = set(), set()
    canonical = {p['player_id']: p for p in json.loads(
        (ROOT / 'data/processed/players.json').read_text(encoding='utf-8'))['players']}
    for team in doc['teams']:
        if team['franchiseId'] in teams or len(team['players']) != 7:
            raise ValueError('Duplicate team or incomplete seven-player roster')
        teams.add(team['franchiseId'])
        for player in team['players']:
            pid = player['playerId']
            if pid in ids or not player['name'] or not player['realName']:
                raise ValueError('Duplicate or unidentified registered player')
            ids.add(pid)
            if player['identityKind'] == 'canonical':
                if pid not in canonical or canonical[pid]['name'] != player['name']:
                    raise ValueError(f'Unreviewed canonical registration identity: {pid}')
            elif player['identityKind'] == 'smoba-openid':
                if not re.fullmatch('[A-F0-9]{32}', pid):
                    raise ValueError('Invalid official openid')
            elif player['identityKind'] != 'registration-only' or pid != 'REGISTERED_EDGM_ZHAOHAOWEI':
                raise ValueError('Unreviewed registration identity')
    return doc


def memberships(doc):
    return {p['playerId']: (team, p) for team in doc['teams'] for p in team['players']}


def update_library(library, doc):
    current = memberships(doc)
    for card in library['players']:
        pid = card['id'].split('@', 1)[0]
        if pid not in current:
            continue
        team, _ = current[pid]
        card['active'] = card['team_fid'] == team['franchiseId']
        card['current_team'] = None if card['active'] else team['name']
        card['registration_season'] = doc['seasonId']
    library['registration_season'] = doc['seasonId']
    library['registration_checked_at'] = doc['checkedAt']
    return library


def write(path, value):
    if path.exists() and json.loads(path.read_text(encoding='utf-8')) == value:
        return
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def sync_app(doc):
    """Expose current teams while keeping rated versions tied to their source club.

    A loan without rated matches at the new club references existing 2026 versions;
    it never creates annual statistics or copies ratings into canonical history.
    """
    app = ROOT / 'app'
    current = memberships(doc)
    paths = sorted((app / 'data/teams').glob('*.json'))
    squads = {path.stem: json.loads(path.read_text(encoding='utf-8')) for path in paths}
    # Strip previously generated references before rebuilding (idempotent).
    for squad in squads.values():
        squad['players'] = [p for p in squad['players'] if not p.get('registration_reference')]
        for p in squad['players']:
            p['versions'] = [v for v in p['versions'] if not v.get('registration_reference')]
    recent = {}
    for fid, squad in squads.items():
        for card in squad['players']:
            pid = card['player_id']
            if pid in current:
                team, _ = current[pid]
                card['active'] = fid == team['franchiseId']
                card['current_team'] = None if card['active'] else team['name']
                card['registration_season'] = doc['seasonId']
            for version in card['versions']:
                if version['year'] == 2026:
                    recent.setdefault(pid, []).append((fid, squad['name'], card, version))
    for team in doc['teams']:
        squad = squads[team['franchiseId']]
        squad['registered_roster'] = team['players']
        squad['registration_season'] = doc['seasonId']
        for player in team['players']:
            pid = player['playerId']
            sources = recent.get(pid, [])
            if not sources:
                continue  # No rated version: registration does not fabricate one.
            card = next((p for p in squad['players'] if p['player_id'] == pid), None)
            if card is None:
                card = deepcopy(sources[0][2])
                card.update(versions=[], active=True, current_team=None,
                            registration_reference=True, registration_season=doc['seasonId'])
                squad['players'].append(card)
            for source_fid, source_name, _, version in sources:
                if source_fid == team['franchiseId']:
                    continue
                reference = {**version, 'label': f"{version['label']} · {source_name}",
                             'source_team_fid': source_fid, 'source_team_name': source_name,
                             'registration_reference': True}
                card['versions'].append(reference)
            card['positions'] = sorted(set(card['positions'] + [v['position'] for v in card['versions']]))
    for path in paths:
        write(path, squads[path.stem])
    write(app / 'data/official_rosters.json', doc)
    base_path = app / 'data/base.json'
    base = json.loads(base_path.read_text(encoding='utf-8'))
    # Base player representation is keyed by canonical ID.
    for pid, (team, player) in current.items():
        if pid in base['players']:
            base['players'][pid]['current_team_franchise'] = team['franchiseId']
            base['players'][pid]['current_team_name'] = team['name']
    base['registration_season'] = doc['seasonId']
    write(base_path, base)


def main():
    doc = load_roster()
    library_path = ROOT / 'data/processed/player_library.json'
    library = update_library(json.loads(library_path.read_text(encoding='utf-8')), doc)
    write(library_path, library)
    html_path = ROOT / 'app/player_library.html'
    html = html_path.read_text(encoding='utf-8')
    pattern = r'(<script id="library-data" type="application/json">)(.*?)(</script>)'
    match = re.search(pattern, html, re.S)
    if not match:
        raise ValueError('Missing embedded library data')
    embedded = update_library(json.loads(match[2]), doc)
    html = html[:match.start(2)] + json.dumps(embedded, ensure_ascii=False, separators=(',', ':')) + html[match.end(2):]
    html_path.write_text(html, encoding='utf-8')
    sync_app(doc)
    print('Official annual registration synced: 12 teams / 84 players')


if __name__ == '__main__':
    main()
