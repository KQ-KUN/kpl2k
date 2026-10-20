import json
import tempfile
import unittest
from pathlib import Path
from copy import deepcopy
from tools.build_link_graph import emit_snapshot


class FrozenLinkSnapshotTests(unittest.TestCase):
    def emit(self, mutate=lambda players, graph: None):
        scratch = Path(__file__).resolve().parents[1] / 'output'
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='link-snapshot-', dir=scratch) as temp:
            root = Path(temp)
            source = root / 'frozen.json'
            source.write_text('{}', encoding='utf8')
            players = {'schemaVersion': 1, 'dataVersion': 'frozen', 'players': [{'id': i, 'avatar': ''} for i in 'ABC']}
            graph = {'schemaVersion': 1, 'dataVersion': 'frozen', 'adjacency': {'A': ['B'], 'B': ['A'], 'C': []},
                     'evidence': {'A|B': [{'seasonId': 'KPL2020S1', 'teamId': 'known'}]}, 'stats': {'playerCount': 3}}
            mutate(players, graph)
            output = root / 'public/data'
            emit_snapshot(players, graph, output, 'a' * 40, [source], frozen=True)
            return {path.name: json.loads(path.read_text('utf8')) for path in output.glob('*.json')}

    def test_split_preserves_facts_and_unknown_index(self):
        output = self.emit()
        self.assertNotIn('evidence', output['link_graph.json'])
        self.assertEqual(output['link_graph.json']['latestYear'], {'A': 2020, 'B': 2020, 'C': None})
        self.assertEqual(output['link_evidence.json']['evidence']['A|B'][0]['teamId'], 'known')
        self.assertFalse(output['manifest.json']['semantics']['upstreamRawRebuild'])
        self.assertEqual(len(output['manifest.json']['outputs']), 3)
        self.assertEqual(output['link_graph.json']['sourceAudit']['legacyDataVersion'], 'frozen')
        for name in ('players.json', 'link_graph.json', 'link_evidence.json', 'manifest.json'):
            self.assertEqual(output[name]['dataVersion'], 'source:' + 'a' * 40)
        self.assertEqual(output['manifest.json']['inputs'][0]['path'], 'frozen.json')
        self.assertEqual(output['manifest.json']['inputs'][0]['sourceCommit'], 'a' * 40)

    def test_version_mismatch_duplicate_unknown_or_asymmetric_ids_rejected(self):
        mutations = [
            lambda p, g: p.update(dataVersion='other'),
            lambda p, g: p['players'].append(deepcopy(p['players'][0])),
            lambda p, g: g['adjacency']['A'].append('UNKNOWN'),
            lambda p, g: g['adjacency']['B'].clear(),
            lambda p, g: g['evidence'].clear(),
            lambda p, g: g['adjacency']['A'].append('A'),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): self.emit(mutation)


if __name__ == '__main__': unittest.main()
