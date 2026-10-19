"""Identity-safe, deterministic attribution helpers shared by producers/consumers.

Counts describe sampled battle appearances, never a complete transfer history.
A unique maximum selects the primary value; ties deliberately have no primary.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import json
import math


def primary(counts: dict) -> tuple[str | None, list[str]]:
    if not counts:
        return None, []
    best = max(counts.values())
    tied = sorted(key for key, count in counts.items() if count == best)
    return (tied[0] if len(tied) == 1 else None), tied


class IdentityResolver:
    def __init__(self, players: list[dict], corrections: dict):
        self.players = {str(p['player_id']): p for p in players}
        self.bindings = defaultdict(set)
        for row in corrections.get('attributionIdentities', []):
            self.bindings[(row['season_id'], str(row['team_franchise']), row['player_name'])].add(row['player_id'])
        self.names = defaultdict(set)
        for pid, player in self.players.items():
            self.names[player['name']].add(pid)
        for pid, row in corrections.get('players', {}).items():
            if pid not in self.players and row.get('player_id') == pid:
                self.players[pid] = row
                self.names[row['name']].add(pid)
            for alias in row.get('aliases', []):
                self.names[alias].add(pid)

    def resolve(self, season: str, row: dict) -> tuple[str | None, str, list[str]]:
        name, team = row.get('player_name', ''), str(row.get('team_id') or row.get('team_franchise') or '')
        explicit = {str(row[key]) for key in ('player_id', 'openid') if row.get(key)}
        bound = self.bindings.get((season, team, name), set())
        if explicit:
            if len(explicit) == 1 and explicit <= self.players.keys() and (not bound or explicit == bound):
                return next(iter(explicit)), 'verified_id', sorted(explicit)
            return None, 'identity_conflict_or_unknown_id', sorted(explicit | bound)
        if bound:
            if len(bound) == 1 and bound <= self.players.keys():
                return next(iter(bound)), 'reviewed_context', sorted(bound)
            return None, 'identity_conflict', sorted(bound)
        # A nickname alone is insufficient. Require the canonical roster's season
        # context as well; historical team metadata may be polluted, so never use
        # that metadata to break a same-season namesake tie.
        candidates = {pid for pid in self.names.get(name, set())
                      if season in self.players.get(pid, {}).get('teams', {})}
        if len(candidates) == 1:
            return next(iter(candidates)), 'roster_season_context', sorted(candidates)
        return None, ('identity_ambiguity' if candidates else 'unmapped_identity'), sorted(candidates)


FIELDS = ('kill_num', 'death_num', 'assist_num', 'gold', 'hurt_to_hero_total',
          'participation_rate', 'hurt_to_hero_total_rate', 'be_hurt_by_hero_total_rate')


def summarize(rows: list[dict]) -> dict:
    games = len(rows)
    sums = {field: math.fsum(r['row'].get(field, 0) for r in rows
                            if isinstance(r['row'].get(field), (int, float))) for field in FIELDS}
    duration = math.fsum(r['duration'] for r in rows)
    deaths = sums['death_num']
    result = {'games': games, 'heroes': sorted({r['row']['hero_name'] for r in rows if r['row'].get('hero_name')}),
              'mvp_count': sum(bool(r['row'].get('is_mvp')) for r in rows)}
    for field, output, digits in [('kill_num', 'avg_kill_num', 3), ('death_num', 'avg_death_num', 3),
                                 ('assist_num', 'avg_assist_num', 3), ('participation_rate', 'avg_participation_rate', 2),
                                 ('hurt_to_hero_total_rate', 'avg_hurt_rate', 4),
                                 ('be_hurt_by_hero_total_rate', 'avg_be_hurt_rate', 4)]:
        result[output] = round(sums[field] / games, digits) if games else None
    result.update(avg_kda=round((sums['kill_num'] + sums['assist_num']) / deaths, 3) if deaths else None,
                  avg_gpm=round(sums['gold'] / duration, 1) if duration else None,
                  avg_dpm=round(sums['hurt_to_hero_total'] / duration, 1) if duration else None)
    return result


def aggregate(battles, resolver: IdentityResolver, positions: dict | None = None) -> dict:
    """battles = iterable of (stable source key, season ID, battle data)."""
    grouped, pending = defaultdict(list), []
    for source, season, data in sorted(battles, key=lambda x: (x[0], x[1])):
        seen = set()
        for row in sorted(data.get('battle_player_list') or [], key=lambda r: json.dumps(r, sort_keys=True)):
            pid, status, candidates = resolver.resolve(season, row)
            if not pid:
                pending.append({'source': source, 'season_id': season, 'player_name': row.get('player_name'),
                                'team_franchise': row.get('team_id'), 'reason': status, 'candidate_ids': candidates})
                continue
            if pid in seen:
                # Duplicate identities in one battle are not extra appearances.
                raise ValueError(f'duplicate player identity in battle: {source}/{pid}')
            seen.add(pid)
            observed_position = row.get('position_desc')
            position = (positions or {}).get(pid, {}).get(season) or observed_position
            grouped[(season, pid)].append({'source': source, 'row': row, 'position': position,
                                          'observed_position': observed_position,
                                          'duration': (data.get('game_duration') or 0) / 60000.0,
                                          'identity_source': status})
    records = []
    for (season, pid), rows in sorted(grouped.items()):
        teams = Counter(str(r['row']['team_id']) for r in rows if r['row'].get('team_id'))
        positions_count = Counter(r['position'] for r in rows if r['position'])
        observed = Counter(r['observed_position'] for r in rows if r['observed_position'])
        team, team_tied = primary(teams)
        position, position_tied = primary(positions_count)
        history = []
        for tid in sorted(teams):
            team_rows = [r for r in rows if str(r['row'].get('team_id') or '') == tid]
            counts = Counter(r['position'] for r in team_rows if r['position'])
            pos, tied = primary(counts)
            history.append({'team_franchise': tid, 'position': pos, 'position_counts': dict(sorted(counts.items())),
                            'position_ties': tied, **summarize(team_rows)})
        names = Counter(r['row'].get('player_name') for r in rows if r['row'].get('player_name'))
        name = sorted(names, key=lambda value: (-names[value], value))[0] if names else resolver.players[pid]['name']
        icons = sorted({r['row']['player_icon'] for r in rows if r['row'].get('player_icon')})
        records.append({'season_id': season, 'player_id': pid, 'player_name': name, 'team_franchise': team,
                        'position': position, 'player_icon': icons[0] if icons else '',
                        'team_counts': dict(sorted(teams.items())), 'position_counts': dict(sorted(positions_count.items())),
                        'observed_position_counts': dict(sorted(observed.items())), 'team_ties': team_tied,
                        'position_ties': position_tied, 'team_records': history,
                        'missing_team_games': sum(not r['row'].get('team_id') for r in rows),
                        'identity_sources': sorted({r['identity_source'] for r in rows}), **summarize(rows)})
    return {'schema_version': '0.2', 'data_version': '2026-10-18',
            'selection_rule': 'unique maximum sampled appearances; tied primary is null; complete sampled history retained',
            'records': records, 'pending_review': pending}


def index_records(records: list[dict], resolver: IdentityResolver) -> dict:
    result = {}
    for row in records:
        pid, _, _ = resolver.resolve(row['season_id'], row)
        if not pid:
            continue
        key = (row['season_id'], pid)
        if key in result:
            raise ValueError(f'duplicate attribution for verified identity: {key}')
        result[key] = {**row, 'player_id': pid}
    return result


def membership_records(records: list[dict]):
    """Expand schema 0.2 multi-team history for graph consumers; accept legacy."""
    for record in records:
        for team in record.get('team_records') or [record]:
            yield {**record, **team}


def team_attribution(record: dict | None, team: str) -> dict:
    if not record:
        return {}
    if 'team_records' in record:
        return next((row for row in record['team_records'] if row['team_franchise'] == team), {})
    return record if record.get('team_franchise') == team else {}


def difference_report(players: list[dict], attribution: dict, corrections: dict, overrides: dict) -> dict:
    resolver = IdentityResolver(players, corrections)
    differences, identities = [], []
    for row in attribution.get('records', []):
        pid, status, candidates = resolver.resolve(row['season_id'], row)
        if not pid:
            identities.append({'season_id': row['season_id'], 'player_name': row.get('player_name'),
                               'reason': status, 'candidate_ids': candidates})
            continue
        sid = row['season_id']
        raw_team = resolver.players[pid].get('teams', {}).get(sid)
        sampled = sorted(row.get('team_counts') or ([row['team_franchise']] if row.get('team_franchise') else []))
        if raw_team == row.get('team_franchise') and len(sampled) <= 1:
            continue
        reviewed = overrides.get('teams', {}).get(pid, {}).get(sid)
        category = ('confirmable_error' if reviewed and raw_team != reviewed else
                    'multi_team_history' if len(sampled) > 1 else 'source_difference')
        differences.append({'category': category, 'player_id': pid, 'season_id': sid,
                            'players_team': raw_team, 'attribution_primary': row.get('team_franchise'),
                            'sampled_teams': sampled, 'reviewed_override': reviewed,
                            'identity_source': status, 'automatic_overwrite': False})
    counts = Counter(row['category'] for row in differences)
    for category in ('source_difference', 'multi_team_history', 'confirmable_error'):
        counts.setdefault(category, 0)
    counts['identity_ambiguity'] = len(identities) + len(attribution.get('pending_review', []))
    return {'schema_version': 1, 'counts': dict(sorted(counts.items())), 'differences': differences,
            'identity_review': identities, 'pending_battle_rows': attribution.get('pending_review', []),
            'count_units': {'differences': 'resolved player-season records',
                            'identity_ambiguity': 'unresolved legacy records plus unresolved battle rows; inspect reason for ambiguity versus unmapped'},
            'note': 'Source differences are not confirmed errors. No snapshot was overwritten.'}
