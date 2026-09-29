"""Keep the public library's champion cards aligned with reviewed finals starters."""
import json
import re
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = ('清清', '皖皖', '紫幻', '道崽', '信')


class ChampionshipLibraryTest(unittest.TestCase):
    def test_wolves_challenger_titles_reach_every_team_card(self):
        events = json.loads((ROOT / 'data/curated/championships.json').read_text(encoding='utf-8'))['events']
        champions = next(event for event in events if event['id'] == 'KCC2026')
        self.assertEqual(set(champions['starters']), set(NAMES))
        counts = Counter(name for event in events for name in event['starters'])
        html = (ROOT / 'app/player_library.html').read_text(encoding='utf-8')
        match = re.search(r'<script\b[^>]*\bid="library-data"[^>]*>(.*?)</script>', html, re.S)
        self.assertIsNotNone(match)
        published = json.loads(match.group(1))['players']
        source = json.loads((ROOT / 'data/processed/player_library.json').read_text(encoding='utf-8'))['players']
        for name in NAMES:
            for cards in (source, published):
                matches = [card for card in cards if card['name'] == name]
                self.assertTrue(matches, name)
                for card in matches:
                    self.assertEqual(card['championship_count'], counts[name], card['id'])
                    self.assertIn('KCC2026', card['championship_events'], card['id'])
                    self.assertNotIn('KPL2026S2', card['championship_events'], card['id'])


if __name__ == '__main__':
    unittest.main()
