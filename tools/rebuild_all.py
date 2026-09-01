"""KPL 2K 数据一键重建

按依赖顺序执行：赛程审计 → 归属构建 → 清洗评分 → 关联表 → 选手库 → Web 分片 → 验证

用法：
  python tools/rebuild_all.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PY = ROOT.parent / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
PY = str(VENV_PY) if VENV_PY.exists() else sys.executable

STEPS = [
    ("audit_schedule.py", "赛程审计"),
    ("build_attribution.py", "归属构建"),
    ("build_pair_win.py", "组合胜率"),
    ("clean_kpl.py", "清洗+评分"),
    ("build_kpl_maps.py", "改名映射+赛制"),
    ("build_historical_archive.py", "2016—2018 历史档案"),
    ("build_player_library.py", "选手库"),
    ("validate_ratings.py", "评分验证"),
    ("build_team_icons.py", "战队头像"),
    ("build_web.py", "Web 分片"),
    ("validate_player_versions.py", "历史位置+现役战力验证"),
]


def main() -> None:
    for script, label in STEPS:
        print(f"\n===== {label}（{script}）=====")
        r = subprocess.run([PY, str(ROOT / script)], cwd=ROOT.parent)
        if r.returncode != 0:
            print(f"[FAIL] {script} 退出码 {r.returncode}")
            sys.exit(1)
    print("\n全部完成")


if __name__ == "__main__":
    main()
