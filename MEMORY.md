# KPL 2K 项目记忆

## 参赛（2026-08-16）
- 已决定参加 B 站 build in bilibili·AI创造公开赛，目的不是获奖（粉丝 0），是借截止日期把产品收口上线并留创作记录。投稿截止 2026-08-20 23:59:59。
- 投稿硬要求：横屏 ≥1 分钟、话题 #B站AI创造公开赛、标题末尾【B站AI创造公开赛】、同产品视频建合集、从官方活动页点"立即投稿"；评选按合集投币前 10 入围。冲奖需获奖后 B 站独家（其他平台下架），不冲奖可忽略，但视频内保留"粉丝自制非官方"声明。
- 参赛视频脚本与制作步骤：`docs/contest_video_script.md`（已过 human-writing 检查脚本，禁用项 0）。按真实参赛案例（世界之门/周礼翻译器/时空电话/现编 OS）改版：删身份自嘲，开场直接给结果，标题不写身份。分镜已标剪辑手法（推拉运镜/卡点/变速/定格/闪白闪黑/花字音效），做法在"给这条视频加分的剪辑手法"一节。口播已改老观众口气并织入 KPL 梗（请神梦老师/一诺千金/公孙离绕后/御三家），梗的出处见"脚本里用到的 KPL 梗"。

## 定位
战队经理式 KPL 赛季模拟网页游戏（手机优先、无后端、静态包 + COS/CDN）。抽象层级=比赛，不做局内操作/BP/账号/排行榜。数据范围 2019 起。

## 数据管线
- Python依赖记录在`requirements.txt`；项目本地环境为D盘仓库内的`.venv`，`rebuild_all.py`存在该环境时会自动使用它，保证Pillow头像步骤可运行。
- 源：kpl.qq.com（赛程/战队）+ prod.comp.smoba.qq.com（选手/逐局 MVP）。
- 一键重建 `python tools/rebuild_all.py`：审计→归属→组合胜率→清洗评分→映射→选手库→校验。
- formats.json 由 build_kpl_maps.py 生成，勿手改；改赛制改脚本。
- **坑**：淘汰轮常被命名"常规赛第X轮"（BO≥7），`fix_tournament_rounds()` 纠正；kpl 队 id 是 slug（`KPL2024S1_ag`），须 `remap_kpl_ids()` 映射回俱乐部 id。
- **坑**：smoba 榜单 team_id=当前队而非当季队，历史赛季会被污染；battle 未覆盖的赛季在 `data/overrides/player_versions.json` 的 teams 手工修正（已修 2022 夏小胖/冰尘/笑影）。
- KPL2026S2 已全量爬取，`clean_kpl.py` 里 `FORCE_BATTLEFIELD` 强制其为战场（status=1 但赛程齐）。
- **坑**：smoba 爬虫把部分赛季"小组赛"轮次标成 `type=other`（2019/2020 世冠），buildPhaseDefs 只认 round_robin 会导致阶段定义为空、赛季直接"刷新不出来"；已兼容 name 含"小组赛"的 other。
- **坑**：同一选手在平行时空可同时出现在玩家队与对手队（转会数据，如 23 夏帆帆在 TTG），stats 聚合必须按 `pid|team` 区分、entryFor 只保留主队，否则战绩卡出现"单赛季 33 MVP"；选手图鉴版本也可能缺赛季记录（如 一诺 KPL2026S1 无数据），recordsForRoster 需从 teams versions 兜底构造，否则换人后战绩卡缺人。
- **2026 赛季事实（2026-08-23 核对）**：2026 春（KPL2026S1）AG 发育路是小俞，一诺官方 battle 全季 0 记录（未参赛，非爬虫缺口，勿补造数据）；2026 夏（KPL2026S2）一诺复出（42 场、wr 0.57），赛季进行中（9/12 结束、冠军未定，8/23 已增量补爬 52 局 battle 到最新）。一诺 KPL2026S2 原始评分 56.5（当季发育路池数据垫底：输出 24.6%/击杀 2.05），按人气校准表上调至 76。

## 引擎规则
- **隐藏校准产品原则（2026-08-26 用户确认）**：人气/历史地位评分校准、冠军赛季补偿与玩家主队加成属于内部体验调节，不在对外战力规则中逐项公开；公开界面继续维持统一、公平的规则表述。修复战力系统时不得把这些隐藏项拆成可见字段或写入玩家说明。
- **v0.2 赛前策略（2026-08-25）**：`stable/balanced/gamble` 只把系列赛随机波动倍率设为 `0.65/1.0/1.55`，不改变公开阵容战力；经典与全明星、分享链接、历史记录统一保存策略。结果页按真实 path/results 生成零封、决胜局、让二追三/让三追四、全胜夺冠、败者组一穿 N 等成就标签。
- 强度 = 首发均分 + 位置覆盖 + 老搭档 + 组合胜率化学 + 风格；当前 `COMPRESS=1.0`。组合胜率化学来自 `build_pair_win.py`（真实逐局胜率偏离 50%），玩家经典模式主队另有隐藏 `PLAYER_BOOST=+5`。
- 系列赛胜率 = sigmoid(强度差)，`K=0.08`；基础高斯噪声 `σ=3.4`，再乘赛前策略倍率。
- **淘汰树是动态的**：参赛名单取首轮官方对阵种子顺序，晋级由模拟结果决定，不遍历后续官方固定对阵。单败逐轮淘汰，双败按胜者/败者组推进，KPL 总决赛为单场 BO7/BO9，不使用重置决赛。无战力数据的外卡队按 50 参赛。
- **常规赛动态晋级**：2021+ KPL 按第一轮升降组、第二轮重排、卡位赛、B组淘汰、第三轮 S/A 组与十队季后赛推进；2019–2020 大循环、世冠小组赛、年总擂台/突围、挑杯 32 强/瑞士轮各走对应管线。排名与模拟结果会实际决定后续参赛队，不再只做剧情。
- **双败轮次（2026-08-23 对齐官方）**：8 强双败败者组 = L1(4→2)/L2(4→2)/L3(2→1)/败决(2→1)，L3 在胜者组决赛**之前**打，胜者组决赛败者只打 1 场败者组决赛进总决赛；KPL 10 队双败 sab/legacy 同构（败者组半决赛 → 败者组决赛 = 半决赛胜者 vs 胜决败者）。旧实现让胜决败者多打一轮，用户已报 bug。
- **MVP 平衡**：MVP 评分加已拿 MVP 惩罚（-1.2/个）+ 随机扰动 ±2，防止打野数据权重垄断全部 MVP；finishSim 对胜场 ≥3 且全程 0 MVP 的选手按胜场规模保底 1-3 次。
- **翻盘文案**：comebacks 必须按真实比分线过滤（让二追三=曾落后 2 局且末局反超、拖巅峰对决=追平且非末局），cbPool 为空时退回普通 ending，绝不允许 3:1 出现"让2追3成功"；narrateSeries 用每队历史最大落后 maxDeficit 追踪。
- 黑称红线：攻击长相身高/疾病侮辱/假赛指控/低俗擦边一律不进库。
- 冠军判定：叙事层比"显示名"，主流程须 champion id 转显示名再传 ctx。

## 评分（v3，代码即规则）
- 分赛季 z-score 标准化（减中位数÷IQR）→ 全历史同位置 z 池百分位 → 分路权重加权 → 出场对数折扣（5场≈0.59，20场≈1.0）→ 50+49×score。
- 小样本：≥5 场即可评分（传奇例 4 场），池子只用 ≥10 场。
- 年度版本只统计正式战场赛季（排除季前/选拔），取当年峰值。
- 球星卡：按选手×战队拆卡（ACTIVE_2026 白名单 20 队），版本按年合并；非现役标"现役：xx/退役"；分路核心指标展示。

## 叙事
- 文件：player_flavor（66 人彩蛋）、team_flavor（外号）、templates、rivalry_flavor（9 组恩怨局，55% 触发）。
- **叙事素材 v2 + 战队口号**（2026-08-17）：templates 各池大幅扩充（openings 23 / events 20 / endings 12 / bp 10 / comebacks 10 / meme 18 / upsets 8 等），融入李九冠军诗、瓶子/居居/英凯/潇洒解说金句与官方主持句式（让我们恭喜/金色雨/捧杯）；round_tags/final_lines/eliminations 等轮级池只被 CLI narrative 消费，前端不渲染，新增条目须避免占位符；comebacks 遵循 engine 过滤（末局禁"巅峰对决"、非末局禁"让二追三/让三追三"）。team_flavor 新增 slogans（13 队官方口号，KSG/Hero 多条随机），data.js 载入 DATA.teamSlogans，ui.js 夺冠"捧杯时刻"与战绩卡冠军横幅按队伍一一对应喊口号；player_flavor 补 信/无言/小屿。改模板后需 build_web 重打包 base.json；sim_engine.py openings 已补 player_a/player_b 格式化参数。
- **叙事素材 v3 + 总决赛停留修复**（2026-08-18）：templates 再扩充（openings 33 / events 32 / endings 20 / bp 15 / comebacks 15 / meme 34，新增李九/瓶子/居居/英凯/潇洒解说金句与赛事诗词风格条目）；总决赛文字"秒跳战绩卡"修复——pumpReveal 赛季结束时先滚动到最后一场文字并停留 2.5 秒再跳 #/result（引擎层确认总决赛 games 5-9 局均正常生成，原因为跳转过快而非缺文字）。
- **叙事素材 v4 + 比分语义审计**（2026-08-24）：templates 扩至 openings 39 / events 44 / endings 28 / bp 20 / comebacks 21 / finals 16，新增 BP 控制链、兵线/视野/转线、资源转换、高地防守与原创诗性收束；选手彩蛋补 Fly/小胖/一诺/钟意/花海/清融/暖阳/轩染，宿敌组 9→13。真实解说只保留经核实的短句回声，不给原创句虚构署名。engine.js 与 sim_engine.py 已统一零封/决胜局/让二追三/让三追三/巅峰对决语义：BO3/BO5 打满不再叫巅峰对决，只有 BO7/BO9 打满末局使用盲选巅峰对决；随机“鏖战五局/让二追三”改为按实际比分选 pace 文案。`tools/validate_narrative.py` 会解析全部叙事 JSON，并以 500 组固定种子系列赛 + 200 组赛季故事检查禁用词、比分错配、三段中期事件和占位符泄漏；文本修改后需运行该脚本再 build_web。
- **叙事素材 v5（2026-08-25）**：新增五位置 `role_events`，局内高光按选手真实分路选择边线/控龙/中轴/输出/视野事件；决胜、逆转和末局提高诗性收束概率，普通小局降低随机金句密度。赛段卡补总决赛、败者组、淘汰压力、连胜和换人后的连续语境。player_flavor v8 同步清理运行数据与 `docs/narrative_text.txt` 中的攻击性黑称，`validate_narrative.py` 将其列为禁用词防回归。
- **评分 v4 + 人气校准 + 巅峰对决 + 赛制标注修复**（2026-08-19）：① 中路权重加入工具人维度（assists/be_hurt_rate），向鱼等蓝领中单不再只看输出；② overrides 新增 ratings 校准表（72 条，clean_kpl 评分后应用）：Fly 95/一诺 93/老帅 88/梦泪 88/钟意 93/清融 93/久诚 94/暖阳 92/坦然 91-92/Cat 86-87，回调虚高（梓墨 94→88、道崽 93→87、过儿 92.6→84、梦岚 92→86、小麦 87.7→84）；③ BO7/BO9 打满时末局 BP 固定"巅峰对决！双方盲选当前版本最强阵容"（engine.js narrateSeries 加 bo 参数 isPeak，sim_engine.py 同步）；④ placeText 修复：胜者组/败者组不再硬标 8 强（那是挑战者杯映射），改标"季后赛"，避免联赛败者组一轮游显示"止步8强"。
- 已删：弹幕玩法（统一"评论区"）、土狗/王八/棺材/勾兑/紧崽（改 32/懦崽）、假赛类。
- AG 偷家彩蛋：`steal_lines`，AG 胜局 12% 触发"请神梦老师"。

## BGM
- `app/js/bgm.js` 是唯一 BGM 源：intro（首页一首）/ battle（多首按名选曲，nextTrack/prevTrack 记住选择）/ champion（按队 byTeam，缺省回退"无双的王者"）。
- 音源 `app/assets/audio/*.m4a`（首页.m4a、云梦谣.m4a、各队小孩.m4a、无双的王者.m4a）；移动端首次点击 `BGM.unlock()`。文档 docs/BGM.md，测试页 app/bgm_demo.html。

## 战绩卡
- 每次 story 模拟生成 `app/result_card.html`：结果横幅（冠军/亚军/止步·N强）、阵容卡（头像/KDA/参团/MVP）、赛程表、选手数据表；小数统一 1 位，可截图传播。

## Web 前端（2026-08-16 起）
- **v0.2 核心闭环（2026-08-25）**：首页新增“30秒快速开赛”（推荐狼队 + KCC2026，失败回组队页）；经典/全明星选择页新增三档赛前策略；结果页新增成就标签。全明星无自定义选手时可分享 `#/a?...` 还原链接，含自定义选手时仍可下载 canvas 战绩图，只隐藏复制链接。分享 URL 携带 `v/tc/seed`，旧版本提示按当前引擎重算。
- **存储与发布门禁（2026-08-25）**：全明星历史只保存双方槽位引用，头像 Base64 只在当前 custom library 存一次；配额不足会逐条淘汰最老历史并显示提示。`python tools/verify_release.py` 串联赛程/评分/叙事校验、JS 语法、29赛季×3种子引擎矩阵、比分/冠军/待定/重复总决赛/路由/存储/BGM 静态检查。
- **验证分工（2026-08-26）**：为节省 token，Codex 默认只运行自动化测试、语法/数据/引擎校验以及本地 HTTP 可用性检查；不再打开浏览器模拟真人点击，也不做截图视觉走查。界面和真人交互由用户手动验收，只有用户明确要求“浏览器验收”时 Codex 才执行。
- **全明星模式（2026-08-24）**：首页原“全明星模式”卡已启用，路由 `#/allstar`。红蓝双方各选一支 2026 默认战队一键填满五位置，再从原有 20 个战队版本卡合并生成的 `app/data/all_star.json` 中跨队、跨年份换人；支持 BO3/BO5/BO7 单场系列赛，复用经典模式的强度、逐局叙事、MVP 与战绩表。组队页不展示战队战力，但模拟仍计算强度。自定义选手先选职业版本作为能力模板，只覆盖姓名/头像；内置男/女版源流之子头像，上传头像支持拖动、缩放和圆形裁剪，最终浏览器压缩为 JPEG 后仅存 localStorage，因此全明星自定义阵容不生成跨设备分享链接。构建逻辑在 `tools/build_web.py`，产品/验收规格见 `docs/all-star-mode-spec.md`。
- **纯前端 SPA**：`app/index.html` + `js/{engine,narrative,data,ui,bgm}.js`，hash 路由：`#/` 首页、`#/team` 组队、`#/allstar` 全明星、`#/season` 战场、`#/sim` 模拟、`#/result` 结算、`#/history` 历史；经典分享 `#/s?...`、全明星分享 `#/a?...` 可还原阵容与种子。
- **引擎 JS 化**：engine.js 与 tools/sim_engine.py 对齐（常规赛排名→官方种子剧情→动态淘汰树），mulberry32 种子可复现；narrative.js 对应 narrative.py。另含 `createSession()` 分阶段模拟：每场/每轮可暂停，轮间换人（setRoster 更新强度，rng 状态延续，已赛内容不变）。
- **数据分片**：`tools/build_web.py` 生成 `app/data/`：base.json（franchise/选手/叙事/覆盖，137KB）+ manifest.json + seasons/{sid}.json（赛制+当季选手+pair_win）+ teams/{fid}.json（队卡版本，版本补代表 season_id）。已并入 rebuild_all.py。
- **26 现役首发**：组队预设取 KPL2026S2 的 pickStarter（位置补全后即"一诺+钟意+长生+大帅+轩染"），缺失队回退 KPL2026S1；版本选择来自队卡 versions。
- **BGM 场景**：intro=首页.m4a；battle=王者冰刃等 5 首（默认王者冰刃，可切）；champion=byTeam 小孩战歌（AG 红小孩/狼 狼小孩/eStar 星小孩/TTG TT小孩/KSG KSG小孩/Hero HERO小孩/DYG DYG小孩/TES 陀螺小孩），缺省无双的王者。
- **部署**：已上线 Cloudflare Pages `https://kpl2k.pages.dev`（项目名 kpl2k，API Token 经 `tools/deploy_pages.py` 上传，Token 存 `%USERPROFILE%\.kpl2k_cf_token`）。一键更新：双击 `tools/deploy.bat`（需本机 Python 3，先 build_web 再上传）。注意：Codex 沙箱网络连不上 upload.pages.cloudflare.com，部署须在用户本机执行。`tools/deploy_cos.py` 为腾讯云 COS 备选。
- **线上托管（当前）**：Cloudflare Workers 项目 `kpl2k.hkq2297409816.workers.dev`，已连接 GitHub 仓库 `KQ-KUN/kpl2k` 自动部署（Workers Builds，轮询模式）。本机 GitHub CLI 已通过 `KQ-KUN` 持久登录；默认发布流程为验证通过后提交并推送 `main`，`tools/push_to_github.py` 的 `GH_TOKEN` API 直传仅作备用。Cloudflare 检测到 main 更新后 1-2 分钟自动部署。
- **腾讯云 COS 已上线（2026-08-17）**：桶 `kpl2k-1470042573`（上海，公有读私有写，静态网站已开，索引 index.html），主域名 `https://kpl2k-1470042573.cos-website.ap-shanghai.myqcloud.com/`（根路径直达），默认域名 `https://kpl2k-1470042573.cos.ap-shanghai.myqcloud.com/index.html`。部署脚本 `tools/deploy_cos.py`，密钥用子账号 jhl 的编程密钥（QcloudCOSFullAccess，经环境变量 COS_SECRET_ID/COS_SECRET_KEY 传入，不落盘）；创建时桶权限默认私有，上线前需 SDK put_bucket_acl(public-read) + put_bucket_website（参数用 WebsiteConfiguration dict，非 IndexDocument 顶层）。已校验 12 个核心文件本地/线上 SHA256 全一致。更新流程：rebuild_all → build_web → deploy_cos.py。后续可选：买域名 + ICP 备案 + CDN 自定义域名（国内 CDN 必须备案，约 1-2 周）。
- **CloudBase Webify 免备案托管（2026-08-17）**：环境 `kpl2k-d0gigrx6e89914f65`，应用地址 `https://kpl2k-kpl2k-d0gigrx6e89914f65.webapps.tcloudbase.com`（国内可访问，带"开发测试提示页"+限流，仅作备案过渡）。走 Git 仓库部署：目标目录 `./app`、构建命令留空、**构建产物目录必须填 `./`**（默认 `./dist` 会报 Path does not exist 部署失败）；部署路径 `/`。触发机制：push GitHub 自动触发（webhook 偶发失败），失败时去 Webify 控制台 https://console.cloud.tencent.com/webify/index 手动触发。2024 后 COS 默认域名强制下载（x-cos-force-download），故 COS 必须绑定备案域名才能预览。
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
- **王朝版本 = 年代赛季 + 化学补偿**（2026-08-16）：王朝五人组不再取队内巅峰版本，改为统一取王朝年代赛季（DYNASTIES 新增 season 字段，缺记录按时间就近回退并告警）；战力差由该赛季真实同场默契 + 组合胜率化学补偿，实测 10 王朝均 10/10 组合命中、胜率化学 +2.6~+3、默契 +3.2、位置覆盖 +2。25狼队中单由向鱼更正为紫幻（向鱼 2025 已转会 TTG/DYG）。同步在 overrides 修正 7 条王朝年代分路：Giao=打野、花海19春=发育路、Cat19春=中路、Alan19春=打野、易峥=发育路、久酷=发育路。
- **26狼队替换 25狼队 + "球星卡"更名"选手图鉴"**（2026-08-16）：王朝第 10 个由 25狼队（2025 年总亚军）替换为 26狼队（KCC2026 挑战者杯冠军、队史十一冠）：清清/皖皖/紫幻/道崽/信，五职齐全；全站"球星卡"文案统一改为"选手图鉴"（首页入口、选手库标题/页脚、代码注释），build_player_library.py 重生成 player_library.html。
- **第 10 王朝 + 桌面网格**（2026-08-16）：新增"26KSG 新王"（2026 春冠，4:0 横扫狼队，队史首冠），后修正首发为 2026 春决五人组：无言/句号/流浪/小屿/一笙；王朝共 10 个；桌面端（≥900px）王朝条 5×2 网格、战队条 9×2 网格（18 队两行），手机端仍横向滑动——媒体查询置于样式表末尾避免被基础规则覆盖。
- **桌面网格压矮**（2026-08-16）：桌面端王朝/战队 chip 缩小内边距与字号（王朝约 101px、战队约 98px 两行），800px 视口下战力框 top≈641px，无需滚动直接可见。
- **桌面加宽替代压字**（2026-08-16）：用户嫌压矮后字号太小——改为桌面容器加宽到 `min(1280px,96vw)` 利用两侧空白，chip 恢复可读字号（王朝标签 14px/描述 10px、战队缩写 15px/名字 10px），网格仍 5×2/9×2，1366×800 下战力框 top≈700px 可见；手机端不变（max-width 720、横向滑动、原字号）。
- **双败决赛单场化**（2026-08-16）：KPL 季后赛双败决赛此前按"败者组冠军需赢两次"的重置制模拟，出现两行"总决赛"（如狼队 2:4 + 4:3）。KPL 真实决赛为单场 BO7/BO9——`runDoubleStage` 与 `dynamicDoubleElim` 均改为胜者组冠军与败者组冠军一场定冠军（10 种子验证无重复总决赛行）。
- **结束征战不自动跳转**（2026-08-19）：赛季最后一场打完，`pumpReveal` 不再自动 `finishSim + go('#/result')`——滚动到最后一场文字、隐藏跳过/换人/继续征战、只显示"结束征战"，点击才 `finishSim + go('#/result')`；`sim-skip`（一键跳转）仍保留确认后直跳。无头 Edge 实测狼队 KCC2026 全流程：打完停在 #/sim，3 秒不自动跳，点按钮才进战绩卡。
- **冠军赛季隐性补偿**（2026-08-19）：`clean_kpl.py` 在人工校准之后对当季冠军队伍成员战力 +2.5（校准与补偿叠加，一诺 KPL2024S3=88.5、钟意=90.5）；补偿不对外明示"荣誉"，战力规则文案改为"版本权重：评分结合版本赛季浮动，高光年份自动上浮"。
- **BP 英雄池按赛事年份**（2026-08-19）：新增 `data/narrative/heroes_pool.json`（2019-2026 每年前五位置各 8 个版本强势英雄，来源 KPL 英雄榜/赛季盘点），`build_web.py` 将池嵌入 base.json 的 `narrative.templates.heroes_pool`；`gameNarration/narrateSeries/simulateSeason/createSession` 全线传 year（从 season_id 提取），BP 与开局英雄按赛事年份取池（王朝穿越用赛事年份，不是选手版本年份），缺位置回退全局池。无头实测：2019 局无 2020+ 英雄、2026 局含源流之子。
- **赛制全面修正：常规赛动态晋级**（2026-08-19）：此前引擎把三轮常规赛照官方固定赛程全部跑完，全负队仍按官方名单打第三轮。现按真实赛制重写 `createDynamicSession`（`createSession` 有 regular_format 时走新管线）：
  - `kpl_3round`（2021-2026 KPL）：第一轮官方赛程 → 按组排名升降分组（2021-22 `swap`：S 后二↔A 前二、A 后二↔B 前二；2023+ `by_rank`：每组 1-2→S、3-4→A、5-6→B）→ 第二轮动态组内循环 → 卡位赛 BO7（S5vsA2、S6vsA1、A5vsB2、A6vsB1）→ B 组淘汰 → 第三轮仅 S/A 12 队 → 季后赛 10 队双败（S1-4 胜者组、S5-6 直接进败者组 R2、A1-4 败者组 R1，12 场结构与官方一致）。B 组被淘汰的队第三轮不再出场（无头实测：26 春无锡TCG 打完第二轮即止步）。
  - `kpl_single`（2019-2020）：常规赛官方大循环 → 前 10 进季后赛（legacy 双败：前 4 胜者组、5-10 败者组 R1，含败者组轮空/胜者组决赛败者复活，12 场）。
  - `group_stage`（世冠/挑杯小组赛）：小组赛官方赛程 → 按组名次出线（2022 挑杯 6+2 种子）→ 动态单败树，决赛按 final_bo。
  - `annual`（年总）：擂台赛官方 36 场（大师/精英组外循环，用 a_group 字段区分 S/A）→ 大师前 4 + 精英第 1 直进，大师 5-6 + 精英 2-5 打突围赛（6 队 3 场 BO7）→ 8 队双败。
  - `bracket`（2025/2026 挑杯）：32 强官方 BO5 → 动态 16 强 BO7 → 8 强双败 BO7 → 决赛 BO9。
  - `swiss`（2023 挑杯）：官方瑞士轮赛程全跑，按总排名前 8 出线（近似）。
  - 外卡机制保留：主队不在赛事名单时顶替最弱参赛队（动态管线内 first stage 处理）；阶段说明卡（分组/卡位赛/B 组淘汰）用 regular_recap 展示；止步即显示"结束征战"。
  - `build_kpl_maps.py` 新增 `REGULAR_RULES` 表输出 `regular_format` 到 formats.json；`build_web.py` 赛季分片保留 `a_group/b_group` 与 `regular_format`。JS `simulateSeason` 与 Python CLI `simulate_kpl3_season` 同步接入（CLI 其他赛制类型仍以网页引擎为准）。
- **王朝文案 + 局内文本准确性 + 玩家胜率**（2026-08-20）：① 王朝预设 19QG 改"19QG 巅峰"、23狼队改"23狼队双冠"（2023 春季赛+挑战者杯冠军，不再叫王朝）；② `gameNarration` 实现系列赛全局 BP——`narrateSeries` 维护 usedHeroes，已出现英雄不再复用（池耗尽回退，JS+CLI 同步）；风暴龙王只在 ≥20 分钟出现（pickObjective 按分钟过滤）；templates.json 中立化 12 条位置暗示表述（一箭定乾坤/惩击/反野/游走带节奏/连续收割/控五等）；③ 玩家队隐蔽加成 `PLAYER_BOOST=+5`（createSession/createDynamicSession/simulateSeason 三处，不上榜不显示）、`STRENGTH_NOISE` 4.0→3.4（强队更稳）；25 年总 AG 夺冠率实测 42%→75%，弱队仍会止步；补一诺/轩染 KPL2025S3 战力 override（88/86，此前被低估到 73）。
- **战绩卡数据合理化**（2026-08-20）：`simMatchStats` 击杀/助攻按 KPL 常见数据上调（胜方单队击杀 12-18、败方 7-12；每击杀约 1.6-2.2 助攻），参团率从 ~10-30% 修正到 37-76%（均值 ~55%）；MVP 明确为每局胜方专属（队内按本局 k+a/d 评分，主力位更易拿），败方不参与 MVP 计算（用户确认）；`simMatchStats` 补导出到 KPL_ENGINE 便于测试。
- **音乐功能恢复上线**（2026-08-21）：删除 ui.js 顶部的 BGM no-op 覆盖，恢复 `app/js/bgm.js` 真实播放（Audio 单例、淡入淡出、移动端首触 unlock）。音频 16 首 m4a 在 `app/assets/audio/`（git 已跟踪，约 30MB）：首页=首页.m4a；对局曲目=王者冰刃（默认）/云梦谣/荣耀主题/冠军杯/明日坐标，可点曲名切换（battleDefault=0）；夺冠战歌=无双的王者.m4a 兜底，byTeam：红小孩=成都AG超玩会、狼小孩=重庆狼队、星小孩=武汉eStarPro、TT小孩=广州TTG、KSG小孩=苏州KSG、HERO小孩=南通Hero久竞、DYG小孩=深圳DYG、突然的陀螺小孩=长沙TES.A（包含匹配）。淬炼小孩.m4a 暂未映射战队（默认战歌兜底）。
- **音乐按钮与 KSG 战歌修正**（2026-08-21）：① 首页新增 BGM 开关按钮（bgm-toggle-home，点按后隐藏"点屏幕音乐响"提示）、模拟页 sim-music-bar（上一首/曲名/开关/下一首）与结算页 bgm-toggle 恢复显示（之前 display:none）；② 淬炼小孩.m4a 实为苏州KSG 专属战歌（byTeam 更新），无专属战歌队伍兜底恢复"无双的王者.m4a"；③ "继续征战"点击后显式 `BGM.play('battle')` 幂等恢复，防止阶段切换导致对局音乐中断；UI 探针测试 PASS（按钮齐全、goon 触发 play(battle)）。
- **BGM 打断修复 + 三键联动 + 按钮置顶 + 首页平台链接**（2026-08-21，链接区 2026-08-24 更新）：① 根因：bgm.js 候选音源全部 error 时把 `current` 置 null，导致同场景 play('battle') 误判为切换而重建音频（headless 实测 startCount 2→3）；修复为保持场景标记，`play()` 同场景仅 safePlay 恢复不重建（startCount 2→2 PASS）；② 三处音量键（首页/模拟页/结算页）统一 `syncBgmToggles()` 联动，任意开关同步更新所有图标，SVG 喇叭/斜杠图标（bgmIconHtml）；③ 首页开关移到右上角 fixed（.home-bgm-row #home-bgm-row）；④ 首页底部改为“链接：B站、小红书”并排胶囊按钮，使用内联平台 SVG 图标；B站保留演示视频链接，小红书使用 `https://xhslink.cn/o/1r29tjAYEWy`，无外部图标依赖。
- **BGM 终极修复：任意点击动音频的根因**（2026-08-21）：真凶是 ui.js 解锁监听 `addEventListener('click', once, {capture:true})` 与 `removeEventListener('click', once)` 的 capture 参数不匹配，导致 once 监听**从未被移除**——每次点击页面任意位置都触发 `unlock()` 重复 `play()`，造成重播与卡顿。修复：① remove 时补 `true` 参数；② `unlock()` 加 `if (unlocked) return` 只解锁一次，之后点击绝不触碰音频（探针：空白连点 3 次仅首次解锁播放，startCount 0→1 后不再变化）；③ "继续征战"路径彻底零 BGM 调用（startCount 2→2、play 调用 []），点击延迟 30ms 防渲染卡顿；④ 音量滑条：三处声音键悬浮显示 `.bgm-vol` 滑条（input range），拖动即 `BGM.setVolume`，三处联动，音量持久化 localStorage（kpl2k_bgm_volume）。
- **征战无声修复 + 音量交互重做**（2026-08-21）：① 征战界面无声根因之一：startScene 在 muted 时设 pending 卡死，若用户曾点过静音（localStorage 持久化）则之后所有场景永不播放、切歌无效；改为 muted 时"无声播放"（volume=0），取消静音立即有声；② play() 同场景仅 paused 时静默恢复（不重建、不重播）；③ 交互重做：音量滑条**常驻显示**（不再 hover 消失），三处声音键旁都可直接拖动调音量；静音图标变红色（.bgm-btn.muted）醒目提示一键禁音状态。探针 PASS：滑条常驻 block、muted 往返不卡、进入征战 current=battle、继续征战零音频操作。
- **切歌只成功一次的根因与修复**（2026-08-21）：switchTrack/playTrack 原走 `fadeOut(300ms) -> startScene` 异步链；快速/连续切歌时第二次切歌的 fadeOut 命中 `fading=true` 立即 done→startScene，但新歌 fadeIn 的 onStarted 检查 `fading` 被拒 → 新歌 volume 永远 0 无声（曲名已切但听不到）。修复：① 切歌改为**同步 startScene 立即重建**（不走淡出链）；② fadeIn 的 onStarted 移除 fading 条件，仅保留 muted 检查；③ 过期 play() 回调用 switchSeq + audio 对象双重校验（mock 竞态测试：连续切 3 次实例 1→2→3、过期回调不破坏新歌、最新实例音量淡入至 0.6 PASS）。另用 imageio_ffmpeg 探测确认全部 16 首 m4a 均为 AAC-LC 44100Hz（编码兼容，排除文件问题）。
- **2026 挑杯首轮“待定”修复**（2026-08-24）：KCC2026 数据完整（32 强 16 场、32 队），问题来自动态引擎首次只写入主队比赛，赛程树按 16 场补位后显示 8 个“待定”。`createDynamicSession.next()` 仅对 `curDef.bracket` 的 32 强阶段一次写入完整队列；其他常规赛仍逐场推进，保留轮间换人与暂停。无头 Edge 验证首张卡 16 个真实对阵、完整赛季树 38 场且后续轮次正常。
- **历史双位置 + 六点六 + 现役 JDG 校准**（2026-08-26）：官方 battle 数据中，AG 在 `L20190004/L20200001/L20200003/KPL2020S2` 的六点六姓名与位置整列为空；`build_attribution.py` 现按精确的“赛季+10027+空名”恢复为 `BTL六点六/对抗路`。啊泽 2020-2024 逐季校正为对抗路，2025 游走保留；`clean_kpl.py` 从校正后的赛季记录重算选手生涯位置并集，`build_player_library.py` 从卡片版本重算战队卡位置并集，避免接口用退役位置覆盖历史。现役 JDG 2026 版本校准为光明 82、无双 80、清融 92、小寒 80、无畏 82。新增 `tools/validate_player_versions.py`，检查六点六 2020 春可选、啊泽 AG 全为对抗路、卡片位置并集一致及 JDG 战力下限；已接入发布门禁和一键重建。
- **2026 周最佳/赛季最佳战力校准**（2026-08-26）：用 KPL 官方周最佳与春季赛一二阵对照 2026 春夏评分。低估横跨多个位置而同位置高分样本正常，因此不改全历史分路权重，继续以人工荣誉校准补足基础数据无法表达的高光和团队贡献。2026 年版关键结果：轩染 85、道崽 92、句号 90、流浪 92.5、一笙 90、清清 89、暖阳 87、小屿 87、小雪 91；夏季单周入选但整季表现有限者只设 83 左右下限。`validate_ratings.py` 新增 21 条内部荣誉门槛，防止重建回退；外部规则仍不披露具体隐藏补偿。
