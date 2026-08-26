# KPL Weekly Best Rating Audit Tech Spec

## Goal

Use official KPL weekly and seasonal honors as an external calibration set for 2026 player ratings, while preserving the existing position-specific statistical model.

## Evidence

- KPL's published seasonal selection method combines damage, damage taken, development, economy usage, survival, teamwork, highlights, and team contribution. The local model covers most box-score dimensions but cannot fully reconstruct highlights or team contribution.
- 2026 Spring official weekly lineups include Daozai in weeks 2 and 6. The final first team includes Wuyan, Juhao, Liulang, Daozai, and Yisheng; the second team includes Qingqing, Nuanyang, Qingrong, Xiaoyu, and Xin.
- 2026 Summer official weekly lineups through week 8 include repeated selections for Daozai, Qingqing, and Xiaoxue. Several selected players currently remain below the expected upper-middle band.

Sources used for the audit:

- https://www.sina.cn/news/detail/5259669540178032.html
- https://www.sina.cn/news/detail/5272353119405863.html
- https://www.sina.cn/news/detail/5290502703288637.html
- https://www.sina.cn/news/detail/5291231245502085.html
- https://www.sina.cn/news/detail/5320913089987445.html
- https://sina.cn/news/detail/5328163228093711.html

## Decision

Do not change global position weights. The low ratings span top, jungle, mid, marksman, and support, while other players in the same positions already score correctly. This is evidence of a missing honor/highlight signal, not a shared metric-weight defect.

Apply narrow season overrides to players whose official recognition is materially inconsistent with the current score. Preserve ordinary statistical ratings for players with only one isolated weekly selection unless their score falls below the upper-middle band.

## Acceptance Criteria

1. 2026 Spring first-team players are at least 90 after all adjustments; second-team players are at least 87.
2. Xuanran's 2026 Spring and Summer versions are at least 85 and 84 respectively.
3. Daozai's 2026 Spring and Summer versions are at least 92.
4. Repeated 2026 Summer weekly selections Qingqing and Xiaoxue are at least 89 and 91 respectively.
5. Single-week 2026 Summer selections audited as low are at least 83, without raising unaffected players.
6. Existing rating, player-version, engine, and release checks pass.
7. No browser-based manual interaction is required for verification.
