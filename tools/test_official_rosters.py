"""Registration coverage and provenance checks, without invented annual stats."""
import json
import unittest
from itertools import combinations
from pathlib import Path

from tools.official_rosters import load_roster, memberships, update_library

ROOT = Path(__file__).resolve().parents[1]


class OfficialRegistrationTest(unittest.TestCase):
    def test_graph_contains_exact_registered_pairs(self):
        doc = load_roster()
        graph = json.loads((ROOT / 'link/public/data/link_graph.json').read_text(encoding='utf-8'))
        expected = {('|'.join(sorted([a['playerId'], b['playerId']])), t['franchiseId'])
                    for t in doc['teams'] for a, b in combinations(t['players'], 2)}
        actual = {(pair, p['teamId']) for pair, proofs in graph['evidence'].items()
                  for p in proofs if p['seasonId'] == doc['seasonId']}
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual), 252)

    def test_complete_unique_roster(self):
        doc = load_roster()
        self.assertEqual(len(memberships(doc)), 84)
        self.assertEqual(sum(len(list(combinations(t['players'], 2))) for t in doc['teams']), 252)
        names = {p['name']: t['franchiseId'] for t in doc['teams'] for p in t['players']}
        self.assertEqual(names['Fly'], names['清清'])
        self.assertEqual(names['晚星'], names['梦岚'])
        self.assertEqual(names['Fly'], '10001')
        self.assertEqual(names['梦岚'], '10005')

    def test_library_retains_historical_versions(self):
        doc = load_roster()
        sample = {'players': [{'id': '891E14BB89089AB10610A3566750F687@10016',
                              'team_fid': '10016', 'active': True, 'current_team': None,
                              'versions': [{'year': 2026, 'rating': 89, 'games': 77}]}]}
        update_library(sample, doc)
        self.assertFalse(sample['players'][0]['active'])
        self.assertEqual(sample['players'][0]['current_team'], 'KSG')
        self.assertEqual(sample['players'][0]['versions'], [{'year': 2026, 'rating': 89, 'games': 77}])

    def test_picker_references_real_season_records(self):
        doc = load_roster()
        stats = json.loads((ROOT / 'data/processed/player_season_stats.json').read_text(encoding='utf-8'))['records']
        records = {(r['player_id'], r['season_id'], r['team_franchise']) for r in stats}
        for team in doc['teams']:
            squad = json.loads((ROOT / f"app/data/teams/{team['franchiseId']}.json").read_text(encoding='utf-8'))
            self.assertEqual(squad['registered_roster'], team['players'])
            for card in squad['players']:
                for v in card['versions']:
                    if v.get('registration_reference'):
                        self.assertIn((card['player_id'], v['season_id'], v['source_team_fid']), records)
                        self.assertIn(v['source_team_name'], v['label'])
                        self.assertNotEqual(v['season_id'], doc['seasonId'])
        for fid, name in [('10001', 'Fly'), ('10005', '梦岚'), ('10003', '涛'), ('10020', '花缘'), ('10008', '小A')]:
            squad = json.loads((ROOT / f'app/data/teams/{fid}.json').read_text(encoding='utf-8'))
            card = next(c for c in squad['players'] if c['name'] == name)
            self.assertTrue(card['active'])
            self.assertTrue(any(v['year'] == 2026 for v in card['versions']))


if __name__ == '__main__':
    unittest.main()
