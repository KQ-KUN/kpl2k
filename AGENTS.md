# KPL 2K 当前工作约定

- `app/` 是 2K 运行时，`data/` 是 canonical 数据；保留字符串 player_id，`@franchise_id` 仅是展示卡。未知、null、空串和 0 不合并。不能按昵称合并人物。
- UI 遵守平台 `../kplgame/docs/UI_STANDARD.md` 的 Editorial / Sports Magazine。验证浅深主题、移动端、键盘、弹窗焦点、底栏与 reduced-motion。
- 当前 `npm test` 和 `npm run build` 独立于旧 `guessing/`。`build:legacy` 与 `test:legacy-guessing` 是显式兼容入口，不作为当前 2K 交付依据。
- `app/js/ui.js` 只协调状态与一次性入口绑定。路由、存储、阵容、模拟播放、分享、成就与弹窗在 `app/js/ui/`；模块仅通过注入契约访问会话，不互相 import，不在脚本加载时安装监听器。
- 当前样式源为 `app/app.css` 与 `app/library.css`，直接维护组件规则和既有主题 tokens。旧4层只作历史兼容；`styles:sync` 默认只提示，显式 `--from-legacy` 才会覆盖 app.css。不能凭静态 HTML 搜索删除动态规则。
- 图鉴数据内嵌快照与生成器保持一致，视图由 `app/js/library.js` 渲染。新增功能不重算既有事实；人数按 base ID，年度 DOM 在展开时创建。
- 消费快照契约是 `app/data/consumption-manifest.json`。修改后显式 `npm run snapshot:sync`，build 仅核验最终资源后复制，禁止自动刷新 hash 掩盖变化。
- 头像只读 canonical 缓存，外部输入必须显式给 source/assets；不从兼容 Guessing 目录隐式取数据。未知映射待核验。
- 不删除旧文件。审计、可归档与需要授权删除的对象记录在 `docs/LEGACY_AUDIT.md`。不覆盖无关改动；提交、推送与部署遵循用户当次授权。
