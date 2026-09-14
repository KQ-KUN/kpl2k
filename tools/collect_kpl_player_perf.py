"""缓存新版 KPL 官网选手表现表；不覆盖已有战力与生涯统计。"""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from probe_kpl_sources import probe

ROOT = Path(__file__).resolve().parents[1]
API = "https://kplshop-op.timi-esports.qq.com/kplow/"


def main():
    catalog = probe(("catalog", API + "getSeasonAndStageAndTeamList", {}))
    payload = catalog.get("response", {}).get("data", {})
    print(json.dumps({"catalogKeys": list(payload)}, ensure_ascii=True))
    seasons = payload.get("seasons", [])
    if not seasons:
        raise RuntimeError("官网赛季目录为空，停止采集")
    specs = [(str(s["seasonid"]), API + "getSeasonPlayerPerf", {"seasonid": s["seasonid"]}) for s in seasons]
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(probe, specs))
    doc = {"checkedAt": datetime.now(timezone.utc).isoformat(), "catalog": catalog, "seasons": results}
    path = ROOT / "data/raw/kplow/player_perf.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    for result in results:
        print(json.dumps({k: v for k, v in result.items() if k != "response"}, ensure_ascii=True))


if __name__ == "__main__":
    main()
