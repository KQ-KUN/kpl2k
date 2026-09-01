"""KPL 2K 数据关联 v0.1

输入：
- data/raw/kpl_*（kpl.qq.com 赛季/战队/赛程）
- data/processed/seasons.json + franchises_draft.json（smoba 清洗结果）

产出：
- data/processed/franchises.json：smoba 俱乐部 ID ↔ kpl 队名 slug ↔ 各赛季历史名
- data/processed/formats.json：每个可用战场的赛制结构摘要（分组/轮次/类型/BO）
- 终端输出冠军交叉校验（smoba 冠军 vs kpl 决赛冠军，按 slug 对齐）

用法：
  python tools/build_kpl_maps.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
DATA_VERSION = "2026-08-15"

# ---------------------------------------------------------------------------
# 各赛季赛制规则（2026-08-19 核对，来源：KPL 官方赛程赛制公告 / 世冠·挑杯·年总规则）
#   kpl_single   2019-2020 常规赛单轮大循环，前 N 名进季后赛（双败）
#   kpl_3round   2021+ 常规赛三轮（第一轮→升降分组→第二轮→卡位赛→B组淘汰→第三轮→季后赛）
#                  r2_mode=swap    2021-2022：第一轮从季前 S/A/B 出发，组内排名局部升降
#                  r2_mode=by_rank 2023+：第一轮抽签 Group1-3，每组 1-2→S、3-4→A、5-6→B
#   group_stage  世冠/挑杯小组赛（组内循环），按组名次出线
#   swiss        2023 挑杯瑞士轮（近似：官方小组赛全跑，按总排名出线）
#   bracket      2025/2026 挑杯：官方 32 强 BO5 → 动态 16 强 BO7 → 8 强双败 BO7 → 决赛 BO9
#   annual       年总：大师/精英组外循环擂台赛 → 直进+突围赛 → 8 队双败
# ---------------------------------------------------------------------------
REGULAR_RULES: dict[str, dict] = {
    "L20190001": {"type": "kpl_single", "playoff_qualify": 10},
    "L20190004": {"type": "kpl_single", "playoff_qualify": 10},
    "L20200001": {"type": "kpl_single", "playoff_qualify": 10},
    "KPL2020S2": {"type": "kpl_single", "playoff_qualify": 10},
    "KPL2021S1": {"type": "kpl_3round", "r2_mode": "swap", "playoff_qualify": 10},
    "KPL2021S2": {"type": "kpl_3round", "r2_mode": "swap", "playoff_qualify": 10},
    "KPL2022S1": {"type": "kpl_3round", "r2_mode": "swap", "playoff_qualify": 10},
    "KPL2022S2": {"type": "kpl_3round", "r2_mode": "swap", "playoff_qualify": 10},
    "KPL2023S1": {"type": "kpl_3round", "r2_mode": "by_rank", "playoff_qualify": 10},
    "KPL2023S2": {"type": "kpl_3round", "r2_mode": "by_rank", "playoff_qualify": 10},
    "KPL2024S1": {"type": "kpl_3round", "r2_mode": "by_rank", "playoff_qualify": 10},
    "KPL2024S2": {"type": "kpl_3round", "r2_mode": "by_rank", "playoff_qualify": 10},
    "KPL2025S1": {"type": "kpl_3round", "r2_mode": "by_rank", "playoff_qualify": 10},
    "KPL2025S2": {"type": "kpl_3round", "r2_mode": "by_rank", "playoff_qualify": 10},
    "KPL2026S1": {"type": "kpl_3round", "r2_mode": "by_rank", "playoff_qualify": 10},
    "KPL2026S2": {"type": "kpl_3round", "r2_mode": "by_rank", "playoff_qualify": 10},
    "KPL2024S3": {"type": "annual", "masters": 6, "elite": 6, "final_bo": 7},
    "KPL2025S3": {"type": "annual", "masters": 6, "elite": 6, "final_bo": 7},
    "L20190003": {"type": "group_stage", "groups": 2, "advance": 4},
    "L20200003": {"type": "group_stage", "groups": 2, "advance": 4},
    "KCC2021S": {"type": "group_stage", "groups": 2, "advance": 4},
    "L20190006": {"type": "group_stage", "groups": 1, "advance": 8},
    "KCC2020W": {"type": "group_stage", "groups": 1, "advance": 8},
    "KCC2021S2": {"type": "group_stage", "groups": 1, "advance": 8},
    "KCC2022S1": {"type": "group_stage", "groups": 3, "advance": 2, "seeds": 2},
    "KCC2023": {"type": "swiss", "advance": 8},
    "KCC2024": {"type": "group_stage", "groups": 4, "advance": 4},
    "KCC2025": {"type": "bracket", "bo5": 5, "bo7": 7, "de_bo": 7, "final_bo": 9},
    "KCC2026": {"type": "bracket", "bo5": 5, "bo7": 7, "de_bo": 7, "final_bo": 9},
}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def norm_name(s: str) -> str:
    return re.sub(r"\s+", "", s or "").lower()


def kpl_slug(team_id: str) -> str:
    return team_id.rsplit("_", 1)[-1] if "_" in (team_id or "") else team_id


def infer_round_type(name: str) -> str:
    n = name or ""
    if "常规赛" in n:
        return "round_robin"
    if "卡位" in n:
        return "play_in"
    if "季后赛" in n:
        return "playoffs"
    if "总决赛" in n:
        return "final"
    if "单败" in n:
        return "single_elim"
    if "双败" in n:
        return "double_elim"
    if "淘汰" in n:
        return "playoffs"
    if "决赛" in n:
        if any(k in n for k in ("四分之一", "八分之一", "半决赛", "胜者组", "败者组", "十六强")):
            return "playoffs"
        return "final"
    return "other"


def _cn(n: int) -> str:
    return "一二三四五六七八九十"[n - 1] if 1 <= n <= 10 else str(n)


def _split_stage_rounds(matches: list[dict], key_of, bo_of) -> list[dict]:
    """同一赛段内 BO 变化的连续场次拆成子轮（如 单败淘汰赛第一轮/第二轮）。"""
    groups: list[dict] = []
    for m in matches:
        key = key_of(m)
        bo = int(bo_of(m) or 0)
        if groups and groups[-1]["key"] == key and (bo == 0 or bo == groups[-1]["bo"]):
            groups[-1]["matches"].append(m)
        else:
            groups.append({"key": key, "bo": bo, "matches": [m]})
    counts: dict[str, int] = {}
    for g in groups:
        counts[g["key"]] = counts.get(g["key"], 0) + 1
    seq: dict[str, int] = {}
    out: list[dict] = []
    for g in groups:
        key = g["key"]
        seq[key] = seq.get(key, 0) + 1
        name = key if counts[key] == 1 else f"{key}第{_cn(seq[key])}轮"
        out.append({"name": name, "type": infer_round_type(name), "bo": g["bo"], "matches": g["matches"]})
    return out


def build_franchises(season_team_names: dict[str, dict[str, str]]) -> tuple[list[dict], list[dict]]:
    """smoba franchise_id -> kpl slug：先用当前名精确匹配，再用缩写包含匹配，最后人工兜底。"""
    # 名 -> slug（优先取非"待定"的最新赛季名）
    name_slug: dict[str, str] = {}
    for sid in sorted(season_team_names, reverse=True):
        for slug, name in season_team_names[sid].items():
            n = norm_name(name)
            if n and "待定" not in n and n not in name_slug:
                name_slug[n] = slug

    draft = load(OUT / "franchises_draft.json")
    franchises: list[dict] = []
    unmatched: list[dict] = []
    for f in draft["franchises"]:
        fid = f["franchise_id"]
        slug = next((name_slug.get(norm_name(n)) for n in f["names"] if name_slug.get(norm_name(n))), None)
        if not slug:
            for abbr in f["abbreviations"]:
                a = norm_name(abbr)
                if not a:
                    continue
                hits = {s for s, names in season_team_names.items() for sl, nm in names.items()
                        if norm_name(nm) == a or a in norm_name(nm)}
                if hits:
                    # 集合迭代顺序会随 Python 进程变化；固定排序保证同一输入始终生成同一映射。
                    slug = sorted(hits)[0]
                    break
        if not slug:
            manual = {
                "xq": {"XQ"},
                "topm": {"TOPM"},
                "ba": {"BA"},
                "ts": {"TS"},
            }
            slug = next((k for k, abbrs in manual.items() if abbrs & set(f["abbreviations"])), None)
        if slug:
            franchises.append({
                "franchise_id": fid,
                "slug": slug,
                "current_names": sorted(f["names"]),
                "abbreviations": sorted(f["abbreviations"]),
                "names_by_season": {sid: season_team_names[sid][slug] for sid in season_team_names if slug in season_team_names[sid]},
                "seasons": sorted(f["seasons"]),
            })
        else:
            unmatched.append({
                "franchise_id": fid,
                "names": sorted(f["names"]),
                "abbreviations": sorted(f["abbreviations"]),
                "note": "未匹配到 kpl slug，可能为境外队/已解散队",
            })
    return franchises, unmatched


def kpl_schedule_rounds(sid: str) -> list[dict]:
    sched = load(RAW / f"kpl_season_{sid}_schedule.json")
    matches = (sched.get("data") or {}).get("list") or []
    # kpl 官方会把"季前赛"混进当赛季赛程（如 2021S1 混入 56 场）；
    # 季前赛有独立赛事（is_battlefield=False），从赛季结构中剔除。
    matches = [
        m for m in matches
        if "季前" not in (m.get("stage_name") or "")
        and not ((m.get("stage_name") or "") == "" and not m.get("stageid"))
    ]
    rounds: dict[str, dict] = {}
    for g in _split_stage_rounds(
        matches,
        key_of=lambda m: m.get("stage_name") or m.get("stageid") or "?",
        bo_of=lambda m: m.get("bo_total"),
    ):
        r = rounds.setdefault(g["name"], {"name": g["name"], "type": g["type"], "bo": g["bo"], "matches": []})
        for m in g["matches"]:
            r["matches"].append({
                "scheduleid": m.get("scheduleid"),
                "a_id": m.get("team_a_id"),
                "a_name": m.get("team_a_name"),
                "a_score": m.get("team_a_score"),
                "a_group": m.get("team_a_group"),
                "b_id": m.get("team_b_id"),
                "b_name": m.get("team_b_name"),
                "b_score": m.get("team_b_score"),
                "b_group": m.get("team_b_group"),
                "status": m.get("schedule_status"),
                "ts": m.get("start_timestamp"),
            })
    return list(rounds.values())


def smoba_rounds(league_id: str) -> list[dict]:
    raw = load(RAW / f"league_{league_id}_matches.json")
    matches = raw.get("results") or []
    rounds: dict[str, dict] = {}
    for g in _split_stage_rounds(
        matches,
        key_of=lambda m: m.get("match_stage_desc") or m.get("match_stage_name") or "?",
        bo_of=lambda m: m.get("bo"),
    ):
        r = rounds.setdefault(g["name"], {"name": g["name"], "type": g["type"], "bo": g["bo"], "matches": []})
        for m in g["matches"]:
            c1, c2 = m.get("camp1") or {}, m.get("camp2") or {}
            r["matches"].append({
                "a_id": c1.get("team_id"),
                "a_name": c1.get("team_abbreviation") or c1.get("team_name"),
                "a_score": c1.get("score"),
                "b_id": c2.get("team_id"),
                "b_name": c2.get("team_abbreviation") or c2.get("team_name"),
                "b_score": c2.get("score"),
                "status": m.get("status"),
                "ts": m.get("start_time"),
            })
    return list(rounds.values())


def derive_playoff_config(rounds: list[dict]) -> dict | None:
    """从真实赛程推导季后赛配置：晋级队数 / 赛制类型 / BO。

    双败判定信号：单败淘汰里每队最多输 1 场；若存在季后赛输过 2+ 场的队伍 → 双败。
    """
    po_rounds = [r for r in rounds if r["type"] in ("playoffs", "single_elim", "double_elim", "final")]
    if not po_rounds:
        return None
    teams: set[str] = set()
    losses: dict[str, int] = {}
    for r in po_rounds:
        for m in r["matches"]:
            a_id, b_id = m.get("a_id"), m.get("b_id")
            if a_id:
                teams.add(a_id)
            if b_id:
                teams.add(b_id)
            sa, sb = m.get("a_score"), m.get("b_score")
            if isinstance(sa, int) and isinstance(sb, int) and sa != sb:
                loser = b_id if sa > sb else a_id
                losses[loser] = losses.get(loser, 0) + 1
    types = {r["type"] for r in po_rounds}
    max_losses = max(losses.values(), default=1)
    ptype = "double_elim" if ("double_elim" in types or max_losses >= 2) else "single_elim"
    bo = max((r["bo"] or 0) for r in po_rounds) or 7
    return {"qualify": len(teams), "type": ptype, "bo": bo, "max_losses": max_losses}


def remap_kpl_ids(rounds: list[dict], slug_to_franchise: dict[str, str]) -> None:
    """kpl 赛程的队 id 是 'KPL2024S1_ag' 这类 slug，统一映射回俱乐部 id，与阵容/覆盖对齐。"""
    def conv(tid):
        if not isinstance(tid, str) or "_" not in tid:
            return tid
        return slug_to_franchise.get(norm_name(tid.rsplit("_", 1)[1]), tid)

    for r in rounds:
        for m in r["matches"]:
            m["a_id"] = conv(m["a_id"])
            m["b_id"] = conv(m["b_id"])


def fix_tournament_rounds(rounds: list[dict]) -> None:
    """挑战者杯/世冠等把淘汰赛阶段命名为'常规赛第X轮'（BO≥7），纠正类型并补决赛轮。"""
    for r in rounds:
        if r["type"] == "round_robin" and (r.get("bo") or 0) >= 7:
            if len(r["matches"]) == 1:
                r["name"] = "总决赛"
                r["type"] = "final"
            else:
                r["type"] = "single_elim"
    if not any(r["type"] == "final" for r in rounds) and rounds:
        last = rounds[-1]
        if last and last["matches"]:
            fm = max(last["matches"], key=lambda m: m.get("ts") or "")
            if len(last["matches"]) == 1:
                last["name"] = "总决赛"
                last["type"] = "final"
            else:
                last["matches"].remove(fm)
                rounds.append({"name": "总决赛", "type": "final", "bo": last["bo"] or 7, "matches": [fm]})


ELIM_SIZE_NAMES = {16: "32强", 8: "16强", 4: "8强", 2: "半决赛", 1: "总决赛"}


def name_tournament_rounds(rounds: list[dict], playoff_single: bool = False) -> None:
    """把淘汰赛轮次映射成 32强/16强/8强/半决赛，小组赛阶段改叫小组赛。"""
    for r in rounds:
        if r["type"] == "round_robin" and r.get("bo") and r["bo"] < 7 and r["name"] in ("常规赛第一轮", "常规赛"):
            r["name"] = "小组赛"
    out: list[dict] = []
    for r in rounds:
        split = r["type"] == "single_elim" or (r["type"] == "playoffs" and playoff_single)
        if not split:
            out.append(r)
            continue
        remaining = list(r["matches"])
        seq = 0
        while remaining:
            n = len(remaining)
            size = 1
            while size * 2 <= n:
                size *= 2
            chunk, remaining = remaining[:size], remaining[size:]
            seq += 1
            name = ELIM_SIZE_NAMES.get(size, f"淘汰赛第{seq}轮")
            out.append({"name": name, "type": r["type"], "bo": r["bo"], "matches": chunk})
    rounds[:] = out


def main() -> None:
    kpl_seasons = load(RAW / "kpl_seasons.json")
    season_team_names: dict[str, dict[str, str]] = {}
    for s in (kpl_seasons.get("data") or {}).get("seasons") or []:
        sid = s["seasonid"]
        meta = load(RAW / f"kpl_season_{sid}_meta.json")
        teams = {}
        for t in (meta.get("data") or {}).get("teams") or []:
            teams[kpl_slug(t["teamid"])] = t["team_name"]
        season_team_names[sid] = teams

    franchises, unmatched = build_franchises(season_team_names)
    slug_by_franchise = {f["franchise_id"]: f["slug"] for f in franchises}
    slug_to_franchise = {norm_name(f["slug"]): f["franchise_id"] for f in franchises}

    kpl_name_to_sid = {
        norm_name(s.get("season_name", "")): s["seasonid"]
        for s in (kpl_seasons.get("data") or {}).get("seasons") or []
    }
    seasons = load(OUT / "seasons.json")["seasons"]
    smoba_season_name_to_sid = {norm_name(s["name"] or ""): s["season_id"] for s in seasons}
    kpl_sid_to_smoba = {
        kpl_name_to_sid.get(norm_name(s["name"] or "")): s["season_id"]
        for s in seasons if norm_name(s["name"] or "") in kpl_name_to_sid
    }

    formats: dict[str, dict] = {}
    final_check: list[str] = []
    for s in seasons:
        if not s.get("is_battlefield"):
            continue
        sid = s["season_id"]
        kpl_sid = None
        for sid_candidate in (sid,):
            if sid_candidate in season_team_names:
                kpl_sid = sid_candidate
                break
        if not kpl_sid and norm_name(s["name"] or "") in kpl_name_to_sid:
            kpl_sid = kpl_name_to_sid[norm_name(s["name"] or "")]
        rounds = kpl_schedule_rounds(kpl_sid) if kpl_sid else smoba_rounds(s["league_id"])
        if kpl_sid:
            remap_kpl_ids(rounds, slug_to_franchise)
        fix_tournament_rounds(rounds)
        playoff_cfg = derive_playoff_config(rounds)
        name_tournament_rounds(rounds, playoff_single=(playoff_cfg or {}).get("type") == "single_elim")

        teams_by_group: dict[str, list[str]] = {}
        for r in rounds:
            for m in r["matches"]:
                for g, tid in ((m.get("a_group"), m.get("a_id")), (m.get("b_group"), m.get("b_id"))):
                    if g and tid:
                        teams_by_group.setdefault(g, [])
                        if tid not in teams_by_group[g]:
                            teams_by_group[g].append(tid)

        final_round = next((r for r in rounds if r["type"] == "final"), None)
        if not final_round:
            ended = [r for r in rounds for m in r["matches"] if m.get("status") == 4 or m.get("status") == 2]
            if ended:
                final_round = max(rounds, key=lambda r: max((m.get("ts") or "") for m in r["matches"]))
        champion_slug = None
        if final_round and final_round["matches"]:
            fm = max(final_round["matches"], key=lambda m: m.get("ts") or "")
            a, b = int(fm["a_score"] or 0), int(fm["b_score"] or 0)
            if a != b:
                champion_slug = kpl_slug(fm["a_id"]) if a > b else kpl_slug(fm["b_id"])

        formats[sid] = {
            "season_id": sid,
            "name": s["name"],
            "source": "kpl" if kpl_sid else "smoba",
            "rounds": rounds,
            "teams_by_group": teams_by_group,
            "champion_slug": champion_slug,
            "playoff_config": playoff_cfg,
            "regular_format": REGULAR_RULES.get(sid),
        }

        # 冠军交叉校验：smoba 冠军 franchise_id -> slug，与 kpl 决赛 slug 对比
        smoba_champion_slug = slug_by_franchise.get(s["champion_franchise"])
        if champion_slug and smoba_champion_slug:
            if champion_slug.isdigit():
                ok = "PASS" if champion_slug == s["champion_franchise"] else "FAIL"
                final_check.append(f"  {ok}  {sid:<12} smoba={s['champion_franchise']:<8} kpl(franchise)={champion_slug}")
            else:
                ok = "PASS" if champion_slug == smoba_champion_slug else "FAIL"
                final_check.append(f"  {ok}  {sid:<12} smoba={smoba_champion_slug:<8} kpl={champion_slug}")
        elif s.get("champion_franchise"):
            final_check.append(f"  SKIP {sid:<12} smoba={smoba_champion_slug} kpl=None")

    def dump(name: str, obj) -> None:
        (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")

    # 把有名字的未匹配队（青训/外卡/次级）补进 franchises，供显示名查询；
    # 它们不参与 slug 映射，仅在需要队伍显示名时兜底（如 franchise_names()）。
    known_ids = {f["franchise_id"] for f in franchises}
    for u in unmatched:
        if u["franchise_id"] not in known_ids and u["names"]:
            franchises.append({
                "franchise_id": u["franchise_id"],
                "slug": None,
                "current_names": sorted(u["names"]),
                "abbreviations": sorted(u["abbreviations"]),
                "names_by_season": {},
                "seasons": [],
            })

    dump("franchises.json", {
        "schema_version": "0.1",
        "data_version": DATA_VERSION,
        "franchises": sorted(franchises, key=lambda f: f["franchise_id"]),
        "unmatched": unmatched,
    })
    dump("formats.json", {
        "schema_version": "0.1",
        "data_version": DATA_VERSION,
        "note": "赛制结构摘要：rounds 按真实赛程分组；playoffs 的具体树形在 M1 引擎阶段细化",
        "seasons": formats,
    })

    print(f"franchises mapped: {len(franchises)}")
    print(f"franchises unmatched: {len(unmatched)}")
    for u in unmatched:
        print(f"  [unmatched] {u['franchise_id']} {u['names'][:2]} {u['abbreviations'][:2]}")
    print("冠军交叉校验（smoba vs kpl）：")
    for line in final_check:
        print(line)
    print("赛制轮次类型分布：")
    type_counter: dict[str, int] = {}
    for sid, fmt in formats.items():
        for r in fmt["rounds"]:
            type_counter[r["type"]] = type_counter.get(r["type"], 0) + 1
    for t, c in sorted(type_counter.items()):
        print(f"  {t}: {c}")


if __name__ == "__main__":
    main()
