# KPL 数据源与核验

核验日期：2026-09-07。以下是公开网页使用的数据接口，不代表腾讯承诺稳定的开放平台服务。目前没有找到能够一次返回完整历史选手、历次转会、位置和个人荣誉的已验证 API。

## 可复用的官方接口

### 2026-09-07 新增：新版官网选手表现表

从 [KPL 官网](https://kpl.qq.com/) 实际加载的 `static/index-BTgLTa6n.js` 与 `HomeView-DnCOJWj1.js` 确认了 `POST /kplow/getSeasonPlayerPerf`，请求体为 `{"seasonid":"KPL2026S1"}`，无需登录。

- 遍历官网返回的 23 个赛季，10 个非空，合计 1,115 条赛季选手记录；2026 春季 114 条、夏季 120 条，包含只登场 1 局的选手。
- 非空范围为官网目录中 2023—2026 的联赛和年度总决赛。2016—2022 的 13 个赛季返回空数组；目录没有杯赛，不能作为完整生涯数据库。
- 字段有官网选手 ID、公开真实姓名、队伍、位置编码、小局数、KDA、击杀、伤害/承伤/经济/参团占比和头像。
- 同届赛事、同俱乐部、同名的唯一交集建立 ID 对照；跨记录有冲突则不合并。归档得到 145 人、693 条记录，另 422 条无法据此完成身份对应（部分旧赛季姓名为空）。不能仅凭同名、位置或场数强行配对。
- `data/curated/official_player_profiles.json` 保存接口出处、采集时间、ID 对照和数据记录，可供未来项目复用。当前题库有 140 人获得真实姓名及官网 ID，真实姓名也可用于弗一把搜索。
- 这些记录没有给现有题库增加新的参赛届数；本次不改冠军、首秀、战力或累计小局数，不将同一赛事两份来源相加。

```powershell
.venv\Scripts\python.exe tools/collect_kpl_player_perf.py
.venv\Scripts\python.exe tools/build_kpl_official_profiles.py
.venv\Scripts\python.exe guessing/tools/import_kpl2k.py --source .
```

### 小程序与其他入口

- 官方赛事账号的[每周最佳阵容公告](https://weibo.com/6074356560/5266556163981632)提到“KPL会员中心”小程序的选手点赞入口。当前未获得可直接访问的完整历史资料页面，未登录小程序，也未读取账号数据；不能据此声称它提供全量履历 API。
- GitHub 的 [Kloping/wzyd-view](https://github.com/Kloping/wzyd-view) 文档主要是营地用户资料和玩家对局查询，不是职业联赛选手历史数据库，本次不接入个人绑定接口。
- `getTeamsIntro` 对 2025 年总 AG 的实测可以返回统计与英雄池，但姓名、真实姓名等为空，没有绕过上述身份缺口。

| 来源 | 方法与路径 | 实测结果及边界 |
| --- | --- | --- |
| `prod.comp.smoba.qq.com` | GET `/leaguesite/leagues/open` | 返回 32 届赛事；有联赛，也有杯赛 |
| 同上 | GET `/leaguesite/league/player/settle_list/open?league_id=20190001` | 2019 春季返回 74 条选手统计；不是历年注册大名单 |
| 同上 | GET `/leaguesite/matches/open?league_id=…` | 赛程；已有采集器支持 |
| 同上 | GET `/leaguesite/battle/open?battle_id=…` | 实际小局出场；适合交叉验证归属，旧记录也可能缺名或使用旧 ID |
| `kplshop-op.timi-esports.qq.com/kplow` | POST `getSeasonAndStageAndTeamList`，JSON `{}` | 返回 23 个赛季，可取得早期赛程 |
| 同上 | POST `getPlayerRank`，JSON `{"seasonid":"KPL2018QJS"}` | 请求成功，但九个榜单都是空数组，不能据此恢复 2018 选手全集 |
| 同上 | POST `getPlayerRank`，JSON `{"seasonid":"KPL2026S1"}` | 九类榜单共 29 名不同选手；各榜单通常只有前五，不是全量选手 |

请求使用对应官网的 Origin、Referer，以及普通浏览器 User-Agent；不需要读取用户账号、Cookie 或密钥。原始响应应与处理后的游戏数据分开保存。

## GitHub 检索结果

### 2026-09-08 历史逐局记录与战队归属补充

- 八届赛事页面共找到 974 个小局，其中 934 个有十名选手资料，涉及 264 个原站选手 ID。2017 冠军杯 37 页、2018 春季 3 页缺少十人阵容，不计入个人出场。重新采集时原先一个冬冠请求失败已恢复。
- 结构化证据按届保存为 `data/curated/wanplus_K*.json`；2016 秋季的旧单届样本文件保留作前次采集记录。所有赛事仍是公开页面可见部分，不宣称全赛季或生涯总局数完整。
- `wanplus_identity_map.json` 人工确认 19 名选手，`build_wanplus_appearances.py` 按稳定原站 ID 汇总 105 条选手×赛事记录。CatGod/Cat、刺痛/Hurt、Jungle/伪装、Orange/橘子、Six/六点六、Rouse/虔诚、Storm/暴风锐保留明确别名关系并支持搜索；仙阁小羽不并入 2022 年首秀的小羽。一诺、暖阳等已知首秀年份保持不变，补入实际观察到的小局和赛事。
- 首秀更正：Hurt、无痕、橘子、伪装为 2016；Alan、初晨、虔诚、暴风锐为 2017；最初、柠栀、尘夏、六点六为 2018。只使用实际 KPL 联赛出场补首秀，冠军杯不代替联赛。
- 单局 HTML 左右队选手交错排列，按 `bans_l` / `bans_r` 与两侧战队 ID 对应，不能用“前五人归左队”。补入 Cat、Alan 的 QGhappy（现重庆狼队），伪装的 eStar / QGhappy，橘子的 eStar，老帅的 GK（现佛山DRG），无痕的 AS仙阁，以及 Hurt 的 MU 出场。现存 franchise ID 复用，AS仙阁、MU 使用独立历史 ID；不把 QG 收购的原 Hero 与 MU 混为一队。
- 每个新增战队关系都保存其实际出场小局 ID；没有出场资料的大名单不增加效力战队数。冠军杯出场可以进入履历，但不增加仅按 KPL 联赛计算的效力战队数。当前队名只用于现有游戏的统一展示，不作为当年队名。
- 不改变冠军/FMVP、位置或战力。官方已有同届统计时，不叠加玩加同届小局；别名 ID 的重复赛季数据依旧按赛季×战队×位置取较完整的一条。
- 交叉材料：[2017 秋决现场赛评](https://wanplus.cn/article/99378.html)、[伪装转会后采访](https://www.ttplus.cn/publish/app/data/2018/11/01/192662/os_news.html)、[QG 收购原 Hero 的历史报道](https://mt.sohu.com/20170709/n500518091.shtml)。资料采集和身份校验结果分开保存，不能把 264 个原站 ID 宣称为 264 名已完成跨库核验的选手。

```powershell
.venv\Scripts\python.exe tools/collect_wanplus_history.py --all
.venv\Scripts\python.exe tools/build_wanplus_appearances.py
.venv\Scripts\python.exe guessing/tools/import_kpl2k.py --source .
.venv\Scripts\python.exe -m unittest discover -s tools -p test_wanplus_history.py
.venv\Scripts\python.exe -m unittest discover -s guessing/tools -p test_championship_data.py
```

### 2026-09-07 非官方历史库进展

- [玩加赛事库](https://wanplus.cn/kog/event?t=0&year=2016)有按年筛选入口，已定位 2016—2018 八届联赛/冠军杯。排除预选赛、KRKPL、G联赛和亚运会。
- `tools/collect_wanplus_history.py` 缓存赛事页、系列赛页和单局页，提取原站选手 ID 与昵称，校验每局十人及赛事归属。原始 HTML 留在 `data/raw/wanplus`，结构化事实在 `data/curated/wanplus_history_evidence.json`。
- 已采集 2016 秋季页面可见的 40 场系列赛、125 小局、72 个选手 ID。页面不是已证明完整的全赛季目录，不能用这些数量当作赛季总数。
- 基于[AG 对 AS仙阁的小局页](https://wanplus.cn/match/30431.html)、同届其他单局页及[AG 战队专访](https://wanplus.cn/article/67382.html)，先建立梦泪与老帅的人工身份映射。`historical_appearances.json` 保存两人各 27 个已观察小局的 ID。题库分别新增一届参赛、27 个已收录小局；已有同届原始统计时不重复累加。
- 玩加当前队名会出现在历史页面标题中，例如 2016 年页面显示今天的广州TTG。此次没有直接采用标题作为当年的战队名称，也没有靠同名自动合并其余 70 个 ID。
- `POST /ajax/stats/list` 实测返回业务错误 -400；本轮不处理账号或绕过校验，改用已公开可读页面。
- [2016冠军杯回顾](https://wanplus.cn/article/304352.html)列出 eStar 六人名单，但不足以证明决赛五人首发。因此没有据此给六人全部增加冠军。

- [taitai66/PythonMajor-assignment](https://github.com/taitai66/PythonMajor-assignment)：实际配置使用同一个官方 `getScheduleList`。它是赛程与比分采集项目，不是新的选手履历数据库。README 的覆盖描述与配置年份并不完全一致，应以接口实测为准。
- [qing762/honor-of-kings-api](https://github.com/qing762/honor-of-kings-api)：英雄资料 API，不是职业选手 API。
- [lizupingsama/Honor-of-Kings-Match-Dashboard](https://github.com/lizupingsama/Honor-of-Kings-Match-Dashboard)：营地玩家对局查询，不等于 KPL 职业履历。不要为当前任务引入个人登录凭据。

不采用名称自称“KPL官网”但域名不属于腾讯、缺少来源的聚合页，也不采用搜索摘要中的 AI 人物介绍。

## 本项目的复用入口

```powershell
# 探测并单独留存来源响应，不覆盖游戏库
.venv\Scripts\python.exe tools/probe_kpl_sources.py
# 已有的单赛事采集器；写入 data/raw
.venv\Scripts\python.exe tools/crawl_kpl.py --league 20190001
# 检查题库派生结果；不写游戏数据
.venv\Scripts\python.exe guessing/tools/import_kpl2k.py --source . --check
```

探测快照保存于 `data/raw/source_probe_2026-09-07.json`。raw 目录不应默认整体发布到 GitHub。

## 必须保留的清洗边界

1. 近期挑战者杯的 `league_type` 也可能是 `kpl`。判断联赛首秀和联赛效力战队数时，使用赛事 ID 与名称；不要只比较这个标签。
2. 选手当前所属战队、赛季出场战队、青训/注册关系是不同字段。使用 player ID 与 franchise ID，不能通过同名或两人曾当过队友推导归属。
3. 弗一把的战队格显示猜测选手的最近战队。只有这个具体战队在答案选手履历里，才给近似提示；两人的其他历史战队有交集不算。
4. 同一俱乐部改名、转回老东家按 franchise ID 去重。杯赛借调可纳入真实履历，但不能增加仅统计 KPL 联赛出场的战队数。
5. 榜单空数组、历史覆盖不足、缺少首发证据不能变成“零次”“从未”。保留待核验状态；不能因为旧数据缺口批量删除热门选手。
6. 不自动用新抓取数据覆盖历史位置、冠军和 FMVP。先比对原始响应、记录来源和差异，再通过现有回归验证。
