/* Verify that every rotating daily challenge is a complete, playable preset. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const data = readJson('app/data/dynasties.json').dynasties || [];
const ui = fs.readFileSync(path.join(ROOT, 'app/js/ui.js'), 'utf8');
const positions = new Set(['对抗路', '打野', '中路', '发育路', '游走']);
const storyBuckets = ['opening', 'victory', 'defeat', 'final', 'champion', 'runnerup', 'eliminated'];
const storyLines = [];

for (const marker of ['dynastyStoryLine', '专属篇章', '专属终章', 'storyOutcome', 'renderResultStory', 'STATE.dynasty = null']) {
  if (!ui.includes(marker)) throw new Error(`daily challenge UI hook missing: ${marker}`);
}

if (data.length < 5) throw new Error(`daily challenge needs at least 5 presets, got ${data.length}`);
for (const preset of data) {
  if (!preset.theme || !preset.era_season || preset.players.length !== 5) {
    throw new Error(`${preset.id}: incomplete daily challenge metadata`);
  }
  for (const bucket of storyBuckets) {
    if (!preset.story || !Array.isArray(preset.story[bucket]) || preset.story[bucket].length < 2) {
      throw new Error(`${preset.id}: story bucket ${bucket} needs at least two lines`);
    }
    storyLines.push(...preset.story[bucket]);
  }
  if (new Set(preset.players.map((player) => player.player_id)).size !== 5) {
    throw new Error(`${preset.id}: duplicate players`);
  }
  const roles = new Set();
  for (const player of preset.players) {
    const versionSeason = readJson(`app/data/seasons/${player.season_id}.json`);
    const records = versionSeason.rosters.filter((record) =>
      record.player_id === player.player_id && record.team_franchise === preset.team_fid && (record.games || 0) >= 5
    );
    if (!records.length) throw new Error(`${preset.id}: ${player.player_id} has no playable season record`);
    records.forEach((record) => { if (positions.has(record.position)) roles.add(record.position); });
  }
  if (roles.size !== 5) throw new Error(`${preset.id}: does not cover all five positions`);
}

if (new Set(storyLines).size !== storyLines.length) {
  throw new Error('daily challenge stories contain duplicate lines');
}

console.log(`Daily challenge verification passed: ${data.length} presets and ${storyLines.length} exclusive story lines.`);
