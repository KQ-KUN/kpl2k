# Strength System Fix Tech Spec

## Goal

Fix deterministic strength-calculation errors without changing the shipped rules copy or unrelated experience-balancing behavior.

## Scope

1. Browser teammate synergy uses the same canonical player-pair key when storing and reading pairs.
2. Browser and Python simulations use the same base strength noise (`3.4`).
3. A missing rating metric contributes the neutral 50th percentile instead of redistributing its weight to the remaining metrics.
4. Existing UI rules copy and unrelated balancing behavior remain unchanged.

## Acceptance Criteria

- Reversing two players in a lineup does not change teammate synergy.
- A 30-game teammate pair contributes `0.8` synergy in the browser engine.
- Every rated canonical-position record with rating components contains every metric for that position.
- `python tools/verify_release.py` exits with code 0.
