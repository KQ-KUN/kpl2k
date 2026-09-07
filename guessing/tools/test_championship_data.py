"""Offline regression for official roster corrections and importer coverage."""
import unittest
from pathlib import Path

from import_kpl2k import build_snapshot, load_json, DEFAULT_CONFIG, POSITION_ORDER, is_kpl_league

ROOT = Path(__file__).resolve().parents[2]


class ChampionshipDataTest(unittest.TestCase):
    def test_short_appearances_are_not_lost_from_careers(self):
        snapshot, _ = build_snapshot(ROOT, DEFAULT_CONFIG)
        config = load_json(DEFAULT_CONFIG)
        corrections = load_json(DEFAULT_CONFIG.with_name("profile_corrections.json"))["players"]
        aliases = config.get("playerIdAliases", {})
        seasons = {row["season_id"]: row for row in load_json(ROOT / "data/processed/seasons.json")["seasons"] if row.get("is_battlefield")}
        rows_by_id = {}
        for row in load_json(ROOT / "data/processed/player_season_stats.json")["records"]:
            if row["season_id"] in seasons and row.get("games", 0) > 0 and row.get("position") in POSITION_ORDER:
                rows_by_id.setdefault(aliases.get(row["player_id"], row["player_id"]), []).append(row)
        for player in snapshot["players"]:
            rows = rows_by_id[player["id"]]
            with self.subTest(nickname=player["nickname"]):
                self.assertEqual(player["latestYear"], max(seasons[row["season_id"]]["year"] for row in rows))
                self.assertEqual(set(player["positions"]), set(corrections.get(player["id"], {}).get("positions", [row["position"] for row in rows])))
                self.assertEqual(set(player["teamHistory"]), {row["team_franchise"] for row in rows if row.get("team_franchise")})
                self.assertEqual(player["active"], any(row["season_id"] in config["activeSeasonIds"] for row in rows))
                expected_teams = {row["team_franchise"] for row in rows if row.get("team_franchise") and is_kpl_league(seasons[row["season_id"]])}
                self.assertEqual(player["formalTeamCount"], len(expected_teams))
                self.assertEqual(player["eventCount"], len({row["season_id"] for row in rows}))
                self.assertEqual(set(player["kplAppearanceTeamIds"]), expected_teams)

    def test_official_corrections_survive_import(self):
        snapshot, audit = build_snapshot(ROOT, DEFAULT_CONFIG)
        players = {player["nickname"]: player for player in snapshot["players"]}
        expected = {
            "道崽": 1, "风箫": 1, "一笙": 3, "小俞": 1,
            "清清": 3, "皖皖": 1, "归期": 2, "小胖": 5,
            "星宇": 1, "玖欣": 1, "小屿": 1, "信": 1,
            "久龙": 2, "最初": 3, "Giao": 1, "柠栀": 3,
            "Hurt": 4, "Snow": 1, "尘夏": 3, "易峥": 6,
            "Alan": 5, "千世": 2, "无痕": 1,
        }
        for nickname, count in expected.items():
            with self.subTest(nickname=nickname):
                self.assertEqual(players[nickname]["championshipCount"], count)
        self.assertTrue(players["信"]["hasFmvp"])
        self.assertTrue(players["子阳"]["hasFmvp"])
        self.assertEqual(players["七年"]["championshipCount"], 0)
        self.assertEqual(players["北岛"]["positions"], ["发育路"])
        self.assertEqual(players["轻语"]["debutYear"], 2023)
        self.assertEqual(players["轻语"]["formalTeamCount"], 2)
        self.assertEqual(players["钎城"]["formalTeamCount"], 2)
        self.assertNotIn("10010", players["钎城"]["kplAppearanceTeamIds"])
        self.assertIn("10010", players["钎城"]["teamHistory"])
        self.assertFalse(is_kpl_league({"season_id": "KCC2024", "name": "2024挑战者杯", "league_type": "kpl"}))
        self.assertTrue(is_kpl_league({"season_id": "KPL2024S3", "name": "2024王者荣耀年度总决赛", "league_type": "kpl"}))
        for player in snapshot["players"]:
            if player["debutYear"] is None:
                self.assertEqual(player["difficulty"], ["hardcore"])
        self.assertEqual(len(snapshot["players"]), 590)
        self.assertFalse(players["Cat"]["championshipVerified"])
        self.assertFalse(players["橘子"]["championshipVerified"])
        self.assertNotIn("1dao", players)
        self.assertNotIn("D e", players)
        self.assertTrue(audit["championshipPendingReview"])
        self.assertEqual(
            load_json(ROOT / "data/curated/championships.json"),
            load_json(ROOT / "guessing/config/championship_rosters.json"),
        )


if __name__ == "__main__":
    unittest.main()
