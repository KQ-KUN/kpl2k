"""KPL 2K 音乐压缩 v1

把 app/assets/audio/*.m4a 压成低码率副本（BGM 场景 96kbps 足够），
原文件先备份到 backup_audio/（不入部署包），再覆盖 app 内的同名文件。
代码里的文件名/路径不变，只是体积缩小约 75%。

用法：
  python tools/compress_audio.py            # 默认 96k
  python tools/compress_audio.py --bitrate 64k
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "app" / "assets" / "audio"
BAK = ROOT / "backup_audio"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bitrate", default="96k", help="AAC 码率，默认 96k")
    args = ap.parse_args()

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    files = sorted(SRC.glob("*.m4a"))
    if not files:
        raise SystemExit("app/assets/audio 下没有 m4a 文件")

    BAK.mkdir(exist_ok=True)
    total_before = total_after = 0
    for p in files:
        bak = BAK / p.name
        if not bak.exists():
            shutil.copy2(p, bak)
        before = p.stat().st_size
        tmp = p.with_suffix(".tmp.m4a")
        cmd = [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(p), "-c:a", "aac", "-b:a", args.bitrate, "-ar", "44100",
            str(tmp),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  [FAIL] {p.name}: {r.stderr[-300:]}")
            continue
        tmp.replace(p)
        after = p.stat().st_size
        total_before += before
        total_after += after
        print(f"  {p.name}: {before/1024:.0f} KB -> {after/1024:.0f} KB ({after/before*100:.0f}%)")

    print(f"\n完成：{len(files)} 首，共 {total_before/1024/1024:.1f} MB -> {total_after/1024/1024:.1f} MB")
    print(f"原文件备份在 {BAK}（不参与部署，可随时恢复）")


if __name__ == "__main__":
    main()
