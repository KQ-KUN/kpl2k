# 旧文件使用审计

本批不删除任何原文件。下列分类以源码引用、默认命令与实际浏览器请求为依据，不能只按文件名认定废弃。

| 对象 | 当前用途和证据 | 处理 |
| --- | --- | --- |
| app/style.css、navigation.css、budget.css、editorial.css | 旧级联历史输入；仅 styles:sync -- --from-legacy 显式读取，现行源是 app.css | 保留历史和兼容，默认不维护/不删除 |
| app/library-controls.css、subpage-theme.css | 其他历史参考页面仍可能引用；图鉴改用 library.css | 保留，逐页迁移后再审计 |
| app/assets/team_icons/*.png | 旧队徽原文件；当前 team_icons.json 路径指向新的逐字节解码 team-icons/ 内容寻址资源 | 可归档候选；删除须逐资源核验并另获授权 |
| guessing/ | 旧兼容目录，显式 test:legacy-guessing / build:legacy 仍会读取 | 默认2K生产无依赖；移除目录须另获授权 |
| portal/、tools/build_portal.mjs | 历史全站聚合，由 build:legacy 访问 | 保留，独立门户稳定迁移后再授权整理 |
| tools/rebuild_all.py、raw采集工具 | 显式数据生产工具；raw未齐或身份待核验时不得冒充完整重建 | 保留，不纳入普通 build |
| docs/DEPLOY.md、PRD.md 等历史设计和发布文档 | 原记录保留，可能描述旧全站目录与命令 | 只作历史资料，现行操作见 DEVELOPMENT |
| dist/、output/ | 构建/验证产物 | 不作为源文件提交，不自动清理未知目录 |

本次数据变化限84队徽的存储路径映射及其资源文件；人物、赛事、评分、图鉴内嵌快照保留。最终本地文件/外链/缺失图片计数以 consumption-manifest 的 resources 为准；外链来源 URL 不能直接当作实际浏览器请求数。
