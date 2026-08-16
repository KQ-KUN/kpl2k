"""KPL 2K Cloudflare Pages 一键部署（免安装 Node/wrangler）

流程：创建 Pages 项目 -> 获取上传令牌 -> multipart 上传全部文件 -> 创建部署。
Token 依次从环境变量 CF_TOKEN、本机 %USERPROFILE%\\.kpl2k_cf_token 读取。
输出线上网址。

用法：
  $env:CF_TOKEN = "你的 API Token"
  python tools/deploy_pages.py
  或双击 tools/deploy.bat（首次会提示输入并保存 Token）
"""

from __future__ import annotations

import json
import mimetypes
import os
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
API = "https://api.cloudflare.com/client/v4"
UPLOAD = "https://upload.pages.cloudflare.com"
PROJECT = "kpl2k"


def api(method: str, url: str, token: str, body: dict | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def upload_multipart(token_jwt: str, files: list[tuple[str, bytes]]) -> dict:
    boundary = "----kpl2k" + uuid.uuid4().hex
    parts = []
    for path, content in files:
        parts.append(f"--{boundary}\r\n".encode() +
                     f'Content-Disposition: form-data; name="{path}"\r\n'.encode() +
                     b"Content-Type: application/octet-stream\r\n\r\n" + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{UPLOAD}/api/v1/accounts/{ACCOUNT}/pages/projects/{PROJECT}/upload",
        data=body,
        headers={
            "Authorization": f"Bearer {token_jwt}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


ACCOUNT = ""


def main() -> None:
    global ACCOUNT
    token = os.environ.get("CF_TOKEN", "").strip()
    if not token:
        tok_file = Path.home() / ".kpl2k_cf_token"
        if tok_file.exists():
            token = tok_file.read_text(encoding="utf-8").strip()
    if not token:
        raise SystemExit("请先设置环境变量 CF_TOKEN")

    accounts = api("GET", f"{API}/accounts", token)
    if not accounts.get("success") or not accounts["result"]:
        raise SystemExit("Token 无效或没有账户权限：" + json.dumps(accounts.get("errors"), ensure_ascii=False))
    ACCOUNT = accounts["result"][0]["id"]
    print(f"账户：{accounts['result'][0]['name']} ({ACCOUNT})")

    # 1. 创建项目（已存在则忽略）
    try:
        api("POST", f"{API}/accounts/{ACCOUNT}/pages/projects", token,
            {"name": PROJECT, "production_branch": "main"})
        print(f"项目已创建：{PROJECT}")
    except Exception as e:
        print(f"项目可能已存在：{e}")

    # 2. 获取上传令牌
    tok = api("GET", f"{API}/accounts/{ACCOUNT}/pages/projects/{PROJECT}/upload-token", token)
    jwt = tok["result"]["jwt"]

    # 3. 上传文件
    files = sorted(APP.rglob("*"))
    uploads = [(p.relative_to(APP).as_posix(), p.read_bytes()) for p in files if p.is_file()]
    print(f"上传 {len(uploads)} 个文件（{sum(len(b) for _, b in uploads) / 1024 / 1024:.1f} MB）...")
    up = upload_multipart(jwt, uploads)
    if not up.get("success"):
        raise SystemExit("上传失败：" + json.dumps(up, ensure_ascii=False)[:800])
    hashes = up["result"].get("hashes", {})
    print(f"已上传：{len(hashes)} 个文件哈希")

    # 4. 创建部署
    files_map = {("/" + k) if not k.startswith("/") else k: v for k, v in hashes.items()}
    dep = api("POST", f"{API}/accounts/{ACCOUNT}/pages/projects/{PROJECT}/deployments", token,
              {"branch": "production", "files": files_map})
    if not dep.get("success"):
        raise SystemExit("部署失败：" + json.dumps(dep.get("errors"), ensure_ascii=False)[:800])
    print("\n部署成功！线上网址：")
    print("  " + dep["result"]["url"])
    print("  " + f"https://{PROJECT}.pages.dev")


if __name__ == "__main__":
    main()
