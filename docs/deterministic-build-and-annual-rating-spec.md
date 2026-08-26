# Deterministic Avatars and Annual Ratings Tech Spec

## Goal

Make generated team avatars reproducible and use one player rating per calendar year across the player library and every event in that year.

## Decisions

- Team avatar output is ordered by team ID and encoded with explicit image and JSON settings.
- The exact Pillow version remains pinned in `requirements.txt` because resizing is part of the generated artifact.
- A player's annual rating is the highest post-calibration rating from an official battlefield season in that year.
- That annual rating is copied to every event record for the same player and year. Event statistics, roles, teams, and roster membership remain event-specific.
- The player library labels annual cards as annual peak ratings and explains that events in the same year reuse the value.

## Acceptance Criteria

1. Two consecutive avatar builds produce the same SHA-256 hash.
2. Avatar keys are serialized in team-ID order.
3. Every player has one rating per year once an official battlefield rating exists for that year.
4. Player-library annual ratings equal the ratings used by event roster data.
5. The player library visibly explains the annual-rating rule.
6. The complete automated release gate passes without browser interaction.
