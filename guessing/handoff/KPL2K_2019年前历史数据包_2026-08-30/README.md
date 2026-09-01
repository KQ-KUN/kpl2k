# KPL2K 2019 年前历史数据接入指南

更新时间：2026-08-30

## 结论

现存 KPL 官方 `kplow` API 可以恢复 2016—2018 年 KPL 联赛的赛季、参赛队、587 场赛程和总决赛结果，但旧赛季的选手榜、战队名单与决赛选手详情均为空，不能单独解决“选手哪年首次登上 KPL”和“选手几冠”。

推荐采用双源方案：

1. KPL 官方 API 负责赛季、队伍、赛程、比分和冠军队。
2. Liquipedia Honor of Kings MediaWiki API 负责选手历届参赛结果，用于推导首次 KPL 赛季。
3. 冠军数必须以总决赛冠军方实际五人首发矩阵计算，不能直接使用 Liquipedia 的选手 `1st` 数量，因为后者会把报名替补也计入。

本数据包已经按上述方案生成 30 名标准主力池选手的首次登场年份，并整理了 2017—2026 挑战者杯的冠军首发矩阵。KWC 和 KPL 梦之队邀请赛不计入冠军数。

## 数据包内容

| 文件 | 用途 |
|---|---|
| `kpl_history_2016_2018.json` | 官方 API 的五个旧 KPL 联赛快照，共 587 场比赛 |
| `career_history.json` | 30 名选手的首次 KPL 赛季与 Liquipedia 报名阵容成绩快照 |
| `championship_rosters.json` | 按总决赛实际首发整理的冠军矩阵，是“几冠”的最终计算源 |
| `liquipedia_players.json` | 中文 ID 到 Liquipedia 页面标题的消歧映射 |
| `crawl_kpl_history.py` | 重抓 2016—2018 官方历史赛程 |
| `sync_liquipedia_careers.py` | 按规则刷新选手首次登场年份和报名阵容成绩 |

## 一、KPL 官方历史 API

基础地址：

```text
https://kplshop-op.timi-esports.qq.com/kplow
```

当前仍可用的 POST 接口：

| 接口 | 请求体 | 旧赛季实际结果 |
|---|---|---|
| `getSeasonAndStageAndTeamList` | `{}` 或 `{"seasonid":"KPL2018QJS"}` | 可返回赛季、阶段、参赛队 |
| `getScheduleList` | `{"seasonid":"KPL2018QJS"}` | 可返回完整赛程和比分 |
| `getScheduleDetail` | `{"seasonid":"...","scheduleid":"..."}` | 基本信息可用，旧决赛 `players` 为空 |
| `getPlayerRank` | `{"seasonid":"..."}` | 2016—2018 选手榜为空 |
| `getTeamsIntro` | `{"seasonid":"...","teamid":"..."}` | 旧赛季 `player_msg` 为空 |

2026-08-30 的实测覆盖：

| 赛季 | 场次 | 选手榜人数 | 冠军队名单人数 | 决赛详情选手数 |
|---|---:|---:|---:|---:|
| 2016 KPL 秋季赛 | 74 | 0 | 0 | 0 |
| 2017 KPL 春季赛 | 140 | 0 | 0 | 0 |
| 2017 KPL 秋季赛 | 107 | 0 | 0 | 0 |
| 2018 KPL 春季赛 | 114 | 0 | 0 | 0 |
| 2018 KPL 秋季赛 | 152 | 0 | 0 | 0 |

因此，官方 API 适合补齐 KPL2K 的赛季和比赛层，不适合继续尝试恢复 2019 年前的选手层。不要把“赛程抓到了”误判为“历史选手数据也抓到了”。

运行：

```powershell
python tools/crawl_kpl_history.py --from-year 2016 --to-year 2018
```

## 二、Liquipedia MediaWiki API

API 地址：

```text
https://liquipedia.net/honorofkings/api.php
```

本项目使用 `action=expandtemplates` 展开选手的 `QuickResults`，不抓取普通 HTML 页面。示例：

```text
action=expandtemplates
text={{QuickResults}}
title=YiNuo/Results
prop=wikitext
format=json
formatversion=2
```

返回表格包含日期、名次、赛事名和队伍。首次登场年份只从严格匹配以下格式的 KPL 主联赛中取最早年份：

```regex
King Pro League (Spring|Summer|Fall|Autumn) \d{4}
```

不能使用简单的 `startswith("King Pro League ")`，否则可能把 Global Tour、资格赛或其他派生赛事当作 KPL 首秀。

Liquipedia 的使用要求：

- MediaWiki API 每 2 秒最多 1 次请求。
- 必须使用能识别项目的自定义 `User-Agent`。
- 应缓存响应，避免重复请求。
- 内容采用 CC BY-SA 3.0，发布衍生数据时必须署名。
- 不允许用自动化脚本抓普通 HTML 页面。

规则原文见 [Liquipedia API Terms of Use](https://liquipedia.net/api-terms-of-use)。

运行：

```powershell
python tools/sync_liquipedia_careers.py
```

中断后只补缺失项：

```powershell
python tools/sync_liquipedia_careers.py --missing-only
```

## 三、冠军数的唯一口径

KPL Guessing 当前口径：

- 计入 KPL 春／夏／秋季赛、KPL 年度总决赛、冠军杯、冬季冠军杯、世界冠军杯、挑战者杯和 KIC。
- 不计 KWC。
- 不计 KPL 梦之队参加的邀请赛或季中邀请赛。
- 不计资格赛第一名。
- 只给总决赛冠军方实际首发五人记一冠，报名替补、教练和未上场队员不记。

不要把 Liquipedia `QuickResults` 中的全部 `1st` 直接作为冠军数。实测会产生以下错误：

| 选手 | 错误原因 | 报名阵容口径 | 决赛首发口径 |
|---|---|---:|---:|
| 梦泪 | 2019 秋随 AG 报名但不是决赛首发 | 1 | 0 |
| 久诚 | DYG 冠军赛季报名，决赛中路为萧玦 | 4 | 3 |
| 诺言 | eStar 后期冠军赛季报名，决赛对抗路为坦然 | 4 | 2 |
| 钟意 | 2023 春随 Wolves 报名，决赛打野为小胖 | 8 | 7 |
| 一号示例：一诺 | 2024 挑战者杯决赛发育路是小俞 | 不能转记 | 7 |

`championship_rosters.json` 已将每项冠军赛事保存成：

```json
{
  "id": "KCC2024",
  "date": "2025-01-11",
  "name": "2024 挑战者杯",
  "starters": ["轩染", "钟意", "长生", "小俞", "大帅"]
}
```

选手冠军数应由以下公式派生，不要人工保存一个无法追溯的整数：

```python
championship_count = sum(
    nickname in event["starters"]
    for event in championship_rosters["events"]
)
```

## 四、选手页面消歧

中文 ID 不能机械地转成拼音页面名。已经确认的特殊映射：

| 中文 ID | Liquipedia 页面 | 陷阱 |
|---|---|---|
| Cat | `Cat (Chen Zhengzheng)` | `Cat` 是消歧页 |
| 无畏 | `NoFear (Yang Tao)` | `WuWei` 会命中其他对象或空结果 |
| 妖刀 | `1dao` | 当前页面名不是 `YaoDao` |
| 爱思 | `Ice` | 不是 `AiSi` |
| 钎城 | `QC` | `QianCheng` 是 RNG.M 的虔诚 |

必须保留 `liquipedia_players.json`，不得在代码中重新猜页面名。

## 五、推荐写入 KPL2K 的数据契约

不要直接覆盖 KPL2K 的原始 API 数据。建议保留三层：

```text
data/raw/kplow/                 官方 API 原始或最小裁剪快照
data/raw/liquipedia/            带来源和抓取时间的非官方快照
data/curated/championships.json 人工核对的决赛首发事实表
```

选手派生字段建议增加来源信息：

```json
{
  "player_id": "stable-person-id",
  "name": "一诺",
  "debut_year": 2018,
  "debut_year_source": "liquipedia:YiNuo/Results",
  "championship_count": 7,
  "championship_count_source": "curated-finals-starters-v1"
}
```

合并时优先使用稳定人物 ID。昵称只作为显示值和外部页面映射键，因为转会、改名、同名选手和 API 身份漂移都会破坏昵称关联。

## 六、接入顺序

1. 将 `kpl_history_2016_2018.json` 导入 KPL2K 的旧赛季与比赛层。
2. 保留原始 `seasonId` 和 `scheduleId`，再映射到 KPL2K 内部 ID。
3. 用 `career_history.json` 修正标准池选手的 `debut_year`。
4. 用 `championship_rosters.json` 从赛事首发矩阵重新派生冠军数。
5. 对同名或改名选手建立稳定人物 ID，不按昵称盲合并。
6. 输出审计表，至少包含旧值、新值、来源和变更原因。

## 七、最低验收用例

接入 KPL2K 后至少断言：

```text
一诺  debut_year=2018  championship_count=7
小俞  2024 挑战者杯冠军首发=true
一诺  2024 挑战者杯冠军首发=false
梦泪  championship_count=0
钟意  championship_count=7
钎城  debut_year=2019
无畏  debut_year=2020
```

同时断言：

- 2016—2018 官方历史快照为 5 个 KPL 赛季、587 场比赛。
- 每项冠军赛事恰好 5 名首发且无重复。
- KWC 和资格赛不会进入冠军矩阵。
- 刷新非官方数据时遵守 2 秒限速并保留缓存。

## 八、已知限制

- 官方 API 没有返回 2016—2018 的选手榜、冠军队名单和决赛选手详情。
- `career_history.json` 目前覆盖标准主力池 30 人，不是全量 592 人；可通过扩展页面映射后继续同步。
- 冠军首发矩阵是整理数据，需要在新赛事结束后增加一条五人首发记录。
- Liquipedia 的选手成绩可用于发现候选赛事和首秀年份，不能单独证明总决赛实际首发。
- 本包没有改动或发布 KPL2K 仓库，只提供可审计的数据和接入工具。
