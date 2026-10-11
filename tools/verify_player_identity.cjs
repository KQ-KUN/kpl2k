const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const load = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const yi = '9A3E415711EF5EB63681FC4048C8B3A7';
const ag = 'FEC77937DF7DD29C1BEAE6DE2456AFF3';
const players = load('data/processed/players.json').players;
assert.equal(players.find((p) => p.player_id === 'WP26473').real_name, '黄捷');
assert.equal(players.find((p) => p.player_id === ag).real_name, '殷家宝');
const stats = load('data/processed/player_season_stats.json').records;
assert.equal(stats.filter((r) => r.player_id === ag).reduce((sum, r) => sum + r.games, 0), 173);
assert.equal(stats.filter((r) => r.player_id === yi).reduce((sum, r) => sum + r.games, 0), 275);
for (const [team, position] of [['10027', '对抗路'], ['10601', '对抗路'], ['10010', '游走']]) {
  const card = load(`app/data/teams/${team}.json`).players.find((p) => p.player_id === yi);
  assert.deepEqual(card.positions, [position]);
  assert.ok(card.versions.every((v) => v.position === position));
}
console.log('Weiyang identity separation and YiAn historical role checks passed.');
