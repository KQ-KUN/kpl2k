"""Serve the built site locally without browser caching."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve dist/ with caching disabled")
    parser.add_argument("--port", type=int, default=4180)
    args = parser.parse_args()
    if not DIST.is_dir():
        raise SystemExit("dist/ 不存在，请先运行 npm.cmd run build")
    handler = partial(NoCacheHandler, directory=str(DIST))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"KPL 本地站点：http://127.0.0.1:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
