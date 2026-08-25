#!/usr/bin/env python3
"""Validate narrative data and score-sensitive match copy."""

from __future__ import annotations

import json
import random
import re
from pathlib import Path

import sim_engine
import narrative


ROOT = Path(__file__).resolve().parents[1]
NARRATIVE = ROOT / "data" / "narrative"
PLACEHOLDER = re.compile(r"\{[a-z_]+\}")
BANNED = (
    "假赛", "逃兵", "羊叫病", "软脚虾", "懦崽", "肥牛", "奴鱼", "美妆",
    "羊叫", "下饭", "摆兽", "小摆熊", "麦乐送", "四饱", "菜卷", "送岚",
    "躺然", "易蒸发", "水酷", "出笙", "呜鸣", "雪亡", "变刘明",
    "1200万欢乐豆", "一诺行为", "保KDA", "黑蛋", "背锅侠", "小菜", "彷徨",
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def all_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from all_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from all_strings(item)


def fake_roster(prefix: str) -> list[dict]:
    return [
        {"player_id": f"{prefix}{i}", "position": role, "team_franchise": prefix}
        for i, role in enumerate(("对抗路", "打野", "中路", "发育路", "游走"), start=1)
    ]


def render(results: list[str], bo: int, seed: int) -> str:
    roster_a, roster_b = fake_roster("A"), fake_roster("B")
    names = {r["player_id"]: r["player_id"] for r in roster_a + roster_b}
    lines = sim_engine.narrate_series(
        random.Random(seed), sim_engine.load_templates(), "A队", "B队", results,
        roster_a, roster_b, names, bo, 2026,
    )
    text = "\n".join(lines)
    assert len(lines) == len(results)
    assert all(line.count("；") >= 2 for line in lines), "每局必须包含至少三段中期事件"
    assert not PLACEHOLDER.search(text), f"存在未替换占位符：{PLACEHOLDER.search(text)}"
    return text


def main() -> None:
    files = tuple(NARRATIVE.glob("*.json"))
    docs = {path.name: load_json(path) for path in files}
    strings = list(all_strings(docs))
    strings.append((ROOT / "docs" / "narrative_text.txt").read_text(encoding="utf-8"))
    for word in BANNED:
        assert not any(word in line for line in strings), f"发现禁用文本：{word}"
    role_events = docs["templates.json"].get("role_events", {})
    for role in ("对抗路", "打野", "中路", "发育路", "游走"):
        assert len(role_events.get(role, [])) >= 3, f"{role}专属事件不足"

    cases = {
        "bo3_sweep": (["A", "A"], 3),
        "bo3_decider": (["A", "B", "A"], 3),
        "bo5_reverse_two": (["B", "B", "A", "A", "A"], 5),
        "bo7_peak": (["B", "B", "B", "A", "A", "A", "A"], 7),
        "bo9_peak": (["B", "B", "B", "A", "A", "A", "B", "A", "A"], 9),
    }
    for name, (results, bo) in cases.items():
        for seed in range(100):
            text = render(results, bo, seed)
            if bo < 7:
                assert "巅峰对决" not in text, f"{name} 错误出现巅峰对决"
            if name != "bo5_reverse_two":
                assert "让二追三" not in text, f"{name} 错误出现让二追三"
            if name not in ("bo7_peak", "bo9_peak"):
                assert "让三追三" not in text, f"{name} 错误出现让三追三"

    tpl = sim_engine.load_templates()
    flavor = docs["player_flavor.json"]["flavors"]
    for seed in range(100):
        for champion in ("成都AG超玩会", "重庆狼队"):
            ctx = {
                "season_name": "测试赛季",
                "year": 2026,
                "team": "成都AG超玩会",
                "roster": ["一诺", "钟意", "长生", "轩染", "大帅"],
                "champion": champion,
                "regular": {"track": {"rank": 1, "wins": 8, "losses": 2}, "seed_notes": []},
                "path": [
                    {"round": "季后赛", "opp": "北京WB", "opp_players": ["暖阳"], "score": "4:2", "win": True, "results": ["A", "B", "A", "A", "B", "A"], "games": ["测试小局"]},
                    {"round": "总决赛", "opp": "重庆狼队", "opp_players": ["Fly"], "score": "4:3" if champion == "成都AG超玩会" else "3:4", "win": champion == "成都AG超玩会", "results": ["A", "B", "A", "B", "A", "B", "A"], "games": ["测试决赛"]},
                ],
            }
            story = narrative.build_story(random.Random(seed), tpl, flavor, ctx)
            story_text = "\n".join(all_strings(story))
            assert not PLACEHOLDER.search(story_text), f"赛季故事存在未替换占位符：{PLACEHOLDER.search(story_text)}"

    print(f"Narrative validation passed: {len(files)} files, {len(strings)} strings, {len(cases) * 100} seeded series, 200 season stories.")


if __name__ == "__main__":
    main()
