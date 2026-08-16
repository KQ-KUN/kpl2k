# KPL 2K 项目记忆

## 参赛（2026-08-16）
- 已决定参加 B 站 build in bilibili·AI创造公开赛，目的不是获奖（粉丝 0），是借截止日期把产品收口上线并留创作记录。投稿截止 2026-08-20 23:59:59。
- 投稿硬要求：横屏 ≥1 分钟、话题 #B站AI创造公开赛、标题末尾【B站AI创造公开赛】、同产品视频建合集、从官方活动页点"立即投稿"；评选按合集投币前 10 入围。冲奖需获奖后 B 站独家（其他平台下架），不冲奖可忽略，但视频内保留"粉丝自制非官方"声明。
- 参赛视频脚本与制作步骤：`docs/contest_video_script.md`（已过 human-writing 检查脚本，禁用项 0）。

## 定位
战队经理式 KPL 赛季模拟网页游戏（手机优先、无后端、静态包 + COS/CDN）。抽象层级=比赛，不做局内操作/BP/账号/排行榜。数据范围 2019 起。

## 数据管线
- 源：kpl.qq.com（赛程/战队）+ prod.comp.smoba.qq.com（选手/逐局 MVP）。
- 一键重建 `python tools/rebuild_all.py`：审计→归属→组合胜率→清洗评分→映射→选手库→校验。
- formats.json 由 build_kpl_maps.py 生成，勿手改；改赛制改脚本。
- **坑**：淘汰轮常被命名"常规赛第X轮"（BO≥7），`fix_tournament_rounds()` 纠正；kpl 队 id 是 slug（`KPL2024S1_ag`），须 `remap_kpl_ids()` 映射回俱乐部 id。
- **坑**：smoba 榜单 team_id=当前队而非当季队，历史赛季会被污染；battle 未覆盖的赛季在 `data/overrides/player_versions.json` 的 teams 手工修正（已修 2022 夏小胖/冰尘/笑影）。
- KPL2026S2 已全量爬取，`clean_kpl.py` 里 `FORCE_BATTLEFIELD` 强制其为战场（status=1 但赛程齐）。

## 引擎规则
- 强度 = 50 + (首发均分 + 位置覆盖 + 老搭档 + 组合胜率化学 + 风格 - 50) × 0.6；组合胜率化学来自 `build_pair_win.py`（真实逐局胜率偏离 50%）。
- 系列赛胜率 = sigmoid(强度差)，加 ±4 噪声；K=0.1。
- **淘汰树是动态的**：参赛名单取首轮官方对阵种子顺序，晋级由模拟结果决定，不遍历后续官方固定对阵。单败逐轮淘汰，双败=标准胜者/败者组，总决赛败者组冠军需连赢两场。无战力数据的外卡队按 50 参赛。
- **常规赛排名只做剧情、不改对位**：sim_engine 常规赛轮累计胜场/净胜局生成联盟排名，季后赛仍用官方首轮种子顺序配对；排名驱动"常规赛收官+首轮签位"文本（templates: regular_recap / seed_lines，KCC 无常规赛不出）。用户明确：不要按排名重排对阵。
- 黑称红线：攻击长相身高/疾病侮辱/假赛指控/低俗擦边一律不进库。
- 冠军判定：叙事层比"显示名"，主流程须 champion id 转显示名再传 ctx。

## 评分（v3，代码即规则）
- 分赛季 z-score 标准化（减中位数÷IQR）→ 全历史同位置 z 池百分位 → 分路权重加权 → 出场对数折扣（5场≈0.59，20场≈1.0）→ 50+49×score。
- 小样本：≥5 场即可评分（传奇例 4 场），池子只用 ≥10 场。
- 年度版本只统计正式战场赛季（排除季前/选拔），取当年峰值。
- 球星卡：按选手×战队拆卡（ACTIVE_2026 白名单 20 队），版本按年合并；非现役标"现役：xx/退役"；分路核心指标展示。

## 叙事
- 文件：player_flavor（66 人彩蛋）、team_flavor（外号）、templates、rivalry_flavor（9 组恩怨局，55% 触发）。
- 已删：弹幕玩法（统一"评论区"）、土狗/王八/棺材/勾兑/紧崽（改 32/懦崽）、假赛类。
- AG 偷家彩蛋：`steal_lines`，AG 胜局 12% 触发"请神梦老师"。

## BGM
- `app/bgm.js`：intro（首页一首）/ battle（多首按名选曲，nextTrack/prevTrack 记住选择）/ champion（按队 byTeam，缺省回退"无双的王者"）。
- 音源 `app/assets/audio/*.m4a`（首页.m4a、云梦谣.m4a、各队小孩.m4a、无双的王者.m4a）；移动端首次点击 `BGM.unlock()`。文档 docs/BGM.md，测试页 app/bgm_demo.html。

## 战绩卡
- 每次 story 模拟生成 `app/result_card.html`：结果横幅（冠军/亚军/止步·N强）、阵容卡（头像/KDA/参团/MVP）、赛程表、选手数据表；小数统一 1 位，可截图传播。

## Web 前端（2026-08-16 起）
- **纯前端 SPA**：`app/index.html` + `js/{engine,narrative,data,ui,bgm}.js`，hash 路由：`#/` 首页、`#/team` 组队、`#/season` 战场、`#/sim` 模拟、`#/result` 结算；分享链接 `#/s?t=&s=&r=pid@sid,...&seed=` 可还原阵容与结果。
- **引擎 JS 化**：engine.js 与 tools/sim_engine.py 对齐（常规赛排名→官方种子剧情→动态淘汰树），mulberry32 种子可复现；narrative.js 对应 narrative.py。另含 `createSession()` 分阶段模拟：每场/每轮可暂停，轮间换人（setRoster 更新强度，rng 状态延续，已赛内容不变）。
- **数据分片**：`tools/build_web.py` 生成 `app/data/`：base.json（franchise/选手/叙事/覆盖，137KB）+ manifest.json + seasons/{sid}.json（赛制+当季选手+pair_win）+ teams/{fid}.json（队卡版本，版本补代表 season_id）。已并入 rebuild_all.py。
- **26 现役首发**：组队预设取 KPL2026S2 的 pickStarter（位置补全后即"一诺+钟意+长生+大帅+轩染"），缺失队回退 KPL2026S1；版本选择来自队卡 versions。
- **BGM 场景**：intro=首页.m4a；battle=王者冰刃等 5 首（默认王者冰刃，可切）；champion=byTeam 小孩战歌（AG 红小孩/狼 狼小孩/eStar 星小孩/TTG TT小孩/KSG KSG小孩/Hero HERO小孩/DYG DYG小孩/TES 陀螺小孩），缺省无双的王者。
- **部署**：已上线 Cloudflare Pages `https://kpl2k.pages.dev`（项目名 kpl2k，API Token 经 `tools/deploy_pages.py` 上传，Token 存 `%USERPROFILE%\.kpl2k_cf_token`）。一键更新：双击 `tools/deploy.bat`（需本机 Python 3，先 build_web 再上传）。注意：Codex 沙箱网络连不上 upload.pages.cloudflare.com，部署须在用户本机执行。`tools/deploy_cos.py` 为腾讯云 COS 备选。
- **线上托管（当前）**：Cloudflare Workers 项目 `kpl2k.hkq2297409816.workers.dev`，已连接 GitHub 仓库 `KQ-KUN/kpl2k` 自动部署（Workers Builds，轮询模式）。发布命令：`python tools/push_to_github.py -m "说明"`（增量上传变更文件，GitHub API 直传绕过沙箱网络限制）。Cloudflare 检测到 main 更新后 1-2 分钟自动部署。
- **音乐压缩**：`tools/compress_audio.py` 压到 96kbps（app/assets/audio 约 27.6MB，原文件备份在 backup_audio/，不部署）。
- **UI 反馈已修**（2026-08-16）：切队重置首发、桌面/大屏加宽（720/860px）、球星卡两列、轮间换人（每场后"更换阵容/继续征战"、逐局 700ms 慢速 reveal + 跳过）、战绩卡头像 32px。
- **王朝预设**（2026-08-16）：build_web 生成王朝阵容时只从"存在赛程分片的赛季"里选人，修复 19QG/19eStar 引用 L20200002（无分片）导致点击无反应；描述校对：24-25AG=九连决赛·六连冠、22eStar=六连决赛五夺冠、19QG=2019 冬冠、25狼队=2025 年总亚军（鸟巢憾负 AG，春冠/挑杯均为 AG/WB）；切普通队时清空 STATE.dynasty 并重渲染王朝条（金色边框随取消选中）。
- **引擎与战场页修复**（2026-08-16）：① 战场页点击赛季项不再整体重渲 showPage（去掉滚动到顶）；② 跨时空外卡机制——玩家队不在该赛季淘汰赛名单时，顶替首轮最弱队并对阵剩余最弱对手，先弹"外卡登场"卡片（engine.js 两处：simulateSeason + createSession）；③ 单/双败判定改为跟随 `playoff_config.type`（此前所有 playoffs/final 一律按双败，导致世冠/挑杯出现胜者组败者组）；④ 修复 `pairEntries` 用 `pair.bo` 取数组第三位（应为 `pair[2]`），双败每场此前都是 0:0 无局内文本。
- **多选手高光**（2026-08-16）：`gameNarration` 从"每局单选手循环"改为每局随机取 2-3 名高光——中期一/中期二各一名胜方选手（尽量不重复）、AG 偷家彩蛋与梗句（含双 {player} 梗）再随机补人；开局模板新增 5 条带 {player_a}/{player_b} 的选手句（templates.json 源 + build_web 重建 base.json）。实测 45 局：2 名高光 26 局、3 名以上 13 局、仅 6 局单选手。
- **免责声明 + BO9 决赛**（2026-08-16）：① 启动全屏免责声明遮罩（index.html 中 #disclaimer 文案可直接改），同意后存 localStorage（kpl2k_disclaimer_v1）不再弹，页脚"免责声明"可重看，拒绝则提示并保持遮罩；② 修复双败总决赛 entries 为对象非数组导致决赛在 UI 被静默跳过——现正常展示，2026 挑战者杯决赛按 BO9（5 胜）打出（实测 3:5/5:4/5:2 等）。
- **战绩卡=本次征战数据**（2026-08-16）：engine 新增 `simMatchStats`——每场按分路权重掷 10 名选手逐局 k/d/a + 每局 MVP（胜方，随机扰动让游走/对抗路也有机会），随 entry.stats 存进赛程；finishSim 汇总 runStats（场次/击杀/死亡/助攻/MVP/参团/胜率），战绩卡与分享图改用 runStats（场次全员一致），输出/承伤/分均经济/伤害转化/场均推塔仍用选手场均（未模拟微观数据）。
- **UI 四项**（2026-08-16）：① 免责声明补"数据收录 2019 年至 2026 年 8 月前"；② 球星卡页筛选（全部战队/全部位置/排序）单行排列，标题右上角"战力规则"弹窗（分路权重+出场折扣说明）；③ 模拟页"跳过本局"改为"直接看结果"（skipAll 快进全程并直跳 #/result，赛程/选手数据完整）；④ 修复"继续征战"不跳转——SIM.jump 不再被无赛事轮次/常规赛收官消耗，滚动改用 setTimeout（rAF 在部分环境不触发）。
- **文本规则 + 历史记录 + 末局自动跳**（2026-08-16）：① gameNarration 按"是否系列赛末局"过滤措辞——末局禁"目前比分/比分来到/拖进巅峰对决/偷家终结"、中间局禁"终结比赛/让二追三/让三追三"；② "打野的尽头是一片海"仅在花海参赛时出现；③ 外卡卡片新增第二行小字"注：在原时间线中，该战队未进入XX，故以外卡身份参赛"；④ 首页新增"历史战绩"（localStorage kpl2k_history_v1，最多 20 条，含精简 lastRun，点击还原战绩页）；⑤ 赛季末局打完自动跳 #/result（session.isDone/getChampion，单败冠军在最后一轮即时判定）；⑥ reveal 期间隐藏"继续征战/更换阵容"防误点。
- **一键跳转 + 表格对齐 + 分享链接**（2026-08-16）：① 模拟页按钮改为"一键跳转"，点击弹确认窗"是否直接查看比赛结果？"（确认才 skipAll 直跳 #/result）；② 战绩表 `.stats-table th:first-child` 左对齐，与姓名列对齐；③ shareLink 改用 `location.href.split('#')[0]` 取基址（保留 query），手机视口实测分享链接适配正常（390px 视口 docW=390）。
- **历史战绩改为独立页**（2026-08-16）：首页只显示"📜 历史战绩"入口按钮（带条数），点击进入 `#/history` 独立页——列表含战队/赛季/结果/阵容/时间，点击还原战绩，右上角清空，空状态提示；清空后首页入口自动隐藏。
- **球星卡默认狼队 + 战场年份手风琴**（2026-08-16）：① player_library.html 下拉"重庆狼队"置顶且默认选中（进入即见狼队卡）；② `#/season` 改为年份手风琴——初始只显示年份行，点击展开该年比赛、一次只开一个（手风琴），已选赛季所在年份自动保持展开。
- **战力一致性 + 手风琴保持 + 空阵容崩溃**（2026-08-16）：① 默认首发改为按"2026 年版本"拼 5 位置（槽位战力=版本战力，如信 2026=90 而非 S2 赛季评分 80），slotInfo 版本匹配支持按年份回退（兼容旧状态）；② 手风琴"已选赛季年份"比较改为字符串（此前数字 vs 字符串恒 false，选完即收起）；③ simMatchStats 的 dist 对空阵容返回空对象——KCC2026 等赛事有 11 支无记录队伍，此前 `roster[0].player_id` 越界崩溃，现 12 种子 0 错误。
- **返回入口 + 桌面适配**（2026-08-16）：① 模拟页左上角 sticky"‹ 返回"按钮，点击弹确认"当前模拟将中断，本次征战记录不会被保存"后回首页（确认弹窗泛化为 openConfirm(title, body, cb)）；② 球星卡页 h1 左侧加"‹"返回（有历史则 history.back，否则回 index.html）；③ 首页红蓝渐变改为 `#home.active::before` 全屏 fixed，桌面端不再只有中间一列有背景；④ ≥900px 桌面端 team-strip/dyn-strip 改为 wrap 换行，无需横向滚动即可选到 AG 等后排战队。
- **返回按钮优化 + 球星卡三列**（2026-08-16）：① 模拟页"‹ 返回"改为紧凑胶囊（auto 宽/高 30px/12px 字/nowrap，不再换行）；② 球星卡桌面端（≥900px）三列 + body 加宽到 1040px，手机端仍两列——注意媒体查询必须放在基础 `.cards` 规则之后，否则被覆盖。
- **第 10 王朝 + 桌面网格**（2026-08-16）：新增"26KSG 新王"（2026 春冠，4:0 横扫狼队，队史首冠；轻语/今屿/流浪/小玖/一笙），王朝共 10 个；桌面端（≥900px）王朝条 5×2 网格、战队条 9×2 网格（18 队两行），手机端仍横向滑动——媒体查询置于样式表末尾避免被基础规则覆盖。
