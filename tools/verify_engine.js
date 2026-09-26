/* Deterministic release probe for every browser-engine season. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'app/js/engine.js'), 'utf8'), { filename: 'engine.js' });
const E = globalThis.KPL_ENGINE;
const manifest = readJson('app/data/manifest.json');
const base = readJson('app/data/base.json');
const names = E.franchiseNames(base.franchises);
const seeds = [1, 97, 20260825];

E.POSITIONS.forEach((role) => {
  if (!base.narrative.templates.role_events || (base.narrative.templates.role_events[role] || []).length < 3) {
    throw new Error(`missing role-aware narration for ${role}`);
  }
});

function fail(message) {
  throw new Error(message);
}

const pairProbe = [
  { player_id: 'Z', season_id: 'PAIR_TEST', team_franchise: 'T', position: '对抗路', games: 30, rating: 80 },
  { player_id: 'A', season_id: 'PAIR_TEST', team_franchise: 'T', position: '打野', games: 30, rating: 80 }
];
const pairChem = E.buildChem(pairProbe, {}, {});
const pairForward = E.lineupStrength(pairProbe, pairChem, E.COMPRESS)[1].synergy;
const pairReverse = E.lineupStrength(pairProbe.slice().reverse(), pairChem, E.COMPRESS)[1].synergy;
if (pairForward !== 0.8 || pairReverse !== pairForward) {
  fail(`teammate synergy key is order-dependent: forward=${pairForward}, reverse=${pairReverse}`);
}

function validateTree(sid, seed, tree, champion) {
  if (!champion) fail(`${sid} seed ${seed}: missing champion`);
  let finals = 0;
  tree.forEach((row, index) => {
    if (!row || !row.done) return;
    if (!row.a || !row.b || row.a === '待定' || row.b === '待定' || row.a === '?' || row.b === '?') {
      fail(`${sid} seed ${seed}: unresolved completed match #${index + 1}`);
    }
    if (row.a === row.b) fail(`${sid} seed ${seed}: duplicate opponents in match #${index + 1}`);
    const sa = Number(row.sa), sb = Number(row.sb);
    const target = Math.floor(Number(row.bo || 1) / 2) + 1;
    if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa === sb || Math.min(sa, sb) < 0 || Math.max(sa, sb) !== target || Math.min(sa, sb) >= target) {
      fail(`${sid} seed ${seed}: illegal score ${row.sa}:${row.sb}`);
    }
    const scoreWinner = sa > sb ? row.a : row.b;
    if (scoreWinner !== row.w) fail(`${sid} seed ${seed}: winner/score mismatch in match #${index + 1}`);
    if (row.round === '总决赛') finals += 1;
  });
  if (finals > 1) fail(`${sid} seed ${seed}: ${finals} grand finals`);
  if (tree.length && !tree.some((row) => row.w === champion)) fail(`${sid} seed ${seed}: champion absent from tree`);
}

manifest.seasons.forEach((item) => {
  const sid = item.season_id;
  const format = readJson(`app/data/seasons/${sid}.json`);
  const rosters = {};
  (format.rosters || []).forEach((record) => {
    if ((record.games || 0) < 5) return;
    (rosters[record.team_franchise] ||= []).push(record);
  });
  Object.values(rosters).forEach((records) => records.sort((a, b) => (b.rating || 0) - (a.rating || 0)));
  const pairWin = {}; pairWin[sid] = format.pair_win || {};
  const chem = E.buildChem(format.rosters || [], pairWin, base.players);

  seeds.forEach((seed) => {
    const formats = {}; formats[sid] = format;
    const session = E.createSession({
      season_id: sid, formats, rosters, rng: E.makeRng(seed), names,
      tpl: base.narrative.templates, chem, players: base.players, track: null
    });
    if (!session) fail(`${sid}: session creation failed`);
    let stage, steps = 0;
    do {
      stage = session.next();
      steps += 1;
      if (steps > 5000) fail(`${sid} seed ${seed}: session did not finish`);
    } while (!stage || stage.kind !== 'done');
    validateTree(sid, seed, session.getTree ? session.getTree() : [], stage.champion || session.getChampion());
  });
});

// 旧赛事使用 10403、现行入口使用 10903，二者都是情久；跨版本参赛时只能占一个席位。
{
  const sid = 'KCC2023';
  const format = readJson(`app/data/seasons/${sid}.json`);
  const track = '10903';
  const oldId = '10403';
  const roster = E.POSITIONS.map((position, index) => ({
    player_id: `QJ${index}`, season_id: sid, team_franchise: track,
    position, games: 20, rating: 75
  }));
  const rosters = {};
  (format.rosters || []).forEach((record) => {
    if ((record.games || 0) >= 5) (rosters[record.team_franchise] ||= []).push(record);
  });
  const formats = {}; formats[sid] = format;
  const session = E.createSession({
    season_id: sid, formats, rosters, rng: E.makeRng(20260830), names,
    tpl: base.narrative.templates, chem: E.buildChem(format.rosters || [], {}, base.players),
    players: base.players, track, override_rosters: { [track]: roster }
  });
  let stage, steps = 0;
  do {
    stage = session.next();
    if (++steps > 5000) fail('QingJiu alias probe did not finish');
  } while (!stage || stage.kind !== 'done');
  const tree = session.getTree();
  if (!tree.some((row) => row.a === track || row.b === track)) fail('current QingJiu did not inherit the historical slot');
  if (tree.some((row) => row.a === oldId || row.b === oldId)) fail('old and current QingJiu IDs both remained in the bracket');
  console.log('QingJiu alias regression passed: 10403 -> 10903.');
}

// 金币模式应保留爆冷机会，同时让认真选出的强阵容明显优于最弱五人组。
{
  const current = readJson('app/data/seasons/KPL2026S2.json');
  const prices = [27, 22, 19, 16, 14];
  const candidates = E.POSITIONS.map((position) => {
    const ranked = current.rosters.filter((record) => record.position === position && record.games >= 5)
      .sort((a, b) => b.rating - a.rating);
    return prices.map((price, tier) => ({ record: ranked[Math.floor(ranked.length * tier / 5)], price }));
  });
  const weakestRoster = candidates.map((column) => column[4].record);
  const duoHistory = readJson('app/data/budget_pairs.json');
  function strongestAffordable(chem) {
    let best = null, bestScore = -Infinity;
    for (let code = 0; code < 3125; code++) {
      let n = code;
      const choice = candidates.map((column) => { const item = column[n % 5]; n = Math.floor(n / 5); return item; });
      if (choice.reduce((sum, item) => sum + item.price, 0) > 100) continue;
      const roster = choice.map((item) => item.record);
      const score = E.teamStrength(roster, chem) + E.budgetDuoBonus(roster, duoHistory).bonus;
      if (score > bestScore) { bestScore = score; best = roster; }
    }
    return best;
  }
  const track = '10027';
  const results = [];
  for (const sid of ['KPL2024S2', 'KPL2025S3', 'KPL2026S2', 'KCC2026']) {
    const format = readJson(`app/data/seasons/${sid}.json`);
    const rosters = {};
    format.rosters.forEach((record) => {
      if (record.games >= 5) (rosters[record.team_franchise] ||= []).push(record);
    });
    Object.values(rosters).forEach((records) => records.sort((a, b) => b.rating - a.rating));
    const options = {
      season_id: sid, formats: { [sid]: format }, rosters, names,
      tpl: base.narrative.templates, track, players: base.players, tactic: 'balanced',
      chem: E.buildChem(sid === 'KPL2026S2' ? current.rosters : current.rosters.concat(format.rosters), {
        KPL2026S2: current.pair_win || {}, [sid]: format.pair_win || {}
      }, base.players), player_boost: 5, budget_duos: duoHistory
    };
    const strongestRoster = strongestAffordable(options.chem);
    let weakWins = 0, strongWins = 0, classicWins = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const weakOptions = { ...options, override_rosters: { [track]: weakestRoster }, rng: E.makeRng(seed) };
      const weakResult = E.simulateSeason({ ...weakOptions, budget_mode: true });
      if (weakResult.champion === track) weakWins++;
      if (E.simulateSeason({ ...options, override_rosters: { [track]: strongestRoster }, budget_mode: true, rng: E.makeRng(seed) }).champion === track) strongWins++;
      if (sid === 'KPL2026S2') {
        if (E.simulateSeason({ ...weakOptions, budget_duos: undefined, rng: E.makeRng(seed) }).champion === track) classicWins++;
        if (seed <= 20) {
          const session = E.createSession({ ...weakOptions, budget_mode: true, rng: E.makeRng(seed) });
          let stage, steps = 0;
          do {
            stage = session.next();
            if (++steps > 5000) fail('budget session did not finish');
          } while (!stage || stage.kind !== 'done');
          if (session.getChampion() !== weakResult.champion) fail(`budget session mismatch at seed ${seed}`);
        }
      }
    }
    if (weakWins > 25 || strongWins < weakWins + 15 || (sid === 'KPL2026S2' && weakWins <= classicWins))
      fail(`budget strategy separation failed in ${sid}: weak ${weakWins}, strong ${strongWins}, classic ${classicWins}`);
    results.push(`${sid}: weak ${weakWins}, strong ${strongWins}`);
  }
  console.log(`Budget strategy probe passed: ${results.join('; ')} (per 100 seeds).`);
}

const placements = {
  '32强': '32强', '16强': '16强', '8强': '8强', '半决赛': '4强',
  '败者组决赛': '季军', '总决赛': '亚军', '常规赛第三轮': '常规赛'
};
Object.entries(placements).forEach(([round, expected]) => {
  const actual = E.placementFromRound(round);
  if (actual !== expected) fail(`placement ${round}: expected ${expected}, got ${actual}`);
});

let tacticProbe = null;
for (let seed = 1; seed <= 5000; seed += 1) {
  const stable = E.playMatch(E.makeRng(seed), { A: 55, B: 50 }, 'A', 'B', 7, 'stable');
  const gamble = E.playMatch(E.makeRng(seed), { A: 55, B: 50 }, 'A', 'B', 7, 'gamble');
  if (stable[0] !== gamble[0] || stable[1] !== gamble[1] || stable[2] !== gamble[2]) {
    tacticProbe = seed;
    break;
  }
}
if (!tacticProbe) fail('strategy variance probe found no deterministic difference');

console.log(`Engine verification passed: ${manifest.seasons.length} seasons × ${seeds.length} seeds; strategy probe seed ${tacticProbe}.`);
