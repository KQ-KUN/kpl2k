"""2026 夏季赛收官验收：逐局完整性、冠军身份及两个选手库的一致性。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {"萝卜": 92, "小胖": 97, "鹤辞": 92, "小雪": 95, "涵": 93}


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def main():
    matches = read("data/raw/league_20260003_matches.json")["results"]
    total = 0
    for match in matches:
        assert match["status"] == 2, match["match_id"]
        battles = match["match_battle_video_list"]
        assert len(battles) == match["camp1"]["score"] + match["camp2"]["score"], match["match_id"]
        for battle in battles:
            data = read(f'data/raw/battles/20260003_{match["match_id"]}_{battle["battle_id"]}.json')["data"]
            assert len(data["battle_player_list"]) == 10, battle["battle_id"]
            total += 1
            if match["match_id"] == "2026091201":
                assert {p["player_name"] for p in data["battle_player_list"] if str(p["team_id"]) == "10017"} == set(EXPECTED)
    season = next(s for s in read("data/processed/seasons.json")["seasons"] if s["season_id"] == "KPL2026S2")
    assert season["status"] == 2 and season["champion_franchise"] == "10017" and season["runner_up_franchise"] == "10001"
    players = {p["player_id"]: p["name"] for p in read("data/processed/players.json")["players"]}
    stats = read("data/processed/player_season_stats.json")["records"]
    roster = [r for r in stats if r["season_id"] == "KPL2026S2" and r["team_franchise"] == "10017"]
    assert {players[r["player_id"]] for r in roster} == set(EXPECTED)
    for row in roster:
        assert row["rating"] == EXPECTED[players[row["player_id"]]], row
    quiz = {p["nickname"]: p for p in read("guessing/public/data/quiz_players.json")["players"]}
    for name in EXPECTED:
        assert quiz[name]["championshipCount"] == (6 if name == "小胖" else 1), name
        assert quiz[name]["latestTeamId"] == "10017", name
        assert quiz[name]["peakRating"] >= EXPECTED[name], name
    assert quiz["小胖"]["hasFmvp"]
    library = read("data/processed/player_library.json")["players"]
    for name, rating in EXPECTED.items():
        card = next(p for p in library if p["name"] == name and p["team_fid"] == "10017")
        annual = next(v for v in card["versions"] if v["year"] == 2026)
        assert annual["rating"] == rating, name
        assert card["championship_count"] == quiz[name]["championshipCount"], name
    print(f"2026 夏季赛验收通过：{len(matches)} 场 / {total} 小局，决赛七局首发及冠军五人评分、荣誉一致")


if __name__ == "__main__":
    main()
