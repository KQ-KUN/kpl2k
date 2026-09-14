"""Offline regression for official roster corrections and importer coverage."""
import unittest
from pathlib import Path

from import_kpl2k import build_snapshot, load_json, DEFAULT_CONFIG, POSITION_ORDER, is_kpl_league

ROOT = Path(__file__).resolve().parents[2]


class ChampionshipDataTest(unittest.TestCase):
    def test_historical_supplements_are_backed_by_individual_matches(self):
        evidence = [load_json(path) for path in (ROOT / "data/curated").glob("wanplus_K*.json")]
        matches = {doc["sampleEventId"]: {m["matchId"]: m for m in doc["matches"]} for doc in evidence}
        historical_doc = load_json(ROOT / "data/curated/historical_appearances.json")
        supplements = historical_doc["players"]
        snapshot, _ = build_snapshot(ROOT, DEFAULT_CONFIG)
        players = {p["id"]: p for p in snapshot["players"]}
        for pid, profile in supplements.items():
            self.assertEqual(players[pid]["nickname"], profile["nickname"])
            for event in profile["events"]:
                self.assertIn(event["eventId"], matches)
                self.assertEqual(len(event["matchIds"]), len(set(event["matchIds"])))
                for mid in event["matchIds"]:
                    self.assertTrue(any(p["wanplusPlayerId"] == profile["wanplusPlayerId"] and p["nickname"] in profile["aliases"] for p in matches[event["eventId"]][mid]["players"]))
                for fid, mids in event.get("teamMatchIds", {}).items():
                    for mid in mids:
                        row = next(p for p in matches[event["eventId"]][mid]["players"] if p["wanplusPlayerId"] == profile["wanplusPlayerId"])
                        self.assertEqual(historical_doc["teams"][row["wanplusTeamId"]]["franchiseId"], fid)
        by_name = {p["nickname"]: p for p in players.values()}
        for name in ("Hurt", "无痕", "橘子", "伪装"):
            self.assertEqual(by_name[name]["debutYear"], 2016)
        for name in ("最初", "柠栀", "尘夏"):
            self.assertEqual(by_name[name]["debutYear"], 2018)
        self.assertEqual(by_name["Fly"]["debutYear"], 2017)
        for name in ("初晨", "虔诚", "暴风锐"):
            self.assertEqual(by_name[name]["debutYear"], 2017)
        self.assertEqual(by_name["六点六"]["debutYear"], 2018)
        self.assertIn("Six", by_name["六点六"]["aliases"])
        self.assertIn("Storm", by_name["暴风锐"]["aliases"])
        self.assertIn("Rouse", by_name["虔诚"]["aliases"])
        self.assertIn("10004", by_name["六点六"]["kplAppearanceTeamIds"])
        self.assertIn("10001", by_name["Cat"]["kplAppearanceTeamIds"])
        self.assertIn("10001", by_name["Alan"]["kplAppearanceTeamIds"])
        self.assertIn("10006", by_name["伪装"]["kplAppearanceTeamIds"])
        self.assertIn("10001", by_name["伪装"]["kplAppearanceTeamIds"])
        self.assertIn("HIST_ASXIANGE", by_name["无痕"]["kplAppearanceTeamIds"])
        self.assertIn("HIST_MU", by_name["Hurt"]["kplAppearanceTeamIds"])
        self.assertEqual(by_name["小羽"]["debutYear"], 2022)
        self.assertNotIn("26433", {p["wanplusPlayerId"] for p in supplements.values()})

    def test_historical_games_only_supplement_missing_events(self):
        snapshot, _ = build_snapshot(ROOT, DEFAULT_CONFIG)
        config = load_json(DEFAULT_CONFIG)
        aliases = config.get("playerIdAliases", {})
        seasons = {s["season_id"] for s in load_json(ROOT / "data/processed/seasons.json")["seasons"] if s.get("is_battlefield")}
        rows = load_json(ROOT / "data/processed/player_season_stats.json")["records"]
        supplements = load_json(ROOT / "data/curated/historical_appearances.json")["players"]
        for player in snapshot["players"]:
            own = [r for r in rows if aliases.get(r["player_id"], r["player_id"]) == player["id"] and r["season_id"] in seasons and r.get("games", 0) > 0 and r.get("position") in POSITION_ORDER]
            covered = {r["season_id"] for r in own}
            unique_rows = {}
            for row in own:
                key = (row["season_id"], row.get("team_franchise"), row["position"])
                unique_rows[key] = max(unique_rows.get(key, 0), int(row["games"]))
            extra = supplements.get(player["id"], {}).get("events", [])
            expected = sum(unique_rows.values()) + sum(len(set(e["matchIds"])) for e in extra if e["eventId"] not in covered)
            self.assertEqual(player["totalGames"], expected, player["nickname"])

    def test_official_identity_supplement_has_provenance_and_unique_names(self):
        profiles = load_json(ROOT / "data/curated/official_player_profiles.json")
        snapshot, _ = build_snapshot(ROOT, DEFAULT_CONFIG)
        by_id = {p["id"]: p for p in snapshot["players"]}
        self.assertEqual(len(profiles["profiles"]), 145)
        for profile in profiles["profiles"]:
            self.assertEqual(len(profile["realNames"]), 1)
            self.assertTrue(profile["appearances"])
            self.assertTrue(profile["officialPlayerIds"])
            if profile["playerId"] in by_id:
                player = by_id[profile["playerId"]]
                self.assertEqual(player["realName"], profile["realNames"][0])
                self.assertIn(player["realName"], player["aliases"])
        self.assertEqual(sum(bool(p["realName"]) for p in by_id.values()), 140)

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
            history = load_json(ROOT / "data/curated/historical_appearances.json")["players"].get(player["id"], {}).get("events", [])
            with self.subTest(nickname=player["nickname"]):
                self.assertEqual(player["latestYear"], max(seasons[row["season_id"]]["year"] for row in rows))
                self.assertEqual(set(player["positions"]), set(corrections.get(player["id"], {}).get("positions", [row["position"] for row in rows])))
                self.assertEqual(set(player["teamHistory"]), {row["team_franchise"] for row in rows if row.get("team_franchise")} | {fid for event in history for fid in event.get("teamMatchIds", {})})
                self.assertEqual(player["active"], any(row["season_id"] in config["activeSeasonIds"] for row in rows))
                expected_teams = {row["team_franchise"] for row in rows if row.get("team_franchise") and is_kpl_league(seasons[row["season_id"]])}
                expected_teams.update(fid for event in history if event["eventId"].startswith("KPL") for fid in event.get("teamMatchIds", {}))
                self.assertEqual(player["formalTeamCount"], len(expected_teams))
                history = load_json(ROOT / "data/curated/historical_appearances.json")["players"].get(player["id"], {}).get("events", [])
                self.assertEqual(player["eventCount"], len({row["season_id"] for row in rows} | {event["eventId"] for event in history}))
                self.assertEqual(set(player["kplAppearanceTeamIds"]), expected_teams)

    def test_official_corrections_survive_import(self):
        snapshot, audit = build_snapshot(ROOT, DEFAULT_CONFIG)
        players = {player["nickname"]: player for player in snapshot["players"]}
        expected = {
            "道崽": 1, "风箫": 1, "一笙": 3, "小俞": 1,
            "清清": 3, "皖皖": 1, "归期": 2, "小胖": 6,
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
