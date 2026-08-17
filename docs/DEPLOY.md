# KPL 2K 部署指南（腾讯云 COS + CDN）

## 原理

产品是纯静态站：`app/` 下所有文件（HTML/JS/CSS/数据分片/音乐）上传到 COS 桶，再用 CDN 加速域名对外提供网址。手机浏览器直接打开网址即可玩，无需后端。

## 一次性准备

### 1. 开通 COS

1. 打开腾讯云控制台 → 对象存储 COS → 创建存储桶：
   - 名称：`kpl2k-125xxxxxxx`（后缀是账号 APPID，控制台会自动带）
   - 地域：选 `上海`（离目标玩家近即可）
   - 访问权限：**公有读私有写**（页面要公开访问，写入只走你的密钥）
2. 桶创建后，在"基础配置 → 静态网站"里开启**静态网站**，索引文档填 `index.html`。

### 2. 获取访问密钥（SecretId / SecretKey）

腾讯云控制台 → 访问管理 CAM → API 密钥管理 → 新建密钥，记录 SecretId / SecretKey。

> 安全提示：密钥只在你自己的电脑上使用，不要提交进代码仓库，不要发给别人。

### 3. 安装部署依赖（本机一次）

```bash
pip install cos-python-sdk-v5
```

## 上传

```powershell
$env:COS_SECRET_ID = "你的 SecretId"
$env:COS_SECRET_KEY = "你的 SecretKey"
python tools/deploy_cos.py --bucket kpl2k-125xxxxxxx --region ap-shanghai
```

上传完成会打印文件清单与总量。

## 开启 CDN 得到网址

> ⚠️ 2024 年 1 月后创建的 COS 桶，默认域名（含静态网站域名）访问任意文件都会强制下载（`x-cos-force-download: true`），**必须绑定自定义域名才能正常预览**；自定义域名接入 COS 要求该域名已完成 ICP 备案。因此正式上线前需要：买域名 → 备案（个人约 7–20 天）→ 绑定 COS。

1. 腾讯云控制台 → CDN 内容分发网络 → 域名管理 → 添加域名：
   - 加速域名：你拥有的一个已备案域名（如 `kpl2k.example.com`）。
   - 源站：选择刚才的 COS 桶。
2. 解析 CNAME 到 CDN 分配的地址，等生效（几分钟）。
3. 打开 `https://你的域名/index.html` 即上线。

也可以跳过 CDN：在 COS 控制台"域名管理 → 自定义源站域名"里直接绑定已备案域名（选"静态网站源站"），DNS 解析到桶域名即可。

> 备案过渡期（可选）：腾讯云开发 CloudBase 静态托管提供免备案默认域名（`*.tcloudbaseapp.com`，国内可访问，但会先跳转"开发测试提示页"且有限流），适合备案期间先让玩家玩上；正式传播仍建议等备案后走 COS 自定义域名。

## 更新数据

新赛季/数据修正后：

```bash
python tools/rebuild_all.py    # 全量重建 processed 数据
python tools/build_web.py      # 切成 web 分片
python tools/deploy_cos.py --bucket kpl2k-125xxxxxxx --region ap-shanghai
```

CDN 缓存：数据/JS 文件已带 `max-age=31536000`（长缓存）。更新后如需立刻生效，可在 CDN 控制台"刷新预热"里刷新 `index.html`、`data/` 前缀。

## 体积

- 首屏：`base.json` + `manifest.json` ≈ 150 KB（gzip 后更小），秒开。
- 按需：选队时拉 `teams/{队}.json`，模拟时拉 `seasons/{赛季}.json`（每份 70–90 KB）。
- 音乐：约 57 MB 但只按需加载当前一首，不阻塞页面。
