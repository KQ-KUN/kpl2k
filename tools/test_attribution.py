"""Regression tests use synthetic identities, not nickname-based production edits."""
import contextlib
import io
import json
from pathlib import Path
import random
import uuid
import unittest
from unittest.mock import patch

from tools.attribution import (IdentityResolver, aggregate, difference_report,
                               index_records, membership_records, team_attribution)
from tools import clean_kpl


class AttributionTest(unittest.TestCase):
    def setUp(self):
        self.players = [
            {'player_id': 'A', 'name': 'Same', 'teams': {'S': 'T1'}},
            {'player_id': 'B', 'name': 'Same', 'teams': {'S': 'T2'}},
            {'player_id': 'C', 'name': 'Unique', 'teams': {'S': 'T1'}},
        ]
        self.resolver = IdentityResolver(self.players, {})

    def battle(self, key, pid='A', team='T1', pos='中路'):
        row = {'player_name': 'Same', 'player_id': pid, 'team_id': team,
               'position_desc': pos, 'kill_num': 2, 'gold': 1000}
        return key, 'S', {'game_duration': 60000, 'battle_player_list': [row]}

    def test_same_nickname_requires_id_or_reviewed_binding(self):
        doc = aggregate([self.battle('1', 'A'), self.battle('2', 'B', 'T2')], self.resolver)
        self.assertEqual([r['player_id'] for r in doc['records']], ['A', 'B'])
        self.assertEqual(self.resolver.resolve('S', {'player_name': 'Same', 'team_id': 'T1'})[1], 'identity_ambiguity')
        pending = aggregate([self.battle('1', '')], self.resolver)
        self.assertEqual(pending['records'], [])
        self.assertEqual(pending['pending_review'][0]['candidate_ids'], ['A', 'B'])

    def test_reviewed_context_and_explicit_id_conflicts(self):
        resolver = IdentityResolver(self.players, {'attributionIdentities': [
            {'season_id': 'S', 'team_franchise': 'T1', 'player_name': 'Same', 'player_id': 'A'}]})
        self.assertEqual(resolver.resolve('S', {'player_name': 'Same', 'team_id': 'T1'})[:2], ('A', 'reviewed_context'))
        self.assertIsNone(resolver.resolve('S', {'player_id': 'B', 'player_name': 'Same', 'team_id': 'T1'})[0])

    def test_multi_team_position_changes_and_ties_are_retained(self):
        battles = [self.battle('1'), self.battle('2'), self.battle('3', team='T2', pos='游走')]
        row = aggregate(battles, self.resolver)['records'][0]
        self.assertEqual(row['team_counts'], {'T1': 2, 'T2': 1})
        self.assertEqual(row['position_counts'], {'中路': 2, '游走': 1})
        self.assertEqual(team_attribution(row, 'T2')['position'], '游走')
        self.assertEqual(team_attribution(row, 'unknown'), {})
        self.assertEqual((row['team_franchise'], row['position']), ('T1', '中路'))
        self.assertEqual([(r['team_franchise'], r['games']) for r in row['team_records']], [('T1', 2), ('T2', 1)])
        tie = aggregate([battles[0], battles[2]], self.resolver)['records'][0]
        self.assertIsNone(tie['team_franchise'])
        self.assertIsNone(tie['position'])
        self.assertEqual(tie['team_ties'], ['T1', 'T2'])
        self.assertEqual({r['team_franchise'] for r in membership_records([tie])}, {'T1', 'T2'})

    def test_order_does_not_change_any_output(self):
        battles = [self.battle(str(i), pid=('A' if i % 2 else 'B'),
                               team=('T1' if i % 3 else 'T2')) for i in range(24)]
        expected = aggregate(battles, self.resolver)
        for seed in range(12):
            shuffled = list(battles)
            random.Random(seed).shuffle(shuffled)
            self.assertEqual(aggregate(shuffled, self.resolver), expected)
        together = [('same', 'S', {'battle_player_list': [battles[0][2]['battle_player_list'][0],
                                                         battles[1][2]['battle_player_list'][0]]})]
        reversed_rows = [('same', 'S', {'battle_player_list': list(reversed(together[0][2]['battle_player_list']))})]
        self.assertEqual(aggregate(together, self.resolver), aggregate(reversed_rows, self.resolver))

    def test_overrides_are_id_scoped_and_keep_observed_positions(self):
        row = aggregate([self.battle('1')], self.resolver, {'A': {'S': '游走'}})['records'][0]
        self.assertEqual(row['position'], '游走')
        self.assertEqual(row['observed_position_counts'], {'中路': 1})
        self.assertEqual(aggregate([self.battle('1', 'B')], self.resolver, {'A': {'S': '游走'}})['records'][0]['position'], '中路')

    def test_consumer_index_never_overwrites_namesakes(self):
        records = aggregate([self.battle('1'), self.battle('2', 'B')], self.resolver)['records']
        self.assertEqual(set(index_records(records, self.resolver)), {('S', 'A'), ('S', 'B')})
        self.assertEqual(index_records([{'season_id': 'S', 'player_name': 'Same'}], self.resolver), {})
        with self.assertRaises(ValueError):
            index_records([records[0], records[0]], self.resolver)

    def test_difference_categories_do_not_authorize_overwrite(self):
        records = aggregate([self.battle('1', team='T2')], self.resolver)
        report = difference_report(self.players, records, {}, {})
        self.assertEqual(report['differences'][0]['category'], 'source_difference')
        self.assertFalse(report['differences'][0]['automatic_overwrite'])
        report = difference_report(self.players, records, {}, {'teams': {'A': {'S': 'T2'}}})
        self.assertEqual(report['differences'][0]['category'], 'confirmable_error')


class CleanIntegrationTest(unittest.TestCase):
    def test_clean_uses_ids_and_preserves_history_without_touching_snapshots(self):
        # Output is confined to a temporary directory below the workspace.
        scratch = Path(__file__).resolve().parents[1] / 'output/first-batch-fixes-20261018'
        scratch.mkdir(parents=True, exist_ok=True)
        with contextlib.nullcontext(scratch / ('clean-fixture-' + uuid.uuid4().hex)) as directory:
            root = Path(directory)
            raw, out = root / 'data/raw', root / 'data/processed'
            for directory in (raw, out, root / 'data/curated', root / 'data/overrides'):
                directory.mkdir(parents=True, exist_ok=True)
            def dump(path, value):
                path.write_text(json.dumps(value), encoding='utf-8')
            dump(raw / 'leagues.json', {'results': [{'league_id': '1', 'cc_league_id': 'S', 'status': 1}]})
            dump(raw / 'league_1_matches.json', {'results': []})
            dump(raw / 'league_1_players.json', {'data': [
                {'player_info': {'openid': pid, 'player_name': 'Same', 'team_id': 'old', 'position_desc': '中路'},
                 'statistics_info': {'battle_count': 2}} for pid in ('A', 'B')]})
            dump(root / 'data/curated/player_identity_corrections.json', {'players': {}})
            dump(root / 'data/overrides/player_versions.json', {})
            resolver = IdentityResolver([{'player_id': pid, 'name': 'Same', 'teams': {'S': 'old'}} for pid in ('A', 'B')], {})
            battles = [(pid, 'S', {'battle_player_list': [{'player_id': pid, 'player_name': 'Same',
                       'team_id': team, 'position_desc': pos}]}) for pid, team, pos in [('A', 'T1', '游走'), ('B', 'T2', '中路')]]
            dump(out / 'player_attribution.json', aggregate(battles, resolver))
            with patch.multiple(clean_kpl, ROOT=root, RAW=raw, OUT=out), contextlib.redirect_stdout(io.StringIO()):
                clean_kpl.main()
            stats = json.loads((out / 'player_season_stats.json').read_text(encoding='utf-8'))['records']
            self.assertEqual({r['player_id']: (r['team_franchise'], r['position']) for r in stats},
                             {'A': ('T1', '游走'), 'B': ('T2', '中路')})
            players = json.loads((out / 'players.json').read_text(encoding='utf-8'))['players']
            self.assertTrue(all(p['attribution_history']['S']['team_records'] for p in players))


if __name__ == '__main__':
    unittest.main()
