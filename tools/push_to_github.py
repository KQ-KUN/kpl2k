"""KPL 2K -> GitHub 增量发布（走 API，绕过被限的 github.com 直连）

1. 自动 git add -A + commit（如无 --no-commit）
2. 对比本地 HEAD 与远端 main 的 tree，只上传变更/新增的 blob
3. 组装 tree/commit，PATCH 到 main

Token 从环境变量 GH_TOKEN 读取（不落盘）。

用法：
  $env:GH_TOKEN = "ghp_xxx"
  python tools/push_to_github.py -m "修复切队bug"
  python tools/push_to_github.py --no-commit -m "用已提交的内容发布"
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "KQ-KUN/kpl2k"
API = f"https://api.github.com/repos/{REPO}/git"
CKPT = ROOT / "tmp" / "gh_blobs.json"


def git(args: list[str]) -> bytes:
    r = subprocess.run(["git"] + args, cwd=ROOT, capture_output=True)
    if r.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} 失败: {r.stderr.decode(errors='ignore')[-300:]}")
    return r.stdout


def call(method: str, url: str, token: str, body: dict | None = None, tries: int = 6) -> dict:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            raise SystemExit(f"API {method} {url} -> {e.code}: {msg}")
        except Exception as e:
            last = e
            time.sleep(2 + i * 2)
    raise SystemExit(f"API {method} {url} 重试 {tries} 次仍失败: {last}")


def local_tree() -> dict[str, dict]:
    """HEAD 的 tree：path -> {mode, sha, type}"""
    out = git(["ls-tree", "-r", "-z", "HEAD"])
    tree: dict[str, dict] = {}
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, path = rec.split(b"\t", 1)
        mode, typ, sha = meta.split(b" ")
        tree[path.decode("utf-8")] = {"mode": mode.decode(), "sha": sha.decode(), "type": typ.decode()}
    return tree


def remote_head(token: str) -> tuple[str | None, dict[str, str]]:
    try:
        ref = call("GET", f"https://api.github.com/repos/{REPO}/git/ref/heads/main", token)
        head = ref["object"]["sha"]
        tree = call("GET", f"{API}/trees/{head}?recursive=1", token)
        remote = {}
        for item in tree.get("tree", []):
            if item["type"] == "blob":
                remote[item["path"]] = item["sha"]
        return head, remote
    except SystemExit:
        return None, {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-m", "--message", default="update", help="提交信息")
    ap.add_argument("--no-commit", action="store_true", help="不自动 git commit，直接发布已提交内容")
    args = ap.parse_args()

    token = os.environ.get("GH_TOKEN", "").strip()
    if not token:
        raise SystemExit("请设置环境变量 GH_TOKEN")

    if not args.no_commit:
        changed = git(["status", "--porcelain"]).decode("utf-8", errors="ignore").strip()
        if changed:
            git(["add", "-A"])
            git(["commit", "-m", args.message])
            print(f"已提交：{args.message}")
        else:
            print("无本地改动")

    local = local_tree()
    head, remote = remote_head(token)
    diff = [p for p, info in local.items() if remote.get(p) != info["sha"]]
    print(f"本地 {len(local)} 个文件，远端 {len(remote)}，需上传 {len(diff)}")

    ckpt: dict[str, str] = {}
    if CKPT.exists():
        ckpt = json.loads(CKPT.read_text(encoding="utf-8"))
    for i, rel in enumerate(diff, start=1):
        if rel in ckpt:
            continue
        content = base64.b64encode(git(["cat-file", "blob", local[rel]["sha"]])).decode()
        sha = call("POST", f"{API}/blobs", token, {"content": content, "encoding": "base64"})["sha"]
        ckpt[rel] = sha
        CKPT.write_text(json.dumps(ckpt), encoding="utf-8")
        if i % 20 == 0 or i == len(diff):
            print(f"  blob {i}/{len(diff)}")
    CKPT.unlink(missing_ok=True)

    tree_items = [{"path": p, "mode": info["mode"], "type": info["type"], "sha": info["sha"]} for p, info in local.items()]
    tree_sha = call("POST", f"{API}/trees", token, {"tree": tree_items})["sha"]
    commit = call("POST", f"{API}/commits", token, {
        "message": args.message,
        "tree": tree_sha,
        "parents": [head] if head else [],
    })
    if head:
        call("PATCH", f"https://api.github.com/repos/{REPO}/git/refs/heads/main", token,
             {"sha": commit["sha"], "force": True})
    else:
        call("POST", f"https://api.github.com/repos/{REPO}/git/refs", token,
             {"ref": "refs/heads/main", "sha": commit["sha"]})
    print(f"已发布 https://github.com/{REPO} main @ {commit['sha'][:8]}（Cloudflare 将自动部署）")


if __name__ == "__main__":
    main()
