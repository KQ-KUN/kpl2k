# All-Star Mode Product and Technical Specification

## Goal

Add a direct exhibition mode where the player builds two five-player lineups from the existing KPL player database and simulates one BO3, BO5, or BO7 series.

## User flow

1. Enter from the existing All-Star Mode card on the home page.
2. Pick a default franchise for the red side and blue side. Each choice immediately fills the five position slots with that franchise's current preset lineup.
3. Replace any slot with any matching-position player and historical version from the existing player database.
4. Optionally create a custom identity by entering a name, choosing a male/female Origin Child default portrait or uploading and cropping an avatar, and selecting an existing professional version as the ability template.
5. Select BO3, BO5, or BO7 and start the match.
6. Read the same game-by-game narration used by Classic Mode, then view the result using the existing result-card visual language and player-stat table.

## Data contract

- Professional slots reuse existing `player_id`, representative `season_id`, position, rating, statistics, avatar, and franchise data.
- The web build creates one global All-Star index by merging the existing team shards; it does not create or recalculate player ratings.
- A custom slot receives a unique local ID. Its simulation record is cloned from the selected professional version, while only its displayed name and avatar are replaced.
- Uploaded avatars can be dragged, zoomed, and cropped in a native canvas editor, then are resized in the browser and stored locally. They are never uploaded to a server.
- Team strength remains part of match simulation but is intentionally hidden from the All-Star setup UI.

## Scope

- Exactly two sides and five fixed positions per side: Clash Lane, Jungle, Mid Lane, Farm Lane, and Roamer.
- Default side names are derived from the selected franchises.
- A professional player or custom identity cannot occupy more than one of the ten active slots.
- Chemistry continues to use the existing engine. Cross-era records without shared history naturally receive no teammate chemistry bonus.
- All-Star results are saved locally and can be replayed with a new random seed. Link sharing is excluded because local avatar data cannot be reconstructed on another device.
- Classic Mode routes, season simulation, history restoration, and share links remain unchanged.

## Acceptance criteria

- The home-page All-Star card is enabled and routes to `#/allstar`.
- Selecting a default franchise fills all five slots on that side; changing the franchise resets only that side.
- Each slot picker lists matching-position players from all existing franchise/version data and exposes version selection.
- A valid custom name, image, and ability template creates a usable custom player without changing the template's rating or statistics.
- The start button remains disabled until both sides contain five unique valid slots.
- BO3 ends at two wins, BO5 at three wins, and BO7 at four wins.
- The simulation page renders the existing narration format, including game MVP lines and peak-match wording where applicable.
- The result page shows the winner, score, both lineups, and ten-player match statistics with the existing card/table styling.
- A mobile viewport fits without horizontal page overflow; the player-stat table may scroll inside its existing container.
- Existing Classic Mode smoke checks still pass.
