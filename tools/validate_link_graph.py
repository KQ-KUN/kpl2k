"""Validate generated KPL Link data and print reproducible graph metrics."""

from __future__ import annotations

import json
from pathlib import Path

from build_link_graph import HISTORICAL_EVENTS, build_data, graph_stats, print_stats
from official_rosters import load_roster


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "link" / "public" / "data"


def load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def main() -> None:
    players_doc = load("players.json")
    graph_doc = load("link_graph.json")
    players = players_doc["players"]
    adjacency: dict[str, list[str]] = graph_doc["adjacency"]
    evidence: dict[str, list[dict[str, str]]] = graph_doc["evidence"]
    player_ids = {item["id"] for item in players}
    root = DATA.parents[2]
    source_seasons = json.loads((root / "data/processed/seasons.json").read_text(encoding="utf-8"))
    source_franchises = json.loads((root / "data/processed/franchises.json").read_text(encoding="utf-8"))
    valid_seasons = {str(item["season_id"]) for item in source_seasons["seasons"]}
    valid_teams = {str(item["franchise_id"]) for item in source_franchises["franchises"]}
    identities = json.loads((root / "data/curated/wanplus_identity_map.json").read_text(encoding="utf-8"))
    valid_seasons.update(HISTORICAL_EVENTS)
    valid_seasons.add(load_roster()['seasonId'])
    valid_teams.update(t["franchiseId"] for t in identities["teams"].values())

    assert len(player_ids) == len(players), "duplicate player IDs"
    assert all(str(item["name"]).strip() and item["name"] != item["id"] for item in players), "blank player nickname"
    for item in players:
        if item["avatar"]:
            assert item["avatar"].startswith("./assets/player-icons/"), "unsafe avatar path"
            source_avatar = DATA.parent / item["avatar"].removeprefix("./")
            assert source_avatar.is_file(), f"missing avatar: {source_avatar}"
    assert player_ids == set(adjacency), "players and adjacency keys differ"
    assert players_doc["dataVersion"] == graph_doc["dataVersion"], "data version mismatch"

    edge_count = 0
    for player_id, neighbors in adjacency.items():
        assert neighbors == sorted(set(neighbors)), f"neighbors not sorted/unique: {player_id}"
        assert player_id not in neighbors, f"self edge: {player_id}"
        for neighbor in neighbors:
            assert neighbor in player_ids, f"unknown neighbor: {neighbor}"
            assert player_id in adjacency[neighbor], f"asymmetric edge: {player_id}, {neighbor}"
            key = "|".join(sorted((player_id, neighbor)))
            assert key in evidence and evidence[key], f"missing evidence: {key}"
            for proof in evidence[key]:
                assert all(proof.get(field) for field in ("teamId", "teamName", "seasonId", "seasonName"))
                assert proof["teamId"] in valid_teams, f"unknown team in evidence: {key}"
                assert proof["seasonId"] in valid_seasons, f"unknown season in evidence: {key}"
                if proof["seasonId"] in HISTORICAL_EVENTS:
                    assert proof.get("provider") == "WanPlus (non-official)", f"missing historical provider: {key}"
                    assert proof.get("sourceUrls"), f"missing historical match sources: {key}"
            if player_id < neighbor:
                edge_count += 1
    assert edge_count == len(evidence), "edge/evidence count mismatch"

    calculated = graph_stats(adjacency)
    assert calculated == graph_doc["stats"], "stored graph stats are stale"
    audit = graph_doc.get("sourceAudit", {})
    assert 0 <= audit.get("unmappedRecords", -1) <= audit.get("attributionRecords", -1), "invalid source audit"
    # Validate coverage as well as graph shape. Previously a graph could pass
    # while omitting every pre-2019 teammate relationship.
    expected_players, expected_graph = build_data()
    assert players_doc == expected_players, "player snapshot differs from source data"
    assert graph_doc == expected_graph, "graph has missing, extra, or unsupported source evidence"
    print("KPL Link graph validation passed.")
    print_stats(calculated)


if __name__ == "__main__":
    main()
