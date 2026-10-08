'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/js/ui.js'), 'utf8');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'app/data/official_rosters.json'), 'utf8'));
const ctx = {
  POS_ORDER: ['对抗路', '打野', '中路', '发育路', '游走'], PRESET_SEASONS: [],
  currentTeamData: null,
  D: {seasonRoster() { throw new Error('Registered squad fell back to old roster'); }},
};
vm.createContext(ctx);
for (const name of ['presetRoster(fid)', 'presetRosterFromData(fid, data)']) {
  const start = source.indexOf('  function ' + name);
  const end = source.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), ctx);
}
for (const team of doc.teams) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'app/data/teams', team.franchiseId + '.json'), 'utf8'));
  ctx.currentTeamData = data;
  const registered = new Set(team.players.map(p => p.playerId));
  for (const slots of [ctx.presetRoster(team.franchiseId), ctx.presetRosterFromData(team.franchiseId, data)]) {
    assert.equal(slots.length, 5, team.name);
    assert.equal(new Set(slots.map(s => s.pid)).size, 5, team.name);
    assert.ok(slots.every(s => registered.has(s.pid)), team.name + ' selected departed player');
    assert.ok(slots.every(s => s.sid !== doc.seasonId), 'Invented annual statistics');
  }
}
console.log('Annual default squads passed: 12 teams × classic/all-star; only registered players, real source versions.');
