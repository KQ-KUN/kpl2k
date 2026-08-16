"""KPL 2K 腾讯云 COS 一键部署

把 app/ 下静态文件上传到指定 COS 桶。需要先安装依赖并配置密钥：
  pip install cos-python-sdk-v5
  设置环境变量 COS_SECRET_ID / COS_SECRET_KEY

用法：
  python tools/deploy_cos.py --bucket kpl2k-1250000000 --region ap-shanghai
  # 可选：--prefix 子目录 / --cache 默认缓存秒数 / --no-audio 跳过音乐文件
"""

from __future__ import annotations

import argparse
import mimetypes
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"

CONTENT_TYPE = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", required=True, help="COS 桶名，如 kpl2k-1250000000")
    ap.add_argument("--region", default="ap-shanghai", help="桶地域，默认 ap-shanghai")
    ap.add_argument("--prefix", default="", help="可选：上传到桶内子目录")
    ap.add_argument("--no-audio", action="store_true", help="跳过 assets/audio（音乐单独传）")
    args = ap.parse_args()

    sid = os.environ.get("COS_SECRET_ID")
    skey = os.environ.get("COS_SECRET_KEY")
    if not sid or not skey:
        raise SystemExit("请先设置环境变量 COS_SECRET_ID / COS_SECRET_KEY")

    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ImportError:
        raise SystemExit("缺少依赖：pip install cos-python-sdk-v5")

    client = CosS3Client(CosConfig(Region=args.region, SecretId=sid, SecretKey=skey))
    cache_default = "no-cache"
    cache_assets = "max-age=31536000, immutable"

    files = [p for p in APP.rglob("*") if p.is_file()]
    if args.no_audio:
        files = [p for p in files if "assets" not in p.parts]
    total = 0
    for p in files:
        rel = p.relative_to(APP).as_posix()
        key = (args.prefix.rstrip("/") + "/" + rel).lstrip("/")
        ctype = CONTENT_TYPE.get(p.suffix.lower()) or mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        cache = cache_assets if ("assets/" in rel or rel.endswith((".js", ".css", ".json"))) else cache_default
        with p.open("rb") as f:
            client.put_object(Bucket=args.bucket, Body=f, Key=key, ContentType=ctype, CacheControl=cache)
        size = p.stat().st_size
        total += size
        print(f"  {rel} ({size/1024:.0f} KB)")
    print(f"完成：{len(files)} 个文件，共 {total/1024/1024:.1f} MB -> cos://{args.bucket}/{args.prefix}")


if __name__ == "__main__":
    main()
