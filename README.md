# KPL 2K

2K 游戏运行时在 `app/`，canonical 数据在 `data/`。门户与独立游戏由各自仓库维护。当前正式构建只验证并复制已生成的 2K 快照，不读取兼容 `guessing/`、不抓取数据。

Node.js 24 与 Python 3.10+。核心验证不需要安装第三方 Python 包。

```powershell
npm test
npm run build
```

修改运行时代码或显式维护数据后，先验证，再运行 `npm run snapshot:sync` 记录实际来源及最终文件 hash。该命令不会在 build 中自动执行。现行样式直接维护 `app/app.css` 与 `app/library.css`；旧覆盖层保留历史，`styles:sync` 默认不写文件，显式 `--from-legacy` 才会覆盖现行样式。

完整交互验证 `npm run test:browser` 使用本机 Edge 与 Playwright，拦截外域与统计；运行环境、原始计时与通过边界写入验证报告。

详见 [开发与数据维护](docs/DEVELOPMENT.md)、[旧文件审计](docs/LEGACY_AUDIT.md)。`docs/DEPLOY.md`、`docs/PRD.md` 等旧文档保留为历史参考，现行操作以本说明为准。没有本批授权时不要提交、推送或部署。
