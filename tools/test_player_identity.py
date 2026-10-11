"""Regression checks for the two Weiyang identities and YiAn's historical roles."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AG = 'FEC77937DF7DD29C1BEAE6DE2456AFF3'
YI = '9A3E415711EF5EB63681FC4048C8B3A7'
GK = 'WP26473'

def load(relative):
    return json.loads((ROOT / relative).read_text(encoding='utf-8'))

class PlayerIdentityTest(unittest.TestCase):
    def test_same_provider_connects_lyr_and_gk_weiyang_only(self):
        observed = set()
        for path in (ROOT / 'data/curated').glob('wanplus_K*.json'):
            for match in json.loads(path.read_text(encoding='utf-8'))['matches']:
                for player in match.get('players', []):
                    if player['wanplusPlayerId'] == '26473':
                        self.assertEqual(player['wanplusTeamId'], '4472')
                        observed.add(player['nickname'])
        self.assertEqual(observed, {'Lyr', '未央'})
        mapping = load('data/curated/wanplus_identity_map.json')['players']
        self.assertEqual(mapping[GK]['wanplusPlayerId'], '26473')
        self.assertNotIn(AG, {pid for pid, p in mapping.items() if p['wanplusPlayerId'] == '26473'})

    @unittest.skipUnless((ROOT / 'link/public/data/link_graph.json').exists(), 'Link owns its independent runtime snapshot')
    def test_no_gk_membership_or_direct_teammate_leaks_to_ag(self):
        graph = load('link/public/data/link_graph.json')
        gk_proofs = [proof for pair, proofs in graph['evidence'].items() if GK in pair.split('|') for proof in proofs]
        self.assertTrue(gk_proofs)
        self.assertTrue(all(p['teamId'] == '10016' for p in gk_proofs))
        ag_proofs = [proof for pair, proofs in graph['evidence'].items() if AG in pair.split('|') for proof in proofs]
        self.assertTrue(ag_proofs)
        self.assertFalse(any(p['seasonId'] == 'L20190001' or p['teamId'] == '10016' for p in ag_proofs))
        self.assertNotIn(GK, graph['adjacency'][AG])
        self.assertNotIn(AG, graph['adjacency'][GK])

    @unittest.skipUnless((ROOT / 'link/public/data/players.json').exists(), 'Link owns its independent runtime snapshot')
    def test_identity_counts_and_names_are_distinct(self):
        players = {p['id']: p for p in load('link/public/data/players.json')['players']}
        self.assertEqual(players[AG]['name'], '未央（AG）')
        self.assertEqual(players[GK]['name'], '未央（GK / Lyr）')
        self.assertEqual(players[AG]['totalGames'], 173)
        self.assertEqual(players[GK]['totalGames'], 44)  # 42 sampled historical games + 2 official games.
        self.assertEqual(players[GK]['debutYear'], 2017)
        self.assertEqual(players[GK]['recentTeamName'], 'GK')
        self.assertIn('GK.lyr', players[GK]['aliases'])
        self.assertNotIn('GK.lyr', players[AG]['aliases'])

    def test_yian_versions_keep_top_and_support_by_season(self):
        stats = [r for r in load('data/processed/player_season_stats.json')['records'] if r['player_id'] == YI]
        self.assertEqual(sum(r['games'] for r in stats), 275)
        self.assertEqual({r['season_id']: r['position'] for r in stats}, {
            'KPL2022S2': '对抗路', 'KPL2023S1': '对抗路', 'KPL2023S2': '对抗路',
            'KPL2024S2': '对抗路', 'KPL2026S1': '游走',
        })
        for fid, expected in [('10027', '对抗路'), ('10601', '对抗路'), ('10010', '游走')]:
            player = next(p for p in load(f'app/data/teams/{fid}.json')['players'] if p['player_id'] == YI)
            self.assertEqual(player['positions'], [expected])
            self.assertTrue(all(v['position'] == expected for v in player['versions']))
        base = load('app/data/base.json')
        self.assertEqual(base['players'][YI]['positions'], ['对抗路', '游走'])

    def test_gk_official_games_use_explicit_context_binding(self):
        attrs = load('data/processed/player_attribution.json')['records']
        record = next(r for r in attrs if (r['season_id'], r['team_franchise'], r['player_name']) == ('L20190001', '10016', '未央'))
        self.assertEqual((record['player_id'], record['games'], record['position']), (GK, 2, '发育路'))

if __name__ == '__main__':
    unittest.main()
