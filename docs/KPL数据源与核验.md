# KPL 数据源与核验

核验日期：2026-09-07。以下是公开网页使用的数据接口，不代表腾讯承诺稳定的开放平台服务。目前没有找到能够一次返回完整历史选手、历次转会、位置和个人荣誉的已验证 API。

## 可复用的官方接口

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
