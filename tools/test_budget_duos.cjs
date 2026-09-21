const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(root, 'app/js/engine.js'), 'utf8'));
const engine = globalThis.KPL_ENGINE;
const players = JSON.parse(fs.readFileSync(path.join(root, 'app/data/base.json'), 'utf8')).players;
const history = JSON.parse(fs.readFileSync(path.join(root, 'app/data/budget_pairs.json'), 'utf8'));
const byName = Object.fromEntries(Object.entries(players).map(([id, player]) => [player.name.toLowerCase(), id]));
const record = name => ({ player_id: byName[name.toLowerCase()] });

const ag = engine.budgetDuoBonus([record('一诺'), record('钟意')], history);
const wolves = engine.budgetDuoBonus([record('Fly'), record('小胖')], history);
assert.equal(ag.pairs[0].seasons, 10);
assert.equal(ag.bonus, 3);
assert.equal(wolves.pairs[0].seasons, 6);
assert.equal(wolves.bonus, 2.8);
assert.equal(engine.budgetDuoBonus([record('一诺'), record('Fly')], history).bonus, 0);
assert.ok(engine.budgetDuoBonus(Object.keys(players).slice(0, 120).map(id => ({ player_id: id })), history).bonus <= 5);
console.log('历史搭档识别、无关组合与上限：通过');
