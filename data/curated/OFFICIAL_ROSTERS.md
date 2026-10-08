# 2026 KPL 年度总决赛注册名单

`official_rosters_2026_annual.json` 转录自 KPL 官方 2026-09-21 公布的完整名单原图，2026-10-08 与两套官方选手统计 API 交叉核对。原公告、两组原图地址保存在文件内。名单包含大师组与精英组共 12 队，每队 7 人，包含轮换、替补与租借选手。赛事 ID 为 `KPL2026S3`。

身份优先使用已有 canonical ID；同名小寒通过金书瀚及官方身份对应到 `6677ABCD70AC1CC2D69832F12798F166`。新增小团、月月使用官方 smoba `openid`。月秋（赵浩伟）在已公开统计接口中尚无身份，暂用 `REGISTERED_EDGM_ZHAOHAOWEI` 的隔离注册身份；未来获得官方 ID 后须按实名、注册队伍和来源证据审查迁移，禁止自动按昵称合并。

`python tools/official_rosters.py` 只同步当前注册归属及应用快照，不改写历史比赛。`build_player_library.py` 和 `build_web.py` 同样读取此来源，后续重建不会丢失更新。Link 由 `build_link_graph.py` 读取同一名单，同队注册关系保留公告来源。

2K 选手库历史卡仍属于当时效力的战队。新队选人列表可以引用注册选手已有的 2026 年比赛版本，`registration_reference` 标识引用，`source_team_fid/name` 和版本标签保留实际数据所在队。统计、赛季 ID、评分均保留原值；没有有效版本的注册替补不生成虚构卡片。年总仍进行中，本次不会创建冠军、最终结果或新模拟战场。

验证：`python -m unittest tools.test_official_rosters`；在工作区具备 Link 快照时，另运行 `python -m unittest tools.test_link_graph` 和 `python tools/validate_link_graph.py`。
