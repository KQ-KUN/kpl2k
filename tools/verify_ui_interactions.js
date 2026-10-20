'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/js/ui/roster.js'), 'utf8');
function fixture() {
  const pending = [];
  const elements = { 'team-slots': { innerHTML: '', querySelectorAll:()=>[] }, 'btn-confirm-team': { disabled: false } };
  const ctx = {
    STATE: { team: 'A', roster: ['preserved'] }, PRESET_SEASONS: [], POS_ORDER: [], teamViewRequest: 0, currentTeamData: null,
    $: id => elements[id] || (elements[id]={style:{},textContent:'',innerHTML:''}),
    strengthOf:()=>[0,{raw:50}],
    D: { loadSeason: () => Promise.resolve(), loadTeam: id => new Promise((resolve, reject) => pending.push({ id, resolve, reject })) },
    presetRoster: id => [id], saveState() {}, renderSlots() {}, renderStrength() {}, esc: String
  };
  const window={};
  vm.runInNewContext(source,{window});
  Object.assign(ctx,window.KPL_UI_MODULES.roster(ctx));
  return { ctx, pending, elements };
}
const settle = () => new Promise(setImmediate);
(async () => {
  for (const staleFails of [false, true]) {
    const { ctx, pending, elements } = fixture();
    ctx.loadTeamView('A');
    assert.equal(elements['btn-confirm-team'].disabled, true);
    ctx.STATE.team = 'B'; ctx.loadTeamView('B');
    pending[1].resolve({ id: 'B' }); await settle();
    const content = elements['team-slots'].innerHTML;
    if (staleFails) pending[0].reject(new Error('old request'));
    else pending[0].resolve({ id: 'A' });
    await settle();
    assert.equal(ctx.currentTeamData.id, 'B');
    assert.equal(ctx.STATE.roster[0], 'preserved');
    assert.equal(elements['team-slots'].innerHTML, content);
    assert.equal(elements['btn-confirm-team'].disabled, false);
  }
  const { ctx, pending, elements } = fixture();
  ctx.loadTeamView('A');
  pending[0].reject(new Error('offline')); await settle();
  assert.equal(elements['btn-confirm-team'].disabled, true);
  assert.match(elements['team-slots'].innerHTML, /offline/);
  console.log('UI loading checks passed: stale success, stale failure, current failure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
