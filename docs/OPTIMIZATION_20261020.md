# 2K 第二、三批本地验收（2026-10-20）

起始来源 commit `6fc57da32f911f65a595ad3b7ddaea877ee4114f`。本批在独立 checkout 实现；不推送、不部署，不改生产注册表。原目录与历史素材保留。

## 下载与渲染

Windows、Microsoft Edge headless、Playwright 1.62.1、390×844、reduced-motion、localhost HTTP 无压缩无节流、新浏览器 context。每页单次观察，不能解释为生产网络性能或稳定统计分布。HTTP字节为浏览器 request.sizes 的响应头与编码响应体之和，不含TCP/TLS；load 为 Navigation Timing loadEventEnd，另行记录的 elapsed 含 networkidle 等待，不当作首次加载时间。

| 页面 | 请求数 | 实测HTTP响应字节 | DOM元素 | load ms |
| --- | ---: | ---: | ---: | ---: |
| index.html | 19 → 23 | 1,261,315 → 636,183 | 546 → 550 | 303.4 → 195.2 |
| player_library.html | 453 → 12 | 2,757,752 → 950,017 | 23,052 → 887 | 1751.7 → 125.5 |

文件体积单独统计：app目录 44,073,071 → 44,248,745 B，918 → 1014 文件。体积增加来自保留旧文件、外置队徽、新模块与审计manifest；不将首屏下载下降声称为发布包整体变小。

84支队徽：原映射638,006B → 4,850B；导出图片合计476,295B，与每个原data URI解码逐字节一致，自有资源不依赖其他游戏。故障回退保留。图鉴人数448位基础ID，保留701张战队卡、1,235个年度版本；初始36卡、0份年度详情，展开才创建详情；搜索预计算，深链接可扩展批次并自动展开/聚焦。

## 结构与样式

主入口 152,160 → 55,196 B，7个职责模块另计 113,673 B，总计 168,869 B；拆分不代表代码下载体积下降。路由、存储、阵容、播放、分享、成就、弹窗通过注入契约读同一入口状态，不相互import，不在加载时绑定监听器。首屏请求19→23的取舍已包含在上表。

| 当前维护源 | CSS字节前→后 | 声明前→后 | 同作用域同选择器同属性重复对前→后 | !important前→后 |
| --- | ---: | ---: | ---: | ---: |
| app.css（原4层） | 76,221 → 69,227 | 2,673 → 2,525 | 162 → 12 | 70 → 69 |
| library.css（原内联及外链） | 26,478 → 23,306 | 800 → 718 | 88 → 16 | 63 → 63 |

重复对允许因级联出现，不能据此自动删除。现行只维护app.css/library.css，保留既有主题、字体、颜色、边框和焦点tokens。剩余!important维持Editorial对历史选择器的优先级与reduced-motion，并未强行删除。原4层、历史页面及原图均保留；styles:sync默认不写文件，只有--from-legacy显式覆盖。图鉴生成模板已同步主题按钮/脚本、单一样式与library.js，避免重新生成恢复旧UI。

## 数据与质量

canonical数据事实修改0；图鉴内嵌JSON与起始版本深度相等。新增消费manifest与结构质量报告，旧固定日期字段标记为历史元数据；显式生成器改用真实内容hash，build仅验证既有快照并复制，不自动同步。manifest记录完整sourceCommit、35项输入、1,013项最终输出、UTC时间、生成器SHA、覆盖/排除/ID/null/单位语义；输出在路径改写完成后计算。sourceCommit表示实际本地来源祖先，未宣称完整raw来源链。

质量报告覆盖747人、84队、32季、3,290条赛季记录。规范ID重复0、缺失记录引用0；保留7组同名人物、25组同赛季历史队名冲突待核验。744个人物真实姓名为空；图鉴卡中627张出道年未知、549张冠军数未知（卡数不是人数）。这些均不靠猜测补齐。完整raw缺失，全量原始重建未完成。

## 实际验证

- npm test：Python12项（含身份归属、无旧头像依赖、Link快照），Node15项（请求合并/失败重试/加载门禁/存储/播放/分享）；引擎29季×3种子、预算策略100种子、10每日挑战/140故事、历史脚本与身份回归通过。
- 本地Edge：7/7加载失败恢复；10/10图鉴键盘/深链、完整模拟、战绩卡、分享链接还原、历史/刷新与8组布局；main和library各8/8浅深主题计算样式对比通过。统计转发0。人工查看390px深色弹窗截图，未见横向溢出。
- 不带guessing目录的隔离副本：npm ci --offline --ignore-scripts、npm test、build、头像同步、图鉴/分片生成、显式manifest与再次build通过。最终模板专项验证也通过。默认workspace已解除；旧链保留显式--prefix guessing入口。
- Git索引与工作区1,049项hash一致，git archive导出后消费快照校验通过。app/data/生成器字节由.gitattributes固定，避免Windows换行破坏hash。

原始证据在相邻verification/kpl2k：before-final.json、after-final.json、structure-metrics.json、journeys.json、style-parity.json、library-style-parity.json、isolated-production*.json、index-hash-check.json；加载故障报告在本仓库output/first-batch-fixes-20261018/2k-browser.json。历史失败截图保留，现行结果以报告最后通过记录为准。

尚未执行：物理手机、真实音频听感、正式CI、生产站与大陆网络验收。没有删除授权，旧Guessing目录、旧队徽、兼容聚合及CloudBase链全部保留；具体清理候选见LEGACY_AUDIT。发布前须重新聚合、校验实际注册版本并走既有发布恢复协议。
