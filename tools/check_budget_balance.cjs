/* 用实际赛事引擎复测金币模式：node tools/check_budget_balance.cjs [抽池数] [每池种子数] [固定加成] [选人策略：rating|band|price] */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'app', 'data', file), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'app', 'js', 'engine.js'), 'utf8'));
const engine = globalThis.KPL_ENGINE;
const base = read('base.json');
const current = read('seasons/KPL2026S2.json');
const history = read('budget_pairs.json');
const positions = engine.POSITIONS;
const bands = [[22, 32], [18, 25], [16, 23], [13, 20], [10, 17]];
const seasons = ['KPL2024S2', 'KPL2025S1', 'KPL2025S3', 'KPL2026S1', 'KPL2026S2', 'KCC2026'];
const teams = ['10017', '10001', '10027']; // TTG、狼队、AG
const pools = Number(process.argv[2] || 30);
const seeds = Number(process.argv[3] || 4);
const playerBoost = process.argv[4] == null ? 5 : Number(process.argv[4]);
const strategy = process.argv[5] || 'rating';
if (!Number.isInteger(pools) || pools < 1 || !Number.isInteger(seeds) || seeds < 1) throw new Error('抽池数和种子数须为正整数');
if (!['rating', 'band', 'price'].includes(strategy)) throw new Error('选人策略须为 rating、band 或 price');

let state = 246813579;
function random() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 4294967296;
}
const randint = n => Math.floor(random() * n);
const byPosition = positions.map(position => current.rosters
  .filter(record => record.position === position && record.games >= 5)
  .sort((a, b) => b.rating - a.rating));

function draw() {
  return byPosition.map(records => bands.map(([low, high], tier) => {
    const start = Math.floor(records.length * tier / 5);
    const end = Math.max(start + 1, Math.floor(records.length * (tier + 1) / 5));
    return { record: records[start + randint(end - start)], price: low + randint(high - low + 1) };
  }));
}

function select(pool, chem) {
  let best = null, bestScore = -Infinity, affordable = 0;
  for (let code = 0; code < 3125; code++) {
    let n = code;
    const chosen = pool.map(column => {
      const item = column[n % 5];
      n = Math.floor(n / 5);
      return item;
    });
    const cost = chosen.reduce((sum, item) => sum + item.price, 0);
    if (cost > 100) continue;
    affordable++;
    const records = chosen.map(item => item.record);
    const duo = engine.budgetDuoBonus(records, history);
    const approx = strategy === 'band'
      ? records.map(record => ({ ...record, rating: Math.round(record.rating / 10) * 10 }))
      : records;
    const score = strategy === 'price' ? cost + duo.bonus * 2 : engine.teamStrength(approx, chem) + duo.bonus;
    if (score > bestScore) {
      bestScore = score;
      best = { records, cost, duo };
    }
  }
  return { best, affordable };
}

const names = engine.franchiseNames(base.franchises);
const report = [];
for (const seasonId of seasons) {
  const battle = read(`seasons/${seasonId}.json`);
  const sourceRecords = seasonId === 'KPL2026S2' ? current.rosters : current.rosters.concat(battle.rosters);
  const chem = engine.buildChem(sourceRecords, {
    KPL2026S2: current.pair_win || {},
    [seasonId]: battle.pair_win || {},
  }, base.players);
  const rosters = {};
  for (const record of battle.rosters) {
    if (record.games < 5) continue;
    (rosters[record.team_franchise] ||= []).push(record);
  }
  for (const records of Object.values(rosters)) records.sort((a, b) => b.rating - a.rating);
  let wins = 0, winsWithoutDuo = 0, total = 0, duoChoices = 0, cappedChoices = 0;
  let strengthSum = 0, duoSum = 0;
  for (let p = 0; p < pools; p++) {
    const { best, affordable } = select(draw(), chem);
    if (!best || !affordable) throw new Error('生成了无法组齐五人的候选池');
    if (best.duo.pairs.length) duoChoices++;
    if (best.duo.bonus === 5) cappedChoices++;
    duoSum += best.duo.bonus;
    strengthSum += engine.teamStrength(best.records, chem) + best.duo.bonus;
    for (const team of teams) {
      for (let j = 0; j < seeds; j++) {
        const result = engine.simulateSeason({
          season_id: seasonId, formats: { [seasonId]: battle }, rosters,
          rng: engine.makeRng(3000000 + p * seeds + j), names,
          tpl: base.narrative.templates, chem, track: team,
          override_rosters: { [team]: best.records }, players: base.players,
          tactic: 'balanced', player_boost: playerBoost, budget_duos: history,
        });
        if (result.champion === team) wins++;
        const withoutDuo = engine.simulateSeason({
          season_id: seasonId, formats: { [seasonId]: battle }, rosters,
          rng: engine.makeRng(3000000 + p * seeds + j), names,
          tpl: base.narrative.templates, chem, track: team,
          override_rosters: { [team]: best.records }, players: base.players,
          tactic: 'balanced', player_boost: playerBoost,
        });
        if (withoutDuo.champion === team) winsWithoutDuo++;
        total++;
      }
    }
  }
  report.push({ season: battle.name, strategy, wins, winsWithoutDuo, total,
    rate: +(wins / total * 100).toFixed(1), withoutDuoRate: +(winsWithoutDuo / total * 100).toFixed(1),
    duoChoices, cappedChoices, pools, avgDuoBonus: +(duoSum / pools).toFixed(1),
    avgStrength: +(strengthSum / pools).toFixed(1) });
}
console.log(JSON.stringify(report, null, 2));
