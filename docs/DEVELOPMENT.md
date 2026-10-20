# 2K 开发与维护

## 最短验收

```powershell
npm test
npm run build
```

`validate` 等同 `snapshot:check`，只在无需 build 的单独快照核验时使用；它只核验消费快照，`test` 只跑逻辑回归；`build` 包含最终快照核验，不重复运行单元测试。默认 npm 安装已解除 workspace，对旧 Guessing 的命令使用显式 `--prefix guessing`。

`npm test` 覆盖身份、阵容/引擎、每日挑战、历史脚本、过期请求、存储、模拟播放、分享编解码与加载失败恢复。默认不运行兼容 Guessing。

`npm run test:browser` 要求 Playwright 与本机 Edge。可用本地 `playwright` 包，或显式设置 `KPL_PLAYWRIGHT_PATH` 为外部 Playwright 模块目录；`KPL_BROWSER_CHANNEL` 默认 `msedge`。脚本使用 strict-404/MIME 本地服务并阻断产品统计和外域请求。覆盖故障重试、完整模拟/战绩卡/分享还原、图鉴深链、键盘、320/390/768/1366 浅深主题；headless 通过不代表物理手机、音频实际听感或生产部署。

## 显式维护

```powershell
npm ci --workspaces=false
# 直接编辑 app/app.css 或 app/library.css；无需生成
npm run data:icons
npm run snapshot:sync
```

当前组件样式直接维护 `app/app.css` 和 `app/library.css`，颜色、字体、分隔线、焦点沿用既有 CSS tokens。旧4层保留历史用途；`npm run styles:sync` 默认不写文件。仅在有意从旧级联重新迁移时使用 `npm run styles:sync -- --from-legacy`，这会覆盖当前 app.css，必须先保存工作并重新验收。迁移器只删除同一 media 条件、同一选择器已被后续规则确定覆盖的声明，保留动态选择器与优先级。剩余 69 个 !important 主要维护 Editorial 对旧控件、浅深主题以及 reduced-motion 的优先级，本轮不以删数字改变这些行为。

`data:icons` 将现有核验 PNG dataURI 逐字节导出为内容寻址图片，或验证现有本地路径，不下载或重画队徽。

默认头像同步只读 `data/processed/player_icon_cache.json` 及 canonical player_library 的有效本地路径。外部缓存导入显式执行 `python tools/player_icons.py --source <library.json> --assets <目录>`；冲突文件名拒绝覆盖。`build_player_library.py` 和 `build_web.py` 不再依赖 `guessing/`。

事实修改应进入现有 curated/overrides，保留来源和待核验；有真实 raw 时才讨论全量重建。`build_attribution.py --output <候选.json> --report <差异.json>` 默认产出审阅候选，canonical 写入有独立门禁。本批没有全量 raw 重建。

## 消费快照契约

manifest 记录真实来源 commit、每项输入与最终输出 hash/大小、UTC 时间、生成器脚本 hash、覆盖与排除规则、ID/单位/null 语义及本地/外链图像审计。`sourceCommit` 标记真实仓库祖先，精确工作副本输入以文件 hash 为准；不宣称追溯了未取得的 raw 原始来源。输出在图片路径改写后计算，manifest 自身不入 outputs。`snapshot:check` 会拒绝缺失、过期或额外运行文件。

`npm run build` 只验证现有 manifest 并复制 `app/` 到 `dist/kpl2k/`，不会生成数据、修改注册表或发布。兼容全站聚合入口保留为 `build:legacy`，当前发布聚合由独立 kplgame 仓库处理。
