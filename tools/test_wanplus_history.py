"""公开页面解析与身份合并的离线回归，不依赖网络或本地爬虫缓存。"""
import unittest
from collect_wanplus_history import players_in_match
from build_wanplus_appearances import build


class WanplusHistoryTest(unittest.TestCase):
    def test_interleaved_players_belong_to_their_actual_side(self):
        text = '<div class="bssj_top"><a href="/kog/team/1">A</a><a href="/kog/team/2">B</a></div>'
        for index in range(5):
            for side, prefix in (("l", "1"), ("r", "2")):
                text += f'<div class="bans_{side}"><a href="/kog/player/{prefix}{index}"><strong>{prefix}-{index}</strong></a></div>'
        players = players_in_match(text)
        self.assertEqual(len(players), 10)
        for player in players:
            self.assertEqual(player["wanplusTeamId"], player["wanplusPlayerId"][0])

    def test_missing_lineup_is_not_a_team_appearance(self):
        with self.assertRaises(ValueError):
            players_in_match('<title>比赛录像</title><p>比分 4:2</p>')

    def test_builder_rejects_unreviewed_alias_and_duplicate_identity(self):
        identities = {"players": {"p": {"nickname": "Cat", "wanplusPlayerId": "1", "aliases": ["Cat"]}}, "teams": {}}
        evidence = {"KPL2016S2": {"checkedAt": "2026-09-08", "matches": [{"matchId": "1", "players": [{"wanplusPlayerId": "1", "nickname": "另一个名字"}]}]}}
        with self.assertRaisesRegex(ValueError, "别名"):
            build(identities, evidence)
        evidence["KPL2016S2"]["matches"][0]["players"][0]["nickname"] = "Cat"
        identities["players"]["duplicate"] = identities["players"]["p"]
        with self.assertRaisesRegex(ValueError, "重复"):
            build(identities, evidence)

    def test_match_ids_deduplicate_and_error_pages_do_not_add_games(self):
        identities = {"players": {"p": {"nickname": "Cat", "wanplusPlayerId": "1", "aliases": ["Cat"]}}, "teams": {}}
        match = {"matchId": "1", "players": [{"wanplusPlayerId": "1", "nickname": "Cat"}]}
        evidence = {"KCC2017": {"checkedAt": "2026-09-08", "matches": [match, match, {"matchId": "2", "error": "无阵容"}]}}
        result = build(identities, evidence)
        self.assertEqual(result["players"]["p"]["events"][0]["matchIds"], ["1"])


if __name__ == "__main__":
    unittest.main()
