"""Regression checks for data rendered into shareable static HTML."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sim_engine import render_result_card


class SecurityHtmlTests(unittest.TestCase):
    def test_result_card_escapes_data_fields(self):
        payload = '<img src=x onerror=alert(1)>'
        row = {
            'player_id': 'p1', 'position': payload, 'games': 1,
            'avg_kda': 1.0, 'avg_kill_num': 1.0,
            'avg_participation_rate': 50.0, 'mvp_count': 0,
        }
        card = render_result_card(
            [row], [{'round': '常规赛', 'opp': payload, 'score': payload, 'win': True}],
            payload, payload, None, {'p1': payload}, {'p1': 'x" onerror="alert(1)'},
        )
        self.assertNotIn(payload, card)
        self.assertNotIn('this.outerHTML', card)
        self.assertIn('&lt;img src=x onerror=alert(1)&gt;', card)
        self.assertIn('src="x&quot; onerror=&quot;alert(1)"', card)


if __name__ == '__main__':
    unittest.main()
