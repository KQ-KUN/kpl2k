/* 从现有赛季分片提取金币模式可抽选手的历史同队搭档。 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const seasonsDir = path.join(root, 'app', 'data', 'seasons');
const current = JSON.parse(fs.readFileSync(path.join(seasonsDir, 'KPL2026S2.json'), 'utf8'));
const eligible = new Set(current.rosters.filter(r => r.games >= 5).map(r => r.player_id));
const pairs = {};

for (const file of fs.readdirSync(seasonsDir).filter(name => name.endsWith('.json')).sort()) {
  const season = JSON.parse(fs.readFileSync(path.join(seasonsDir, file), 'utf8'));
  const teams = {};
  for (const record of season.rosters || []) {
    if ((record.games || 0) < 20 || !eligible.has(record.player_id)) continue;
    (teams[record.team_franchise] ||= []).push(record.player_id);
  }
  for (const players of Object.values(teams)) {
    const ids = [...new Set(players)].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        pairs[key] = (pairs[key] || 0) + 1;
      }
    }
  }
}

const output = path.join(root, 'app', 'data', 'budget_pairs.json');
fs.writeFileSync(output, JSON.stringify({ source: '同一赛季、同一俱乐部，双方各至少出场20局', pairs }) + '\n');
console.log(`生成 ${path.relative(root, output)}：${Object.keys(pairs).length} 组搭档`);
