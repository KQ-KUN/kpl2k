# Narrative System Audit and Expansion

## Goal

Make match stories feel like a live KPL broadcast without allowing decorative language to contradict the actual format, score, player lineup, or match state.

## Scope

- Match format: regular season, play-in, single elimination, double elimination, playoffs, finals, and peak duel.
- Score state: sweep, close series, deciding game, comeback, reverse sweep, elimination, runner-up, and champion.
- Match flow: draft, opening, objectives, rotations, team fights, high-ground defense, and finish.
- People: player highlights, role-aware actions, rivalry meetings, MVP, disappointment, and championship moments.
- Tone: live technical calls, restrained poetic lines, and a small number of verified classic KPL echoes.

## Content Rules

1. A score-specific phrase may only appear when the simulated score proves it.
2. A deciding-game phrase must work for BO3, BO5, BO7, and BO9; do not call every deciding game a “game seven”.
3. Peak-duel wording is reserved for a full BO7/BO9 final game.
4. Player-specific lines only trigger when that player is in the current roster.
5. Original poetic copy must describe the current scene instead of imitating or attributing a real commentator.
6. Verified classic lines are short echoes, not long reproductions; no invented attribution.
7. Do not use appearance attacks, health insults, match-fixing claims, or hostile fan nicknames as neutral narration.
8. Browser and Python fallback engines use the same score semantics.

## Acceptance Criteria

- No random “reverse sweep”, “five-game battle”, “game seven”, or exact sweep-count phrase can appear under an incompatible score.
- Comeback lines distinguish tying the series from winning it.
- Every template placeholder is supported by its consumer and no placeholder leaks into rendered copy.
- At least three narration beats are generated per game in the browser and Python fallback engines.
- Text pools gain new draft, opening, objective, team-fight, ending, score, finals, champion, runner-up, player, and rivalry variants.
- JSON parses, web data rebuild succeeds, and seeded BO3/BO5/BO7/BO9 checks pass.
- The rendered local page loads the rebuilt narrative data without console errors.

## Research Direction

KPL’s strongest commentary usually combines three layers: precise description of the current play, emotional interpretation of the score, and a short image that belongs to the moment. Research sources are used to identify that structure. New in-game writing remains original except for a few short, verified echoes such as “谁能横刀立马” or “谁说今年东强西弱”.

## Research Sources

- KPL official Bilibili classic commentary compilation: https://www.bilibili.com/video/BV1oT4y1w7XT/
- Sina Sports profile of Li Jiu and his commentary preparation: https://k.sina.cn/article_6526217622_184fe2d9602000ubk0.html
- KPL official Weibo discussion of the meaning of the “golden rain”: https://www.sina.cn/news/detail/5231478780202227.html
