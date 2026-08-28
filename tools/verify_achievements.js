/* Focused regression check for local achievement progress and history repair. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'app/js/ui.js'), 'utf8');
source = source.replace(
  '})(window);',
  'global.__achievementTest = { emptyAchievementProgress, achievementRunKey, reconcileAchievementHistory };\n})(window);'
);

const history = [0, 1, 2, 3].map((index) => ({
  mode: 'classic',
  champ: true,
  savedAt: 1000 + index,
  lastRun: { team: 'A', season: 'S' + index, tactic: 'balanced' }
}));
const store = new Map([['kpl2k_history_v1', JSON.stringify(history)]]);
const context = {
  KPL_ENGINE: {},
  KPL_NARRATIVE: {},
  KPL_DATA: { DATA: { names: { A: 'A' } } },
  localStorage: {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); }
  },
  document: {
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; }
  },
  location: { hash: '', href: 'http://127.0.0.1/' },
  setTimeout() { return 0; },
  clearTimeout() {},
  console
};
context.window = context;
vm.runInNewContext(source, context, { filename: 'ui.js' });

const api = context.__achievementTest;
const progress = api.emptyAchievementProgress();
progress.runs = 2;
progress.championships = 2;
assert.strictEqual(api.reconcileAchievementHistory(progress), true);
assert.strictEqual(progress.runs, 4);
assert.strictEqual(progress.championships, 4);
assert.notStrictEqual(
  api.achievementRunKey({ completedAt: 1001, team: 'A', season: 'S', seed: 7, path: [] }),
  api.achievementRunKey({ completedAt: 1002, team: 'A', season: 'S', seed: 7, path: [] })
);
console.log('Achievement verification passed: history repaired 2 -> 4 and repeated seeds remain distinct.');
