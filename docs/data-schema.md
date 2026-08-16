# 数据 Schema v0.1（数据管线 ↔ 前端契约）

> 本文件是数据层与前端之间的"接口契约"：爬虫产出 raw，清洗后产出 processed，前端只消费 processed。

## 1. 分层与目录

```
data/
  raw/                          # 官方原始 JSON（爬虫产物，可随时重爬）
    leagues.json
    league_{league_id}_players.json
    league_{league_id}_teams.json
    league_{league_id}_matches.json
    match_{match_id}_battles.json
  processed/                    # 清洗后前端消费的数据包
    index.json                  # 版本 + 可用赛季列表
    seasons.json                # 赛季元信息 + 战队列表
    formats.json                # 每赛季赛制结构（分组/轮次/晋级树）
    players.json                # 选手主档（跨赛季唯一 ID）
    player_season_stats.json    # 选手-赛季统计 + 评分
    matches.json                # 比赛 + 小局（含首发阵容）
    config.json                 # 平衡参数（爆冷系数、评分权重）
```

## 2. 核心实体

### Season

```json
{
  "season_id": "KPL2021S2",
  "league_id": "20210004",
  "name": "2021KPL秋季赛",
  "year": 2021,
  "start_time": "2021-09-22",
  "end_time": "2021-12-25",
  "teams": ["KPL2021S2_estar", "KPL2021S2_ag"]
}
```

- `season_id`：kpl.qq.com 的 cc_league_id（如 KPL2021S2），为跨源主键；
- `league_id`：smoba 接口的赛事 ID，用于回查原始数据。

### TeamSeason

```json
{
  "team_id": "KPL2019S1_estar",
  "season_id": "KPL2019S1",
  "name": "eStarPro",
  "logo": "https://...",
  "honors": [{ "honor_name": "冠军", "honor_list": ["2019KPL春季赛"] }],
  "slogan": "永恒荣耀，不灭星辰"
}
```

- `team_id` 以 kpl.qq.com 的赛季战队 ID 为准（含改名史，如 QGhappy→狼队，需建别名表）。

### Player（主档）

```json
{
  "player_id": "EB48CF52432EABB8A847A1EA8CA6C7F8",
  "name": "762",
  "real_name": "",
  "aliases": [],
  "positions": ["对抗路"],
  "kpl_player_id": "60012xxx"
}
```

- `player_id`：smoba 的 openid（跨赛季稳定）；
- `kpl_player_id`：kpl.qq.com 的选手 ID，经 (name, team, era) 映射表对齐，人工抽样校验。

### PlayerSeasonStat

```json
{
  "player_id": "EB48...",
  "season_id": "KPL2019S1",
  "team_id": "KPL2019S1_estar",
  "position": "对抗路",
  "games": 66,
  "win_rate": 0.5758,
  "avg_kda": 5.34,
  "avg_kill": 3.11,
  "avg_death": 1.56,
  "avg_assist": 4.42,
  "avg_gold": 12765,
  "avg_gpm": 700.1,
  "avg_dpm": 22926,
  "mvp_count": 0,
  "rating": 86,
  "rating_components": { "stats": 74.2, "honor": 11.8 }
}
```

- `team_id` 为该赛季真实归属，由 battle 首发阵容反推（接口的 team_name 是当前名，不可直接信）。

### Match / Battle

```json
{
  "match_id": "2026052301",
  "season_id": "KCC2026",
  "stage": "决赛",
  "round": 0,
  "team_a": "KPL2026S2_ag",
  "team_b": "KPL2026S2_qghappy",
  "score_a": 3,
  "score_b": 5,
  "bo": 9,
  "date": "2026-05-23",
  "winner": "KPL2026S2_qghappy",
  "battles": [
    {
      "seq": 1,
      "winner": "KPL2026S2_ag",
      "duration_min": 18.7,
      "players": [
        { "player_id": "60011991", "hero_id": 120, "hero_name": "白起", "kills": 2, "deaths": 3, "assists": 5, "is_mvp": 0 }
      ]
    }
  ]
}
```

## 3. 赛制结构（formats.json，数据驱动）

每赛季一份结构配置，模拟引擎只实现 4 种原语：

- `round_robin`：分组循环（组别 S/A/B、单循环、BO 数）；
- `play_in`：卡位赛（升降级对阵）；
- `single_elim`：单败淘汰（树）；
- `double_elim`：双败淘汰（胜者组/败者组树）。

```json
{
  "season_id": "KPL2021S2",
  "regular": {
    "type": "round_robin",
    "groups": ["S", "A", "B"],
    "rounds": 2,
    "bo": 5
  },
  "play_in": { "type": "play_in", "bo": 5 },
  "playoffs": { "type": "double_elim", "bo": 7 },
  "final": { "type": "best_of", "bo": 7 }
}
```

从官方赛程数据自动重建：按 stage 名与对阵关系推断分组、轮次与淘汰树；无法自动推断的赛季人工标注一次后固化。

## 4. 评分模型 v2（无历史荣誉，分路差异化权重）

```text
rating = 50 + 49 × Σ(分路权重 × 分赛季×分位置百分位) × 出场对数折扣
出场折扣 = min(1, log(1+场次) / log(21))   # 5场≈0.59，20场及以上=1
```

- 归一化：每个指标在"同赛季+同位置"内取百分位，消除时代与版本偏差、抗极端值；
- 分路权重（依据 KPL 各分路职责与社区数据讨论整理，可配置）：

| 分路 | 指标权重 |
|---|---|
| 对抗路 | 承伤占比 25 / 输出占比 20 / 击杀 20 / 参团 15 / KDA 10 / 推塔 10 |
| 打野 | 击杀 30 / 参团 20 / KDA 15 / 经济占比 15 / 输出占比 10 / 推塔 10 |
| 中路 | 伤害转化 25 / 输出占比 20 / 参团 15 / 击杀 15 / KDA 15 / 分均经济 10 |
| 发育路 | 经济占比 25 / 输出占比 25 / 击杀 20 / KDA 15 / 参团 15 |
| 游走 | 参团 35 / 承伤占比 25 / 助攻 20 / KDA 15 / 推塔 5 |

**产品原则（已确认）**：历史冠亚季军不进入战力，也不在选手库中展示；模拟结果里的冠军仍是玩法目标，但那是输出不是输入。

同一选手在不同赛季有不同 rating（状态随赛季起伏），组队时以所选战场的"当赛季评分"为基准，跨时期组队各选手取各自巅峰赛季值（细节在引擎阶段定）。

## 5. 英雄与战报素材（叙事层）

- `heroes.json`：位置原型 → 常用英雄名池（对抗/打野/中路/发育路/游走各 15–20 个），模拟选英雄时按位置与权重抽取；MVP 不绑定真实选人，后续可用 battle 真实数据替换。
- `narrative_templates.json`：小局战报模板片段，分四段——开局（换边/体系克制）、事件（龙团/抢龙/团战/推塔）、终结（平推/翻盘/点水晶）、比分。事件槽位填入模拟结果（选手名、队伍名、英雄、时间、比分），片段可自由组合。
- 示例片段：

```text
双方换边，红方{team}用一套{comp}克制蓝方{opp}的{hero}
{minute}分钟龙团{team}.{player}抢到{objective}，不再彷徨
{team}平推水晶，目前比分{team}{score_a}:{score_b}{opp}
```

## 6. 命名与关联规则

1. 主键优先：选手用 openid，战队用 kpl.qq.com 赛季 team_id，赛季用 cc_league_id；
2. 跨源映射表（smoba openid ↔ kpl playerid ↔ 选手名）为人工校验过的静态文件，不自动猜测；
3. 所有 processed 数据顶层带 `schema_version` 与 `data_version`，前端按版本缓存。
