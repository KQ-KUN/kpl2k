"""Synthetic roster tests for the teammate-edge construction rule."""

from __future__ import annotations

import unittest
import json
from itertools import combinations
from pathlib import Path

from tools.build_link_graph import historical_lineups, teammate_pairs


class TeammatePairsTest(unittest.TestCase):
    def test_same_club_in_different_seasons_is_not_an_edge(self) -> None:
        rosters = {
            ("KPL2019S1", "AG"): {"A", "C"},
            ("KPL2025S1", "AG"): {"B", "D"},
        }
        pairs = list(teammate_pairs(rosters))
        self.assertEqual(
            pairs,
            [("A", "C", "KPL2019S1", "AG"), ("B", "D", "KPL2025S1", "AG")],
        )
        self.assertFalse(any({left, right} == {"A", "B"} for left, right, _, _ in pairs))

    def test_same_season_different_clubs_is_not_an_edge(self) -> None:
        rosters = {
            ("KPL2025S1", "AG"): {"A", "C"},
            ("KPL2025S1", "Wolves"): {"B", "D"},
        }
        pairs = list(teammate_pairs(rosters))
        self.assertFalse(any({left, right} == {"A", "B"} for left, right, _, _ in pairs))
        self.assertIn(("A", "C", "KPL2025S1", "AG"), pairs)


class HistoricalLineupTest(unittest.TestCase):
    def setUp(self):
        self.identities = {"players": {
            "A": {"wanplusPlayerId": "1", "aliases": ["Cat"]},
            "B": {"wanplusPlayerId": "2", "aliases": ["Fly"]},
            "C": {"wanplusPlayerId": "3", "aliases": ["Cat"]},
        }, "teams": {"qg": {"franchiseId": "QG"}, "es": {"franchiseId": "ES"}}}
        # The source alternates team sides, so slicing the first five is wrong.
        players = []
        for index in range(5):
            players.extend([
                {"wanplusPlayerId": str(index * 2 + 1), "nickname": "Cat" if index < 2 else "unknown", "wanplusTeamId": "qg"},
                {"wanplusPlayerId": str(index * 2 + 2), "nickname": "Fly" if index == 0 else "unknown", "wanplusTeamId": "es"},
            ])
        self.doc = {"KPL2017S1": {"sampleEventId": "KPL2017S1", "matches": [
            {"matchId": "1", "source": "https://wanplus.cn/match/1.html", "players": players}
        ]}}

    def build(self):
        return historical_lineups(self.identities, self.doc, {"A", "B", "C"}, {})

    def test_actual_side_and_provider_identity_override_interleaving_and_same_name(self):
        lineups, audit = self.build()
        rosters = {team: players for _, team, players, _ in lineups}
        self.assertEqual(rosters, {"QG": {"A", "C"}, "ES": {"B"}})
        self.assertEqual(len(audit["excludedIdentities"]), 7)

    def test_missing_match_lineup_does_not_create_membership(self):
        self.doc["KPL2017S1"]["matches"] = [{"matchId": "1", "error": "missing lineup"}]
        lineups, audit = self.build()
        self.assertEqual(lineups, [])
        self.assertEqual(audit["missingLineups"], 1)

    def test_alias_and_duplicate_identity_are_rejected(self):
        self.identities["players"]["A"]["aliases"] = ["CatGod"]
        with self.assertRaisesRegex(ValueError, "unreviewed historical alias"):
            self.build()
        self.identities["players"]["A"]["wanplusPlayerId"] = "2"
        with self.assertRaisesRegex(ValueError, "duplicate/ambiguous"):
            self.build()

    def test_malformed_team_side_is_rejected(self):
        self.doc["KPL2017S1"]["matches"][0]["players"][0].pop("wanplusTeamId")
        with self.assertRaisesRegex(ValueError, "invalid historical team sides"):
            self.build()

    def test_real_snapshot_covers_all_reviewed_same_side_pairs(self):
        root = Path(__file__).resolve().parents[1]
        load = lambda path: json.loads(path.read_text(encoding="utf-8"))
        identities = load(root / "data/curated/wanplus_identity_map.json")
        graph = load(root / "link/public/data/link_graph.json")
        mapping = {p["wanplusPlayerId"]: pid for pid, p in identities["players"].items()}
        expected = {}
        # Independent reconstruction directly from individual source lineups.
        for path in (root / "data/curated").glob("wanplus_K*.json"):
            doc = load(path)
            for match in doc["matches"]:
                sides = {}
                for player in match.get("players", []):
                    if player["wanplusPlayerId"] in mapping:
                        sides.setdefault(player["wanplusTeamId"], set()).add(mapping[player["wanplusPlayerId"]])
                for team, roster in sides.items():
                    for left, right in combinations(sorted(roster), 2):
                        key = (f"{left}|{right}", doc["sampleEventId"], identities["teams"][team]["franchiseId"])
                        expected.setdefault(key, set()).add(match["source"])
        actual = {(pair, p["seasonId"], p["teamId"]): set(p["sourceUrls"])
                  for pair, proofs in graph["evidence"].items() for p in proofs
                  if p.get('provider') == 'WanPlus (non-official)'}
        self.assertEqual(actual, expected)
        names = {p["name"]: p["id"] for p in load(root / "link/public/data/players.json")["players"]}
        for a, b in [("Cat", "Fly"), ("Alan", "Fly"), ("Cat", "Hurt"), ("Alan", "Hurt"),
                     ("橘子", "伪装"), ("伪装", "Fly"), ("伪装", "Hurt"), ("Cat", "橘子"), ("Cat", "伪装")]:
            with self.subTest(pair=(a, b)):
                self.assertIn(names[b], graph["adjacency"][names[a]])


if __name__ == "__main__":
    unittest.main()
