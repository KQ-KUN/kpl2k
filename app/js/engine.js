/* KPL 2K 浏览器端模拟引擎 v1
 *
 * 纯函数，无 DOM 依赖。逻辑与 tools/sim_engine.py 对齐：
 *   常规赛累计战绩 -> 联盟排名（仅剧情）-> 官方种子顺序动态淘汰树 -> 叙事输出
 * 同一 seed 可复现（mulberry32）。
 */
(function (global) {
  'use strict';

  var POSITIONS = ['对抗路', '打野', '中路', '发育路', '游走'];
  var CARRY_POSITIONS = ['发育路', '中路', '打野'];
  var OBJECTIVES = ['暴君', '主宰', '风暴龙王', '暗影暴君', '先知主宰'];
  var K = 0.08;
  var STRENGTH_NOISE = 3.4;
  var COMPRESS = 1.0;
  var SYNERGY_CAP = 4.0;
  var SYNERGY_SCALE = 0.8;
  var PAIR_WIN_MIN = 10;
  var PAIR_WIN_WEIGHT = 6.0;
  var STYLE_PENALTY = 1.5;
  // 玩家队隐蔽加成：模拟的是"玩家亲手操盘"的平行时空，给主队一点正向偏移（不上榜、不显示）
  var PLAYER_BOOST = 5.0;

  /* ---------------- RNG (mulberry32) ---------------- */
  function makeRng(seed) {
    var a = (seed >>> 0);
    function next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      random: next,
      choice: function (arr) {
        if (!arr || !arr.length) return undefined;
        return arr[Math.floor(next() * arr.length)];
      },
      sample: function (arr, n) {
        var pool = arr.slice();
        var out = [];
        n = Math.min(n, pool.length);
        for (var i = 0; i < n; i++) {
          var j = i + Math.floor(next() * (pool.length - i));
          var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
          out.push(pool[i]);
        }
        return out;
      },
      randint: function (lo, hi) {
        return lo + Math.floor(next() * (hi - lo + 1));
      },
      gauss: function (mu, sigma) {
        var u = 0, v = 0;
        while (u === 0) u = next();
        while (v === 0) v = next();
        return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      }
    };
  }

  /* ---------------- 化学 ---------------- */
  function pct(sortedVals, v) {
    if (!sortedVals.length) return 0.5;
    var lo = 0, hi = sortedVals.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (sortedVals[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo / sortedVals.length;
  }

  function buildStyleTags(records) {
    var byPos = {};
    records.forEach(function (r) {
      if (POSITIONS.indexOf(r.position) >= 0 && (r.games || 0) >= 5) {
        (byPos[r.position] = byPos[r.position] || []).push(r);
      }
    });
    var tags = {};
    Object.keys(byPos).forEach(function (pos) {
      var lst = byPos[pos];
      var gpmSorted = lst.map(function (x) { return x.avg_gpm || 0; }).sort(function (a, b) { return a - b; });
      var assistSorted = lst.map(function (x) { return x.avg_assist_num || 0; }).sort(function (a, b) { return a - b; });
      lst.forEach(function (r) {
        var gpmPct = pct(gpmSorted, r.avg_gpm || 0);
        var assistPct = pct(assistSorted, r.avg_assist_num || 0);
        var tag;
        if (CARRY_POSITIONS.indexOf(pos) >= 0) {
          tag = gpmPct >= 0.66 ? '大核' : (assistPct >= 0.66 ? '节奏' : '平衡');
        } else {
          tag = assistPct >= 0.66 ? '开团' : '平衡';
        }
        tags[r.player_id + '\u0000' + r.season_id] = tag;
      });
    });
    return tags;
  }

  function buildPairTable(records) {
    var byTeam = {};
    records.forEach(function (r) {
      if ((r.games || 0) >= 10) {
        var key = r.season_id + '|' + r.team_franchise;
        (byTeam[key] = byTeam[key] || []).push(r);
      }
    });
    var table = {};
    Object.keys(byTeam).forEach(function (key) {
      var lst = byTeam[key];
      var pairs = {};
      for (var i = 0; i < lst.length; i++) {
        for (var j = i + 1; j < lst.length; j++) {
          var w = Math.min(lst[i].games, lst[j].games) / 30.0;
          var pairKey = lst[i].player_id + '\u0000' + lst[j].player_id;
          if (!(pairKey in pairs) || pairs[pairKey] < w) pairs[pairKey] = w;
        }
      }
      table[key] = pairs;
    });
    return table;
  }

  function buildChem(records, pairWinBySeason, players) {
    return {
      pair_table: buildPairTable(records),
      tags: buildStyleTags(records),
      pair_win: pairWinBySeason || {},
      players: players || {}
    };
  }

  function lineupStrength(starter, chem, compress) {
    compress = compress == null ? COMPRESS : compress;
    var breakdown = { base: 50, coverage: 0, synergy: 0, win_synergy: 0, style: 0, raw: 50, effective: 50 };
    if (!starter || !starter.length) return [50.0, breakdown];
    var base = starter.reduce(function (s, x) { return s + (x.rating || 0); }, 0) / starter.length;
    var positions = {};
    starter.forEach(function (s) { positions[s.position] = true; });
    var coverage = (Object.keys(positions).length === 5) ? 2.0 : 0.0;
    coverage -= Math.max(0, 5 - starter.length) * 1.5;

    var synergy = 0;
    if (chem) {
      var pairTable = chem.pair_table;
      for (var i = 0; i < starter.length; i++) {
        for (var j = i + 1; j < starter.length; j++) {
          var key = starter[i].season_id + '|' + starter[i].team_franchise;
          var pairKey = [starter[i].player_id, starter[j].player_id].sort().join('\u0000');
          var pairVal = (pairTable[key] || {})[pairKey] || 0;
          synergy += pairVal;
        }
      }
      synergy = Math.min(synergy, SYNERGY_CAP) * SYNERGY_SCALE;
    }

    var winSynergy = 0;
    if (chem && chem.pair_win) {
      var players = chem.players || {};
      for (var i2 = 0; i2 < starter.length; i2++) {
        for (var j2 = i2 + 1; j2 < starter.length; j2++) {
          var a = starter[i2], b = starter[j2];
          if (a.season_id !== b.season_id || a.team_franchise !== b.team_franchise) continue;
          var n1 = (players[a.player_id] && players[a.player_id].name) || a.player_id;
          var n2 = (players[b.player_id] && players[b.player_id].name) || b.player_id;
          var names = [n1, n2].sort();
          var rec = (chem.pair_win[a.season_id] || {})[a.team_franchise] || {};
          rec = rec[names[0] + '|' + names[1]];
          if (!rec || rec.g < PAIR_WIN_MIN) continue;
          var wr = rec.w / rec.g;
          winSynergy += (wr - 0.5) * PAIR_WIN_WEIGHT * Math.min(1, rec.g / 30.0);
        }
      }
      winSynergy = Math.max(-3, Math.min(3, winSynergy));
    }

    var style = 0;
    if (chem) {
      var tags = chem.tags;
      var carries = starter.filter(function (s) {
        return tags[s.player_id + '\u0000' + s.season_id] === '大核';
      }).length;
      if (carries >= 3) style = -(carries - 2) * STYLE_PENALTY;
      else if (carries === 0) style = -1.0;
    }

    var raw = base + coverage + synergy + winSynergy + style;
    var effective = 50 + (raw - 50) * compress;
    breakdown = {
      base: round1(base), coverage: round1(coverage), synergy: round1(synergy),
      win_synergy: round1(winSynergy), style: round1(style),
      raw: round1(raw), effective: round1(effective)
    };
    return [effective, breakdown];
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /* ---------------- 阵容 ---------------- */
  function pickStarter(roster) {
    var byPos = {};
    POSITIONS.forEach(function (p) { byPos[p] = roster.filter(function (r) { return r.position === p; }); });
    var starters = [];
    var used = {};
    POSITIONS.forEach(function (p) {
      if (byPos[p].length) {
        starters.push(byPos[p][0]);
        used[byPos[p][0].player_id + '\u0000' + byPos[p][0].season_id] = true;
      }
    });
    roster.forEach(function (r) {
      if (starters.length >= 5) return;
      if (used[r.player_id + '\u0000' + r.season_id]) return;
      starters.push(r);
    });
    return starters.slice(0, 5);
  }

  function teamStrength(starter, chem) {
    if (!starter || !starter.length) return 50.0;
    return lineupStrength(starter, chem, COMPRESS)[0];
  }

  /* ---------------- 比赛 ---------------- */
  function seriesWinProb(sa, sb, k) {
    k = k == null ? K : k;
    return 1.0 / (1.0 + Math.exp(-k * (sa - sb)));
  }

  function playSeries(rng, p, bo) {
    var a = 0, b = 0;
    var target = Math.floor(bo / 2) + 1;
    var results = [];
    while (a < target && b < target) {
      if (rng.random() < p) { a += 1; results.push('A'); }
      else { b += 1; results.push('B'); }
    }
    return [a, b, results];
  }

  function playMatch(rng, strengths, aId, bId, bo) {
    var sa = (strengths[aId] == null ? 50.0 : strengths[aId]) + rng.gauss(0, STRENGTH_NOISE);
    var sb = (strengths[bId] == null ? 50.0 : strengths[bId]) + rng.gauss(0, STRENGTH_NOISE);
    var p = seriesWinProb(sa, sb, K);
    var res = playSeries(rng, p, bo);
    var winner = res[0] > res[1] ? aId : bId;
    return [winner, res[0], res[1], res[2]];
  }

  /* ---------------- 淘汰树 ---------------- */
  function dynamicSingleElim(rng, strengths, teams, bo) {
    var alive = teams.slice();
    var roundsOut = [];
    var roundNo = 0;
    while (alive.length > 1) {
      roundNo += 1;
      var winners = [];
      var matches = [];
      for (var i = 0; i < alive.length; i += 2) {
        if (i + 1 >= alive.length) { winners.push(alive[i]); continue; }
        var r = playMatch(rng, strengths, alive[i], alive[i + 1], bo);
        winners.push(r[0]);
        matches.push({ a: alive[i], b: alive[i + 1], w: r[0], sa: r[1], sb: r[2], results: r[3] });
      }
      roundsOut.push({ round_no: roundNo, matches: matches, winners: winners });
      alive = winners;
    }
    return [alive[0] || null, roundsOut];
  }

  function dynamicDoubleElim(rng, strengths, teams, bo, finalBo) {
    finalBo = finalBo || bo;
    var winnersBracket = teams.slice();
    var losersBracket = [];
    var roundsOut = [];

    function runRound(bracket, tag) {
      var winners = [];
      for (var i = 0; i < bracket.length; i += 2) {
        if (i + 1 >= bracket.length) { winners.push(bracket[i]); continue; }
        var r = playMatch(rng, strengths, bracket[i], bracket[i + 1], bo);
        winners.push(r[0]);
        var loser = r[0] === bracket[i] ? bracket[i + 1] : bracket[i];
        roundsOut.push({ round: tag, a: bracket[i], b: bracket[i + 1], w: r[0], loser: loser, sa: r[1], sb: r[2], results: r[3] });
      }
      return winners;
    }

    function runBracketRound(bracket, tag) {
      var winners = [];
      for (var i = 0; i < bracket.length; i += 2) {
        if (i + 1 >= bracket.length) { winners.push(bracket[i]); continue; }
        var r = playMatch(rng, strengths, bracket[i], bracket[i + 1], bo);
        winners.push(r[0]);
        var loser = r[0] === bracket[i] ? bracket[i + 1] : bracket[i];
        roundsOut.push({ round: tag, a: bracket[i], b: bracket[i + 1], w: r[0], loser: loser, sa: r[1], sb: r[2], results: r[3] });
        losersBracket.push(loser);
      }
      return winners;
    }

    while (winnersBracket.length > 1) {
      winnersBracket = runBracketRound(winnersBracket, '胜者组');
      if (losersBracket.length >= 2) {
        losersBracket = runRound(losersBracket, '败者组');
      }
    }
    while (losersBracket.length > 1) {
      losersBracket = runRound(losersBracket, '败者组');
    }

    var wgChamp = winnersBracket[0];
    var lgChamp = losersBracket[0] || null;
    if (lgChamp == null) return [wgChamp, roundsOut];
    var r1 = playMatch(rng, strengths, wgChamp, lgChamp, finalBo);
    roundsOut.push({ round: '总决赛', a: wgChamp, b: lgChamp, w: r1[0], loser: r1[0] === wgChamp ? lgChamp : wgChamp, sa: r1[1], sb: r1[2], results: r1[3] });
    return [r1[0], roundsOut];
  }

  /* ---------------- 叙事 ---------------- */
  function uniqNames(roster, pnames) {
    var out = [];
    (roster || []).forEach(function (r) {
      var n = pnames[r.player_id] || r.player_id;
      if (n && out.indexOf(n) < 0) out.push(n);
    });
    return out;
  }

  function gameNarration(rng, tpl, teamA, teamB, winner, scoreA, scoreB, gameNo, namesA, namesB, comeback, maxDeficit, tiedNow, aheadNow, isLast, isPeak, year, usedHeroes) {
    var poolA = (namesA && namesA.length) ? namesA.slice() : ['选手'];
    var poolB = (namesB && namesB.length) ? namesB.slice() : ['选手'];
    var winPool = winner === teamA ? poolA : poolB;
    var used = usedHeroes || {};
    // 每个小局可带 2-3 名高光选手：中期一、中期二各一人，结尾/梗再随机补人
    var p1 = rng.choice(winPool);
    var pRest = winPool.filter(function (n) { return n !== p1; });
    var p2 = pRest.length ? rng.choice(pRest) : p1;
    var pa = rng.choice(poolA);
    var pb = rng.choice(poolB);
    // BP 英雄池按赛事年份取对应版本，避免穿越时空出现未上线英雄（如 2020 年的源流之子）
    var yearPool = (year && tpl.heroes_pool) ? (tpl.heroes_pool[String(year)] || null) : null;
    var heroSource = yearPool || tpl.heroes || {};
    var roles = Object.keys(heroSource);
    function listFor(role) {
      var pool = heroSource[role];
      if (Array.isArray(pool) && pool.length) return pool;
      var fb = tpl.heroes && tpl.heroes[role];
      return (Array.isArray(fb) && fb.length) ? fb : [];
    }
    function pickHero() {
      var role = rng.choice(roles);
      var list = listFor(role).filter(function (h) { return !used[h]; });
      if (!list.length) list = listFor(role);  // 全局 BP 池耗尽时回退（极端情况不崩）
      var hero = list.length ? rng.choice(list) : '不知火舞';
      if (hero) used[hero] = 1;
      return hero;
    }
    var systemA = rng.choice(tpl.systems);
    var systemB = rng.choice(tpl.systems);
    var bp;
    if (isPeak) {
      // 巅峰对决：双方盲选当前版本最强阵容，英雄完全相同，没有 BP 博弈
      bp = '巅峰对决！双方盲选当前版本最强阵容，英雄完全相同，拼的就是硬实力';
    } else {
      var bpTpl = rng.choice(tpl.bp_lines || ['BP 结束，{team_a} 对阵 {team_b}']);
      bp = bpTpl
        .replace(/\{team_a\}/g, teamA).replace(/\{team_b\}/g, teamB)
        .replace(/\{hero_a1\}/g, pickHero()).replace(/\{hero_a2\}/g, pickHero())
        .replace(/\{hero_b1\}/g, pickHero()).replace(/\{hero_b2\}/g, pickHero())
        .replace(/\{system_a\}/g, systemA).replace(/\{system_b\}/g, systemB);
    }
    var devPool = listFor('发育路').filter(function (h) { return !used[h]; });
    if (!devPool.length) devPool = listFor('发育路');
    var heroB = rng.choice(devPool.length ? devPool : ['戈娅']);
    if (heroB) used[heroB] = 1;
    var loser = winner === teamA ? teamB : teamA;
    var opening = rng.choice(tpl.openings)
      .replace(/\{team_a\}/g, teamA).replace(/\{team_b\}/g, teamB)
      .replace(/\{system\}/g, systemA).replace(/\{hero_b\}/g, heroB)
      .replace(/\{player_a\}/g, pa).replace(/\{player_b\}/g, pb);
    var events = rng.sample(tpl.events, 3);
    function pickObjective(minute) {
      // 风暴龙王 20 分钟才刷新，10 分钟龙团/中前期不能出现
      var pool = OBJECTIVES.filter(function (o) { return o !== '风暴龙王' || minute >= 20; });
      return rng.choice(pool.length ? pool : ['暴君']);
    }
    function fmtEvent(tmpl, minute, player) {
      return tmpl
        .replace(/\{team\}/g, winner).replace(/\{player\}/g, player)
        .replace(/\{opp\}/g, loser).replace(/\{minute\}/g, minute)
        .replace(/\{objective\}/g, pickObjective(minute));
    }
    var mid1 = fmtEvent(events[0], rng.randint(7, 12), p1);
    var mid2 = fmtEvent(events[1], rng.randint(13, 19), p2);
    var mid3 = fmtEvent(events[2], rng.randint(20, 26), rng.choice(winPool));
    var ending;
    // 普通结束语先算好：最后一场不能出现"目前比分 X:Y"，非最后一场不能提前"终结比赛"
    var endPool = tpl.endings.filter(function (e) {
      return isLast ? (e.indexOf('目前比分') < 0 && e.indexOf('比分来到') < 0) : (e.indexOf('终结比赛') < 0);
    });
    if (comeback) {
      // 翻盘措辞必须与实际比分线匹配：让二追三=曾落后2局且本局赢后反超；
      // 拖进巅峰对决=追平且非最后一场；绝不允许 3:1 出现"让2追3成功"
      var cbPool = tpl.comebacks.filter(function (c) {
        if (c.indexOf('巅峰对决') >= 0) return tiedNow && !isLast;
        if (c.indexOf('让二追三') >= 0 || c.indexOf('让2追3') >= 0) return isLast && aheadNow && maxDeficit === 2;
        if (c.indexOf('让三追三') >= 0 || c.indexOf('让3追3') >= 0) return isLast && aheadNow && maxDeficit === 3;
        if (c.indexOf('连扳三局') >= 0) return aheadNow && maxDeficit >= 3;
        if (c.indexOf('连扳两局') >= 0 || c.indexOf('连扳两城') >= 0) return aheadNow && maxDeficit >= 2;
        if (c.indexOf('悬崖边上') >= 0) return maxDeficit >= 2;
        if (c.indexOf('同一起跑线') >= 0 || c.indexOf('悬念重新拉回') >= 0) return tiedNow;
        return true; // 通用逆转文案（反打/拉回/绝地反击等）
      });
      if (cbPool.length) {
        ending = rng.choice(cbPool).replace(/\{team_a\}/g, winner);
      } else {
        // 翻盘但无匹配模板 → 退回普通结束语，绝不 fallback 到全量 comebacks
        ending = rng.choice(endPool.length ? endPool : tpl.endings)
          .replace(/\{team_a\}/g, winner).replace(/\{team_b\}/g, loser)
          .replace(/\{score_a\}/g, scoreA).replace(/\{score_b\}/g, scoreB);
      }
    } else {
      ending = rng.choice(endPool.length ? endPool : tpl.endings)
        .replace(/\{team_a\}/g, winner).replace(/\{team_b\}/g, loser)
        .replace(/\{score_a\}/g, scoreA).replace(/\{score_b\}/g, scoreB);
    }
    var stealLines = tpl.steal_lines || ['请神梦老师，{player}成功偷家'];
    if (winner.indexOf('AG') >= 0 && rng.random() < 0.12) {
      var stealPool = isLast ? stealLines : stealLines.filter(function (s) { return s.indexOf('终结比赛') < 0; });
      ending = rng.choice(stealPool.length ? stealPool : stealLines)
        .replace(/\{team_a\}/g, winner).replace(/\{player\}/g, rng.choice(winPool));
    }
    var line = '第' + gameNo + '局\nBP：' + bp + '\n开局：' + opening +
      '\n中期：' + mid1 + '；' + mid2 + '；' + mid3 + '\n结束：' + ending;
    if (tpl.meme_quotes && tpl.meme_quotes.length && rng.random() < 0.15) {
      // "打野的尽头是一片海" 只在本场有花海时出现
      var hasHai = poolA.indexOf('花海') >= 0 || poolB.indexOf('花海') >= 0;
      var quotePool = tpl.meme_quotes.filter(function (m) {
        return m.indexOf('打野的尽头是一片海') < 0 || hasHai;
      });
      var memePool = winPool.length > 2 ? rng.sample(winPool, 2) : winPool.slice();
      var mi = 0;
      var meme = rng.choice(quotePool.length ? quotePool : tpl.meme_quotes)
        .replace(/\{team\}/g, winner)
        .replace(/\{player\}/g, function () {
          var n = memePool[mi % memePool.length];
          mi++;
          return n;
        });
      var leads = (tpl.scene_leads || {})['名场面'] || [];
      var lead = leads.length ? rng.choice(leads) : '';
      line += '\n' + (lead ? lead + meme : meme);
    }
    return line;
  }

  function narrateSeries(rng, tpl, na, nb, results, rosterA, rosterB, pnames, bo, year) {
    var lines = [];
    var namesA = uniqNames(rosterA, pnames);
    var namesB = uniqNames(rosterB, pnames);
    var usedHeroes = {};  // 全局 BP：整个系列赛内已出现的英雄不再复用
    var curA = 0, curB = 0;
    var maxDefA = 0, maxDefB = 0; // 双方历史最大落后局数（用于"让二追三"类措辞）
    function seriesMvp(winRoster) {
      var best = null, bs = -1;
      (winRoster || []).forEach(function (r) {
        var sc = (r.avg_kill_num || 0) + (r.avg_assist_num || 0) * 0.8 -
          (r.avg_death_num || 0) * 0.6 + rng.random() * 2.0;
        if (sc > bs) { bs = sc; best = r; }
      });
      return best ? (pnames[best.player_id] || best.player_id) : null;
    }
    for (var idx = 0; idx < results.length; idx++) {
      var g = results[idx];
      var winTeam, winRoster, loseTeam;
      var beforeA = curA, beforeB = curB;
      if (g === 'A') {
        curA += 1; winTeam = na; winRoster = rosterA; loseTeam = nb;
      } else {
        curB += 1; winTeam = nb; winRoster = rosterB; loseTeam = na;
      }
      var afterA = curA, afterB = curB;
      var winA = g === 'A';
      var tiedNow = afterA === afterB;
      var aheadNow = winA ? afterA > afterB : afterB > afterA;
      var maxDeficit = winA ? maxDefA : maxDefB;
      var comeback = maxDeficit > 0 && (tiedNow || aheadNow);
      var winScore = winTeam === na ? curA : curB;
      var loseScore = winTeam === na ? curB : curA;
      var isPeak = bo && results.length >= bo && idx === results.length - 1;
      var line = gameNarration(rng, tpl, na, nb, winTeam, winScore, loseScore, idx + 1, namesA, namesB, comeback,
        maxDeficit, tiedNow, aheadNow, idx === results.length - 1, isPeak, year, usedHeroes);
      // 每局 MVP：功臣一目了然
      var mvpName = seriesMvp(winRoster);
      if (mvpName) line += '\n本局MVP：' + mvpName;
      lines.push(line);
      // 每局结束后更新双方最大落后（下一局翻盘措辞的依据）
      maxDefA = Math.max(maxDefA, curB - curA);
      maxDefB = Math.max(maxDefB, curA - curB);
    }
    return lines;
  }

  /* 本场 10 名选手的逐局 k/d/a + 每局 MVP（用于战绩卡"本次征战"数据） */
  function simMatchStats(rng, rosterA, rosterB, results) {
    var agg = {};
    function ensure(pid) {
      if (!agg[pid]) agg[pid] = { games: 0, k: 0, d: 0, a: 0, mvp: 0 };
      return agg[pid];
    }
    // 同一选手可能出现在双方阵容（平行时空转会），key 带队伍区分，防止数据互相污染
    function keyOf(r) { return r.player_id + '|' + (r.team_franchise || '?'); }
    var K_W = { '对抗路': 0.8, '打野': 1.4, '中路': 1.1, '发育路': 1.5, '游走': 0.3 };
    var A_W = { '对抗路': 0.9, '打野': 1.0, '中路': 1.1, '发育路': 0.8, '游走': 1.8 };
    var D_W = { '对抗路': 1.1, '打野': 1.0, '中路': 1.2, '发育路': 1.4, '游走': 0.9 };
    function dist(roster, total, wmap) {
      if (!roster || !roster.length) return {};
      var out = {}, weights = [], sum = 0;
      roster.forEach(function (r) {
        var w = wmap[r.position] || 1.0;
        weights.push(w); sum += w;
      });
      var left = total;
      roster.forEach(function (r, i) {
        var v = Math.max(0, Math.round(total * weights[i] / sum + (rng.random() * 2 - 1) * 0.6));
        out[r.player_id] = v;
        left -= v;
      });
      while (left > 0) {
        var idx = rng.randint(0, roster.length - 1);
        out[roster[idx].player_id]++;
        left--;
      }
      return out;
    }
    (results || []).forEach(function (g) {
      var winnerR = g === 'A' ? rosterA : rosterB;
      var loserR = g === 'A' ? rosterB : rosterA;
      // KPL 常见数据：胜方单队击杀 12-18、败方 7-12；每击杀约 1.6-2.2 助攻
      var wk = rng.randint(12, 18);
      var lk = rng.randint(7, 12);
      var wK = dist(winnerR, wk, K_W), wA = dist(winnerR, Math.round(wk * (1.8 + rng.random() * 0.4)), A_W);
      var lK = dist(loserR, lk, K_W), lA = dist(loserR, Math.round(lk * (1.6 + rng.random() * 0.4)), A_W);
      var wD = dist(winnerR, rng.randint(1, 4), D_W);
      var lD = dist(loserR, rng.randint(8, 16), D_W);
      winnerR.concat(loserR).forEach(function (r) {
        var s = ensure(keyOf(r));
        s.games++;
        var kk = (wK[r.player_id] || 0) + (lK[r.player_id] || 0);
        var aa = (wA[r.player_id] || 0) + (lA[r.player_id] || 0);
        var dd = (wD[r.player_id] || 0) + (lD[r.player_id] || 0);
        // k/d/a 按选手本身归属的一方计算（胜方击杀、败方死亡分开），
        // 同一 pid 在双方时各自只累加自己队伍的数据
        var side = winnerR.indexOf(r) >= 0 ? 'W' : 'L';
        if (side === 'W') { s.k += wK[r.player_id] || 0; s.a += wA[r.player_id] || 0; s.d += wD[r.player_id] || 0; }
        else { s.k += lK[r.player_id] || 0; s.a += lA[r.player_id] || 0; s.d += lD[r.player_id] || 0; }
      });
      // MVP：KPL 每局 MVP 给胜方，队内按本局数据评分
      var best = null, bestScore = -1;
      winnerR.forEach(function (r) {
        var k = (wK[r.player_id] || 0) + (lK[r.player_id] || 0);
        var a = (wA[r.player_id] || 0) + (lA[r.player_id] || 0);
        var d = (wD[r.player_id] || 0) + (lD[r.player_id] || 0);
        // 已拿 MVP 越多惩罚越大 + 随机扰动，避免同一人（通常是打野）垄断全部 MVP
        var prior = ensure(keyOf(r)).mvp || 0;
        var sc = k + a * 0.8 - d * 0.6 + rng.random() * 4.0 - prior * 1.2;
        if (sc > bestScore) { bestScore = sc; best = r.player_id; }
      });
      if (best) {
        var bRec = null;
        winnerR.forEach(function (r) { if (r.player_id === best) bRec = r; });
        if (bRec) ensure(keyOf(bRec)).mvp++;
      }
    });
    return agg;
  }

  /* ---------------- 赛季模拟 ---------------- */
  function franchiseNames(franchises) {
    var out = {};
    franchises.forEach(function (f) {
      var nbs = f.names_by_season || {};
      var keys = Object.keys(nbs);
      if (keys.length) {
        keys.sort();
        out[f.id] = nbs[keys[keys.length - 1]];
      } else {
        out[f.id] = f.name || '?';
      }
    });
    return out;
  }

  function seasonYear(sid) {
    var m = /(20\d{2})/.exec(sid || '');
    return m ? parseInt(m[1], 10) : null;
  }

  /* ---------------- 赛制辅助：组内循环 / 排名 / 重组 / 淘汰树 ---------------- */
  function rrSchedule(teamIds) {
    var ms = [];
    for (var i = 0; i < teamIds.length; i++) {
      for (var j = i + 1; j < teamIds.length; j++) ms.push([teamIds[i], teamIds[j]]);
    }
    return ms;
  }

  // 按 (胜场, 净胜分, 战力) 排序
  function sortByRecord(teamIds, rec, strengths) {
    var copy = teamIds.slice();
    copy.sort(function (a, b) {
      var ra = rec[a] || { wins: 0, net: 0 }, rb = rec[b] || { wins: 0, net: 0 };
      if (rb.wins !== ra.wins) return rb.wins - ra.wins;
      if (rb.net !== ra.net) return rb.net - ra.net;
      return (strengths[b] || 50) - (strengths[a] || 50);
    });
    return copy;
  }

  // 从官方赛程推导分组：同组队伍互为对手
  function groupsFromMatches(matches, allTeams) {
    var gid = {};
    var groups = [];
    function ensure(t) {
      if (gid[t] === undefined) { gid[t] = groups.length; groups.push([t]); }
      return gid[t];
    }
    (matches || []).forEach(function (m) {
      var a = ensure(m.a_id), b = ensure(m.b_id);
      if (a !== b) {
        var to = groups[b], from = groups[a];
        to.push.apply(to, from);
        groups[a] = [];
        from.forEach(function (t) { gid[t] = b; });
      }
    });
    return groups.filter(function (g) { return g.length; }).concat(
      (allTeams || []).filter(function (t) { return gid[t] === undefined; }).map(function (t) { return [t]; })
    );
  }

  // KPL 季后赛 10 队双败结构
  //   mode=sab    2021+：S1-S4 胜者组；S5/S6 直接进败者组第二轮；A1-A4 败者组第一轮
  //   mode=legacy 2019-2020：常规赛前 4 胜者组；5-10 败者组第一轮（6 队 3 场）
  function kplPlayoff10(wTop, lTop, mode) {
    if (mode === 'legacy') {
      return {
        mode: 'legacy',
        w: [wTop[0], wTop[3], wTop[1], wTop[2]],
        wPairs: [[wTop[0], wTop[3]], [wTop[1], wTop[2]]],
        l1: lTop.slice(),
        l1Pairs: bracketPair(lTop),
        late: []
      };
    }
    var s6 = wTop, a4 = lTop;
    return {
      mode: 'sab',
      w: [s6[0], s6[3], s6[1], s6[2]],   // 胜者组半决：S1vsS4、S2vsS3
      wPairs: [[s6[0], s6[3]], [s6[1], s6[2]]],
      l1: [a4[0], a4[3], a4[1], a4[2]],  // 败者组第一轮：A1vsA4、A2vsA3
      l1Pairs: [[a4[0], a4[3]], [a4[1], a4[2]]],
      late: [s6[4], s6[5]]               // S5/S6 败者组第二轮入场
    };
  }

  // 标准单败括号：首轮 1vsN、2vsN-1…，后续轮胜者按顺序合并
  function bracketPair(seeded) {
    var pairs = [];
    for (var i = 0; i < Math.floor(seeded.length / 2); i++) {
      pairs.push([seeded[i], seeded[seeded.length - 1 - i]]);
    }
    return pairs;
  }

  // 按赛制类型构建阶段定义（2026-08-19：动态晋级，不再照官方固定赛程跑完全部轮次）
  function buildPhaseDefs(fmt) {
    var regFmt = fmt.regular_format || {};
    var regType = regFmt.type || 'official';
    function copyMatches(ms) {
      return (ms || []).map(function (m) { return Object.assign({}, m); });
    }
    // 部分赛季（如 2019/2020 世冠）官方爬虫把"小组赛"标成 type=other，
    // 不兼容的话阶段定义为空，赛季直接"刷新不出来"
    var rr = fmt.rounds.filter(function (r) {
      return r.type === 'round_robin' ||
        (r.type === 'other' && String(r.name || '').indexOf('小组赛') >= 0);
    });
    var pi = fmt.rounds.filter(function (r) { return r.type === 'play_in'; });
    var tree = fmt.rounds.filter(function (r) {
      return ['single_elim', 'double_elim', 'playoffs', 'final'].indexOf(r.type) >= 0;
    });
    var defs = [];
    function rrName(i, fb) { return (rr[i] && rr[i].name) || fb; }
    if (regType === 'kpl_3round') {
      if (rr[0]) defs.push({ kind: 'official_rr', title: rrName(0, '常规赛第一轮'), matches: copyMatches(rr[0].matches), bo: rr[0].bo || 5, r1: true });
      defs.push({ kind: 'rr_regroup', title: rrName(1, '常规赛第二轮'), bo: (rr[1] && rr[1].bo) || 5, r2: true });
      defs.push({ kind: 'playin_sab', title: (pi[0] && pi[0].name) || '卡位赛', bo: 7 });
      defs.push({ kind: 'rr_regroup', title: rrName(2, '常规赛第三轮'), bo: (rr[2] && rr[2].bo) || 5, r3: true });
      defs.push({ kind: 'kpl_playoff10', title: '季后赛', bo: 7 });
    } else if (regType === 'kpl_single') {
      if (rr[0]) defs.push({ kind: 'official_rr', title: rrName(0, '常规赛'), matches: copyMatches(rr[0].matches), bo: rr[0].bo || 5, single: true });
      defs.push({ kind: 'kpl_playoff10', title: '季后赛', bo: 7 });
    } else if (regType === 'group_stage') {
      if (rr[0]) defs.push({ kind: 'official_rr', title: rrName(0, '小组赛'), matches: copyMatches(rr[0].matches), bo: rr[0].bo || 3, groupStage: true });
      var fbo = 7;
      tree.forEach(function (r) { if (r.type === 'final' && r.bo) fbo = r.bo; });
      defs.push({ kind: 'after_groups', title: '淘汰赛', bo: (tree[0] && tree[0].bo) || 7, finalBo: fbo });
    } else if (regType === 'annual') {
      var arena = null, survive = null;
      fmt.rounds.forEach(function (r) {
        if ((r.name || '').indexOf('擂台') >= 0) arena = r;
        if ((r.name || '').indexOf('突围') >= 0) survive = r;
      });
      if (arena) defs.push({ kind: 'official_rr', title: arena.name, matches: copyMatches(arena.matches), bo: arena.bo || 5, annual: true });
      defs.push({ kind: 'annual_survive', title: (survive && survive.name) || '突围赛', bo: 7 });
      defs.push({ kind: 'de8', title: '淘汰赛', bo: 7, finalBo: regFmt.final_bo || 7 });
    } else if (regType === 'bracket') {
      var r32 = null;
      fmt.rounds.forEach(function (r) {
        if ((r.name || '').indexOf('32强') >= 0) r32 = r;
      });
      if (r32) defs.push({ kind: 'official_rr', title: r32.name, matches: copyMatches(r32.matches), bo: r32.bo || 5, bracket: true });
      defs.push({ kind: 'bracket_r16', title: '16强', bo: 7 });
      defs.push({ kind: 'de8', title: '8强', bo: 7, finalBo: regFmt.final_bo || 9 });
    } else if (regType === 'swiss') {
      if (rr[0]) defs.push({ kind: 'official_rr', title: rrName(0, '小组赛'), matches: copyMatches(rr[0].matches), bo: rr[0].bo || 3, swiss: true });
      defs.push({ kind: 'after_groups', title: '淘汰赛', bo: 7, finalBo: 7 });
    }
    return defs;
  }

  function simulateSeason(opts) {
    var fmt0 = opts.formats[opts.season_id];
    if (fmt0 && ((fmt0.regular_format || {}).type || 'official') !== 'official') {
      // 动态赛制：复用 createDynamicSession 一次性跑完（与线上分阶段结果一致）
      var sess = createDynamicSession(opts);
      var narrations = [], path = [], losses = {};
      var guard = 0;
      while (!sess.isDone() && guard++ < 8000) {
        var st = sess.next();
        if (st.kind === 'regular_round' || st.kind === 'elim_round' || st.kind === 'play_in') {
          (st.entries || []).forEach(function (e) {
            path.push(e);
            (e.games || []).forEach(function (g) { narrations.push(g); });
            if (!e.win) losses[e.opp] = (losses[e.opp] || 0) + 1;
          });
        }
      }
      return {
        champion: sess.getChampion(),
        narrations: narrations,
        path: path,
        losses: losses,
        regular: sess.getRegular()
      };
    }
    /* opts: {
     *   season_id, formats (seasons map), rosters {fid:[records]},
     *   rng, names {fid:name}, tpl, override_rosters?, chem?, track?
     * }
     * returns { champion, narrations, path, losses, regular }
     */
    var rosters = opts.rosters;
    if (opts.override_rosters) rosters = Object.assign({}, rosters, opts.override_rosters);
    var fmt = opts.formats[opts.season_id];
    if (!fmt) return { champion: null, narrations: [], path: [], losses: {}, regular: {} };
    var rng = opts.rng;
    var names = opts.names;
    var tpl = opts.tpl;
    var year = seasonYear(opts.season_id);
    var track = opts.track || null;
    var playoffCfg = fmt.playoff_config || {};
    var strengths = {};
    Object.keys(rosters).forEach(function (fid) {
      strengths[fid] = teamStrength(pickStarter(rosters[fid]), opts.chem);
    });
    if (track != null && strengths[track] !== undefined) strengths[track] += PLAYER_BOOST;
    var narrations = [];
    var path = [];
    var champion = null;
    var losses = {};
    var regularWins = {}, regularGames = {}, regularGf = {}, regularGa = {};
    var elimRounds = [];
    var seedNotes = {};
    var pnames = {};
    if (opts.players) {
      Object.keys(opts.players).forEach(function (pid) { pnames[pid] = opts.players[pid].name; });
    }

    fmt.rounds.forEach(function (rnd) {
      var rtype = rnd.type;
      if (['single_elim', 'double_elim', 'playoffs', 'play_in', 'final'].indexOf(rtype) >= 0) {
        elimRounds.push(rnd);
        return;
      }
      // 常规赛/小组赛：按官方对阵模拟，战绩进排名（仅剧情）
      (rnd.matches || []).forEach(function (m) {
        var aId = m.a_id, bId = m.b_id;
        var bo = rnd.bo || (['playoffs', 'play_in', 'final', 'single_elim', 'double_elim'].indexOf(rtype) >= 0 ? 7 : 5);
        var r = playMatch(rng, strengths, aId, bId, bo);
        var winnerId = r[0], scoreA = r[1], scoreB = r[2], gameResults = r[3];
        var loserId = winnerId === aId ? bId : aId;
        losses[loserId] = (losses[loserId] || 0) + 1;
        regularWins[winnerId] = (regularWins[winnerId] || 0) + 1;
        [[aId, scoreA, scoreB], [bId, scoreB, scoreA]].forEach(function (t) {
          regularGames[t[0]] = (regularGames[t[0]] || 0) + 1;
          regularGf[t[0]] = (regularGf[t[0]] || 0) + t[1];
          regularGa[t[0]] = (regularGa[t[0]] || 0) + t[2];
        });
        var na = names[aId] || m.a_name || 'A队';
        var nb = names[bId] || m.b_name || 'B队';
        var rosterA = pickStarter(rosters[aId] || []);
        var rosterB = pickStarter(rosters[bId] || []);
        if (track && (track === aId || track === bId)) {
          var trackIsA = track === aId;
          var opp = trackIsA ? bId : aId;
          var oppName = names[opp] || '?';
          var oppRoster = trackIsA ? rosterB : rosterA;
          var oppPlayers = oppRoster.map(function (x) { return pnames[x.player_id] || x.player_id; });
          var scoreTrack = trackIsA ? scoreA : scoreB;
          var scoreOpp = trackIsA ? scoreB : scoreA;
          var resultsTrack = trackIsA ? gameResults : gameResults.map(function (g) { return g === 'A' ? 'B' : 'A'; });
          path.push({
            round: rnd.name, opp: oppName, opp_players: oppPlayers,
            score: scoreTrack + ':' + scoreOpp, win: winnerId === track,
            games: narrateSeries(rng, tpl, na, nb, gameResults, rosterA, rosterB, pnames, bo, year),
            results: resultsTrack
          });
        }
      });
    });

    // 常规赛排名：胜场为主，净胜局次之，强度兜底
    var regularRank = {}, regularInfo = {};
    if (Object.keys(regularGames).length) {
      var order = Object.keys(regularGames).sort(function (a, b) {
        var wa = -(regularWins[a] || 0), wb = -(regularWins[b] || 0);
        if (wa !== wb) return wa - wb;
        var na = (regularGa[a] || 0) - (regularGf[a] || 0);
        var nb2 = (regularGa[b] || 0) - (regularGf[b] || 0);
        if (na !== nb2) return na - nb2;
        var sa = -(strengths[a] || 50), sb = -(strengths[b] || 50);
        if (sa !== sb) return sa - sb;
        return a < b ? -1 : 1;
      });
      order.forEach(function (fid, i) {
        regularRank[fid] = i + 1;
        regularInfo[fid] = {
          rank: i + 1,
          wins: regularWins[fid] || 0,
          losses: regularGames[fid] - (regularWins[fid] || 0),
          games: regularGames[fid],
          net: (regularGf[fid] || 0) - (regularGa[fid] || 0)
        };
      });
    }

    var treeRounds = elimRounds.filter(function (r) {
      return ['single_elim', 'double_elim', 'playoffs', 'final'].indexOf(r.type) >= 0;
    });
    if (!treeRounds.length) {
      elimRounds.forEach(function (rnd) {
        (rnd.matches || []).forEach(function (m) {
          var r = playMatch(rng, strengths, m.a_id, m.b_id, rnd.bo || 7);
          narrations.push((names[r[0]] || '?') + ' ' + r[1] + ':' + r[2] + ' ' + (names[r[0] === m.a_id ? m.b_id : m.a_id] || '?'));
        });
      });
    } else if (elimRounds.length && treeRounds.length) {
      elimRounds.forEach(function (rnd) {
        if (rnd.type !== 'play_in') return;
        (rnd.matches || []).forEach(function (m) {
          var r = playMatch(rng, strengths, m.a_id, m.b_id, rnd.bo || 7);
          var loserId = r[0] === m.a_id ? m.b_id : m.a_id;
          losses[loserId] = (losses[loserId] || 0) + 1;
          var na = names[m.a_id] || 'A队', nb = names[m.b_id] || 'B队';
          narrations.push(na + ' ' + r[1] + ':' + r[2] + ' ' + nb + '——' + rng.choice(['鏖战五局', '轻松过关']) + '。');
        });
      });

      var firstRound = treeRounds[0];
      var teams = [];
      (firstRound.matches || []).forEach(function (m) {
        if (teams.indexOf(m.a_id) < 0) teams.push(m.a_id);
        if (teams.indexOf(m.b_id) < 0) teams.push(m.b_id);
      });
      teams.forEach(function (t) {
        if (!(t in strengths)) strengths[t] = 50.0;
      });
      // 外卡：玩家队不在本赛事参赛名单时，顶替首轮最弱队，并优先对阵剩余最弱对手，保证有真实对阵与战报
      if (track != null && teams.indexOf(track) < 0 && teams.length) {
        var sortedT = teams.slice().sort(function (x, y) {
          return (strengths[x] || 50) - (strengths[y] || 50);
        });
        var weakest = sortedT[0];
        var secondWeak = sortedT[1] || null;
        var replacedNote = names[weakest] || '?';
        var idxW = teams.indexOf(weakest);
        teams[idxW] = track;
        if (secondWeak && Math.floor(teams.indexOf(secondWeak) / 2) !== Math.floor(idxW / 2)) {
          var idxS = teams.indexOf(secondWeak);
          var posOppW = idxW % 2 === 0 ? idxW + 1 : idxW - 1;
          var oppW = teams[posOppW];
          teams[posOppW] = secondWeak;
          teams[idxS] = oppW;
        }
        if (!(track in strengths)) strengths[track] = 50.0;
        var firstOpp = teams[idxW % 2 === 0 ? idxW + 1 : idxW - 1];
        var note = (names[track] || '这支队伍') + '以外卡身份顶替' + replacedNote +
          '，登上' + (fmt.name || '本次赛事') + '的淘汰赛舞台，首轮对阵' + (names[firstOpp] || '?') + '。';
        narrations.push(note);
        narrations.push('注：在原时间线中，该战队未进入' + (fmt.name || '本次赛事') + '，故以外卡身份参赛。');
      }

      // 种子剧情：首轮对位 + 常规赛排名
      if (Object.keys(regularRank).length) {
        var seedTpl = tpl.seed_lines || {};
        for (var pi = 0; pi < teams.length; pi += 2) {
          var a = teams[pi], b = teams[pi + 1];
          if (b == null) continue;
          var ra = regularRank[a], rb = regularRank[b];
          if (!ra || !rb) continue;
          var gap = Math.abs(ra - rb);
          function seedLine(side, oppSide, rankSide, rankOpp) {
            var pool;
            if (gap >= 2 && rankSide > rankOpp) pool = seedTpl.underdog || [];
            else if (gap >= 2 && rankSide < rankOpp) pool = seedTpl.favorite || [];
            else pool = seedTpl.neutral || [];
            return rng.choice(pool)
              .replace(/\{team\}/g, names[side] || side)
              .replace(/\{opp\}/g, names[oppSide] || oppSide)
              .replace(/\{rank\}/g, rankSide)
              .replace(/\{opp_rank\}/g, rankOpp);
          }
          if (track != null && (track === a || track === b)) {
            var opp = track === a ? b : a;
            var line = seedLine(track, opp, regularRank[track], regularRank[opp]);
            (seedNotes[track] = seedNotes[track] || []).push(line);
            narrations.push(line);
          } else if (gap >= 3) {
            var low = ra > rb ? a : b;
            var high = low === a ? b : a;
            var rl = Math.max(ra, rb), rh = Math.min(ra, rb);
            var line2 = seedLine(low, high, rl, rh);
            (seedNotes[low] = seedNotes[low] || []).push(line2);
            narrations.push(line2);
          }
        }
      }

      var cfgType = (fmt.playoff_config || {}).type;
      var singleRounds = treeRounds.filter(function (r) {
        return r.type === 'single_elim' || (cfgType === 'single_elim' && (r.type === 'playoffs' || r.type === 'final'));
      });
      var multiRounds = treeRounds.filter(function (r) {
        return cfgType !== 'single_elim' && ['double_elim', 'playoffs', 'final'].indexOf(r.type) >= 0;
      });
      var current = teams;
      var elimLog = [];

      singleRounds.forEach(function (rnd) {
        var bo = rnd.bo || 5;
        var winners = [];
        for (var i = 0; i < current.length; i += 2) {
          if (i + 1 >= current.length) { winners.push(current[i]); continue; }
          var r = playMatch(rng, strengths, current[i], current[i + 1], bo);
          winners.push(r[0]);
          elimLog.push({ round: rnd.name, a: current[i], b: current[i + 1], w: r[0], loser: r[0] === current[i] ? current[i + 1] : current[i], sa: r[1], sb: r[2], results: r[3] });
        }
        current = winners;
        if (current.length <= 1) return;
      });

      if (multiRounds.length && current.length > 1) {
        var boM = multiRounds[0].bo || 7;
        var finalR = multiRounds.filter(function (r) { return r.type === 'final'; });
        var finalBo = (finalR.length ? finalR[0].bo : null) || boM;
        var de = dynamicDoubleElim(rng, strengths, current, boM, finalBo);
        elimLog = elimLog.concat(de[1]);
        current = [de[0]];
      }

      if (current.length) champion = current[0];
      elimLog.forEach(function (e) {
        if (e.loser) losses[e.loser] = (losses[e.loser] || 0) + 1;
        if (e.w) {
          var na2 = names[e.a] || 'A队', nb2 = names[e.b] || 'B队';
          var rosterA2 = pickStarter(rosters[e.a] || []);
          var rosterB2 = pickStarter(rosters[e.b] || []);
          narrations = narrations.concat(narrateSeries(rng, tpl, na2, nb2, e.results, rosterA2, rosterB2, pnames, bo, year));
          if (track != null && (track === e.a || track === e.b)) {
            var tIsA = track === e.a;
            var opp2 = tIsA ? e.b : e.a;
            var oppName2 = names[opp2] || '?';
            var oppRoster2 = tIsA ? rosterB2 : rosterA2;
            var oppPlayers2 = oppRoster2.map(function (x) { return pnames[x.player_id] || x.player_id; });
            var st = tIsA ? e.sa : e.sb;
            var so = tIsA ? e.sb : e.sa;
            var rt = tIsA ? e.results : e.results.map(function (g) { return g === 'A' ? 'B' : 'A'; });
            path.push({
              round: e.round, opp: oppName2, opp_players: oppPlayers2,
              score: st + ':' + so, win: e.w === track,
              games: narrateSeries(rng, tpl, na2, nb2, e.results, rosterA2, rosterB2, pnames, bo, year),
              results: rt
            });
          }
        }
      });
    }

    if (champion) {
      var ranks = Object.keys(strengths).map(function (k) { return strengths[k]; }).sort(function (x, y) { return y - x; });
      var champStrength = strengths[champion] || 0;
      if (champStrength <= (ranks[Math.min(2, ranks.length - 1)] || 0)) {
        narrations.push('冠军彩蛋：' + rng.choice(tpl.upsets).replace(/\{team_a\}/g, names[champion] || '这支队伍'));
      }
    }
    var regularOut = {
      standings: regularInfo,
      track: track != null ? (regularInfo[track] || null) : null,
      seed_notes: track != null ? (seedNotes[track] || []) : []
    };
    return { champion: champion, narrations: narrations, path: path, losses: losses, regular: regularOut };
  }

  /* ---------------- 动态赛制会话（按真实赛制动态晋级，2026-08-19） ---------------- */
  function createDynamicSession(opts) {
    var rosters = opts.rosters;
    if (opts.override_rosters) rosters = Object.assign({}, rosters, opts.override_rosters);
    var fmt = opts.formats[opts.season_id];
    if (!fmt) return null;
    var rng = opts.rng;
    var names = opts.names, tpl = opts.tpl, track = opts.track || null;
    var year = seasonYear(opts.season_id);
    var pnames = {};
    if (opts.players) {
      Object.keys(opts.players).forEach(function (pid) { pnames[pid] = opts.players[pid].name; });
    }
    var regFmt = fmt.regular_format || {};
    var regType = regFmt.type || 'official';
    var phaseDefs = buildPhaseDefs(fmt);
    var strengths = {};
    Object.keys(rosters).forEach(function (fid) {
      strengths[fid] = teamStrength(pickStarter(rosters[fid]), opts.chem);
    });
    if (track != null && strengths[track] !== undefined) strengths[track] += PLAYER_BOOST;
    var losses = {};
    var regularWins = {}, regularGames = {}, regularGf = {}, regularGa = {};
    var phaseIdx = 0, curDef = null;
    var stageQueue = [], pendingNotes = [];
    var groups = {}, rec = {};
    var p10 = null, p10Step = 0;
    var se = null;            // 单败状态 {pool, pairs, title, bo, finalBo, round}
    var d8 = null;            // 8 队双败状态 {w, l, queue}
    var elimPool = null, elimBo = 7, elimFinalBo = 7;
    var done = false, champion = null, trackStopped = false;
    var regularInfo = {}, regularRank = {}, seedNotes = {}, recapDone = false;
    var tree = [];             // 全量对阵记录（赛程图数据）：谁干掉谁
    var currentRoundTag = '';  // 当前阶段的轮次标题（记录进 tree）

    function recordMatch(aId, bId, r) {
      losses[r.loserId] = (losses[r.loserId] || 0) + 1;
      regularWins[r.winnerId] = (regularWins[r.winnerId] || 0) + 1;
      [[aId, r.scoreA, r.scoreB], [bId, r.scoreB, r.scoreA]].forEach(function (t) {
        regularGames[t[0]] = (regularGames[t[0]] || 0) + 1;
        regularGf[t[0]] = (regularGf[t[0]] || 0) + t[1];
        regularGa[t[0]] = (regularGa[t[0]] || 0) + t[2];
      });
      var ra = rec[aId] || (rec[aId] = { wins: 0, games: 0, net: 0 });
      var rb = rec[bId] || (rec[bId] = { wins: 0, games: 0, net: 0 });
      ra.games++; rb.games++;
      if (r.winnerId === aId) { ra.wins++; ra.net += r.scoreA - r.scoreB; rb.net += r.scoreB - r.scoreA; }
      else { rb.wins++; rb.net += r.scoreB - r.scoreA; ra.net += r.scoreA - r.scoreB; }
    }

    function runMatch(aId, bId, bo, record) {
      var r = playMatch(rng, strengths, aId, bId, bo);
      var out = { aId: aId, bId: bId, winnerId: r[0], loserId: r[0] === aId ? bId : aId,
                  scoreA: r[1], scoreB: r[2], results: r[3] };
      tree.push({ round: currentRoundTag || '对局', a: aId, b: bId, w: r[0],
                  sa: r[1], sb: r[2], done: true });
      if (record) recordMatch(aId, bId, out);
      return out;
    }

    function entryFor(m, rndName, bo) {
      var na = names[m.aId] || 'A队', nb = names[m.bId] || 'B队';
      var rosterA = pickStarter(rosters[m.aId] || []), rosterB = pickStarter(rosters[m.bId] || []);
      var trackIsA = track === m.aId;
      var opp = trackIsA ? m.bId : m.aId;
      var scoreTrack = trackIsA ? m.scoreA : m.scoreB;
      var scoreOpp = trackIsA ? m.scoreB : m.scoreA;
      var resultsTrack = trackIsA ? m.results : m.results.map(function (g) { return g === 'A' ? 'B' : 'A'; });
      var oppRoster = trackIsA ? rosterB : rosterA;
      var oppPlayers = oppRoster.map(function (x) { return pnames[x.player_id] || x.player_id; });
      // 同一选手可能同时出现在双方数据里（如玩家把帆帆放狼队、赛季数据里帆帆在 TTG），
      // 统计必须按队区分，战绩只展示主队数据，否则会出现"单赛季 33 MVP"之类的翻倍
      var allStats = simMatchStats(rng, rosterA, rosterB, m.results);
      var trackStats = {};
      Object.keys(allStats).forEach(function (k) {
        if (String(k.split('|')[1]) === String(track)) trackStats[k.split('|')[0]] = allStats[k];
      });
      return {
        round: rndName, opp: names[opp] || '?', opp_players: oppPlayers,
        score: scoreTrack + ':' + scoreOpp, win: m.winnerId === track,
        games: narrateSeries(rng, tpl, na, nb, m.results, rosterA, rosterB, pnames, bo, year),
        results: resultsTrack,
        stats: trackStats
      };
    }

    function teamNote(ids) {
      return ids.map(function (t) { return names[t] || '?'; }).join('、');
    }
    function noteLine(s) { pendingNotes.push(s); }

    function rankOfGroup(ids) {
      return sortByRecord(ids, rec, strengths);
    }
    function allTeamsOf(matches) {
      var out = [];
      (matches || []).forEach(function (m) {
        [m.a_id, m.b_id].forEach(function (t) { if (t && out.indexOf(t) < 0) out.push(t); });
      });
      return out;
    }

    // 官方小组赛 → 每组排名（组名按 matches 推导顺序）
    function rankGroups(matches) {
      // 优先用官方 group 字段命名（S/A/B、大师/精英），缺失时退回 组1/2/3
      var nameById = {};
      (matches || []).forEach(function (m) {
        [['a_id', 'a_group'], ['b_id', 'b_group']].forEach(function (p) {
          var id = m[p[0]], g = m[p[1]];
          if (id && g && !nameById[id]) nameById[id] = g;
        });
      });
      var gs = groupsFromMatches(matches, allTeamsOf(matches));
      var out = {};
      gs.forEach(function (g, i) {
        var name = '组' + (i + 1);
        if (g.length && nameById[g[0]]) {
          var base = String(nameById[g[0]]);
          if (base === 'S' || base === 'A' || base === 'B') name = base;
        }
        out[name] = rankOfGroup(g);
      });
      return out;
    }

    // 第一轮结束 → S/A/B 分组（2021-2022 swap；2023+ by_rank）
    function regroup2() {
      var mode = regFmt.r2_mode || 'by_rank';
      if (mode === 'swap') {
        var s = groups.S || [], a = groups.A || [], b = groups.B || [];
        groups = {
          S: s.slice(0, 4).concat(a.slice(0, 2)),
          A: s.slice(4).concat(a.slice(2, 4)).concat(b.slice(0, 2)),
          B: a.slice(4).concat(b.slice(2))
        };
      } else {
        var S = [], A = [], B = [];
        Object.keys(groups).forEach(function (k) {
          var r = rankOfGroup(groups[k]);
          S = S.concat(r[0], r[1]);
          A = A.concat(r[2], r[3]);
          B = B.concat(r[4], r[5]);
        });
        groups = { S: S.filter(Boolean), A: A.filter(Boolean), B: B.filter(Boolean) };
      }
    }

    function trackIn(list) { return list.indexOf(track) >= 0; }

    function stopTrack(title) {
      trackStopped = true;
      pendingNotes = [title];
    }

    function setupPhase(def) {
      curDef = def;
      stageQueue = [];
      rec = {};
      var kind = def.kind;
      if (kind === 'official_rr') {
        // 外卡：主队不在本赛事参赛名单时，顶替最弱参赛队
        if (track != null && (def.matches || []).length) {
          var participants = allTeamsOf(def.matches);
          if (participants.indexOf(track) < 0 && participants.length) {
            var sortedP = participants.slice().sort(function (x, y) {
              return (strengths[x] || 50) - (strengths[y] || 50);
            });
            var weakestP = sortedP[0];
            def.matches.forEach(function (m) {
              if (m.a_id === weakestP) m.a_id = track;
              if (m.b_id === weakestP) m.b_id = track;
            });
            if (!(track in strengths)) strengths[track] = 50.0;
            noteLine((names[track] || '这支队伍') + '以外卡身份顶替' + (names[weakestP] || '?') +
              '，登上' + (fmt.name || '本次赛事') + '的舞台。');
            noteLine('注：在原时间线中，该战队未进入' + (fmt.name || '本次赛事') + '，故以外卡身份参赛。');
          }
        }
        (def.matches || []).forEach(function (m) {
          stageQueue.push({ aId: m.a_id, bId: m.b_id, bo: def.bo || 5, title: def.title });
        });
        if (def.r1 || def.single || def.groupStage || def.annual || def.swiss) {
          groups = rankGroups(def.matches);
        }
      } else if (kind === 'rr_regroup') {
        var g = groups;
        Object.keys(g).forEach(function (gn) {
          if (!g[gn] || !g[gn].length) return;
          rrSchedule(g[gn]).forEach(function (p) {
            stageQueue.push({ aId: p[0], bId: p[1], bo: def.bo || 5, title: def.title + '·' + gn + '组' });
          });
        });
        if (def.r3 && trackStopped) return;
      } else if (kind === 'playin_sab') {
        var s = groups.S || [], a = groups.A || [], b = groups.B || [];
        var pairs = [[s[4], a[1]], [s[5], a[0]], [a[4], b[1]], [a[5], b[0]]];
        pairs.forEach(function (p) {
          if (p[0] && p[1]) stageQueue.push({ aId: p[0], bId: p[1], bo: def.bo || 7, title: def.title });
        });
      } else if (kind === 'kpl_playoff10') {
        var S = groups.S || [], A = groups.A || [];
        if (regType === 'kpl_single') {
          p10 = kplPlayoff10(S.slice(0, 4), A.slice(0, 6), 'legacy');
          if (track != null && !(trackIn(S.slice(0, 4)) || trackIn(A.slice(0, 6)))) stopTrack('常规赛收官，' + (names[track] || '本队') + '未能进入季后赛');
        } else {
          p10 = kplPlayoff10(S.slice(0, 6), A.slice(0, 4), 'sab');
          if (track != null && !(trackIn(S.slice(0, 6)) || trackIn(A.slice(0, 4)))) stopTrack('常规赛收官，' + (names[track] || '本队') + '未能进入季后赛');
        }
        p10Step = 0;
      } else if (kind === 'after_groups') {
        elimPool = groups.__advance || [];
        elimBo = def.bo || 7;
        elimFinalBo = def.finalBo || elimBo;
        se = { pool: elimPool, pairs: null, title: def.title, bo: elimBo, finalBo: elimFinalBo, round: 1 };
        if (track != null && !trackIn(elimPool)) stopTrack('小组赛收官，' + (names[track] || '本队') + '未能出线');
      } else if (kind === 'annual_survive') {
        var m5 = groups.__masterTail || [], e5 = groups.__eliteTail || [];
        se = { pool: m5.concat(e5), pairs: null, title: def.title, bo: def.bo || 7, finalBo: def.bo || 7, round: 1, survive: true };
        if (track != null && !(trackIn(se.pool) || trackIn(groups.__direct || []))) {
          stopTrack('擂台赛收官，' + (names[track] || '本队') + '未能进入淘汰赛阶段');
        }
      } else if (kind === 'bracket_r16') {
        elimPool = groups.__w32 || [];
        elimBo = def.bo || 7;
        se = { pool: elimPool, pairs: null, title: def.title, bo: elimBo, finalBo: elimBo, round: 1 };
        if (track != null && !trackIn(elimPool)) stopTrack('32强战罢，' + (names[track] || '本队') + '未能晋级16强');
      } else if (kind === 'de8') {
        elimPool = groups.__q8 || elimPool || [];
        elimBo = def.bo || 7;
        elimFinalBo = def.finalBo || elimBo;
        d8 = { w: elimPool.slice(), l: [], queue: [] };
        // 官方 8 强双败轮次：W1、L1、W2、L2、L3(2队)、胜决、败决、总决赛。
        // 关键：L3（败者组 2 队互打）在胜者组决赛之前；胜者组决赛败者
        // 直接进入败者组决赛（只打一场），而不是再打两轮。
        var w = d8.w.slice(), l = [];
        var wR = 0, lR = 0;
        while (w.length > 2) {
          wR += 1;
          d8.queue.push({ tag: '胜者组第' + wR + '轮', kind: 'w' });
          l = l.concat(new Array(Math.floor(w.length / 2)));
          if (l.length >= 2) {
            lR += 1;
            d8.queue.push({ tag: '败者组第' + lR + '轮', kind: 'l' });
          }
          w = new Array(Math.ceil(w.length / 2));
        }
        lR += 1;
        d8.queue.push({ tag: '败者组第' + lR + '轮', kind: 'l' }); // L3：2 队
        d8.queue.push({ tag: '胜者组决赛', kind: 'w' });    // 胜决
        d8.queue.push({ tag: '败者组决赛', kind: 'lf' });   // L3 胜者 vs 胜决败者
        d8.queue.push({ tag: '总决赛', kind: 'final1' });
        if (track != null && !trackIn(elimPool)) stopTrack((def.title || '淘汰赛') + '开赛，' + (names[track] || '本队') + '未能晋级');
      }
    }

    // 阶段收尾：排名/重组/生成说明与下一阶段名单
    function finishPhase(def) {
      var kind = def.kind;
      if (kind === 'official_rr') {
        if (def.r1) {
          regroup2();
          noteLine('常规赛第一轮战罢，S组：' + teamNote(groups.S));
          noteLine('A组：' + teamNote(groups.A) + '；B组：' + teamNote(groups.B));
        } else if (def.single) {
          var all = Object.keys(rec).sort(function (x, y) {
            var rx = rec[x], ry = rec[y];
            if (ry.wins !== rx.wins) return ry.wins - rx.wins;
            if (ry.net !== rx.net) return ry.net - rx.net;
            return (strengths[y] || 50) - (strengths[x] || 50);
          });
          var S10 = all.slice(0, 4), A10 = all.slice(4, 10);
          groups.S = S10; groups.A = A10;
          var qual = regFmt.playoff_qualify || 10;
          if (track != null && all.indexOf(track) >= qual) stopTrack('常规赛收官，' + (names[track] || '本队') + '排名第' + (all.indexOf(track) + 1) + '，无缘季后赛');
          noteLine('常规赛收官，前' + qual + '名晋级季后赛：' + teamNote(all.slice(0, qual)));
        } else if (def.groupStage) {
          var adv = [];
          var gKeys = Object.keys(groups);
          var per = regFmt.advance || 4;
          gKeys.forEach(function (k) { adv = adv.concat(groups[k].slice(0, per)); });
          // 种子队（官方淘汰赛首轮里有、小组赛没有的队）
          var treeFirst = null;
          fmt.rounds.forEach(function (r) {
            if (!treeFirst && ['single_elim', 'double_elim', 'playoffs', 'final'].indexOf(r.type) >= 0 && r.matches && r.matches.length) treeFirst = r;
          });
          var groupTeams = allTeamsOf(def.matches);
          var seeds = [];
          if (treeFirst) {
            allTeamsOf(treeFirst.matches).forEach(function (t) { if (groupTeams.indexOf(t) < 0 && seeds.indexOf(t) < 0) seeds.push(t); });
          }
          adv = adv.concat(seeds.slice(0, regFmt.seeds || 0));
          // 种子排序：小组第一名在前，其余按组序+排名
          var seeded = [];
          gKeys.forEach(function (k) { seeded = seeded.concat(groups[k]); });
          var pool = [];
          gKeys.forEach(function (k) { if (groups[k][0]) pool.push(groups[k][0]); });
          adv.forEach(function (t) { if (pool.indexOf(t) < 0 && seeded.indexOf(t) >= 0) pool.push(t); });
          seeds.forEach(function (t) { if (pool.indexOf(t) < 0) pool.push(t); });
          groups.__advance = pool;
          noteLine('小组赛战罢，' + pool.length + '支队伍晋级淘汰赛：' + teamNote(pool));
          if (track != null && !trackIn(pool)) stopTrack('小组赛收官，' + (names[track] || '本队') + '未能晋级淘汰赛');
        } else if (def.annual) {
          // 大师/精英分组：官方擂台赛 matches 的 group 字段（S=大师、A=精英）
          var masters = [], elite = [];
          (def.matches || []).forEach(function (m) {
            var items = [[m.a_id, m.a_group], [m.b_id, m.b_group]];
            items.forEach(function (it) {
              if (!it[0]) return;
              var g = String(it[1] || '');
              if (g === 'S' || g.indexOf('大师') >= 0) { if (masters.indexOf(it[0]) < 0) masters.push(it[0]); }
              else if (g === 'A' || g.indexOf('精英') >= 0) { if (elite.indexOf(it[0]) < 0) elite.push(it[0]); }
            });
          });
          if (!masters.length || !elite.length) {
            var order = Object.keys(rec).sort(function (x, y) {
              var rx = rec[x], ry = rec[y];
              if (ry.wins !== rx.wins) return ry.wins - rx.wins;
              if (ry.net !== rx.net) return ry.net - rx.net;
              return (strengths[y] || 50) - (strengths[x] || 50);
            });
            masters = order.slice(0, 6);
            elite = order.slice(6);
          }
          var mOrder = rankOfGroup(masters), eOrder = rankOfGroup(elite);
          if (mOrder.length < 6 && eOrder.length > 6) {
            var extra = eOrder.slice(6);
            mOrder = mOrder.concat(extra.slice(0, 6 - mOrder.length));
            eOrder = eOrder.slice(0, 6);
          }
          groups.__master = mOrder; groups.__elite = eOrder;
          groups.__masterTail = mOrder.slice(4);   // 大师 5-6
          groups.__eliteTail = eOrder.slice(1, 5); // 精英 2-5
          groups.__direct = mOrder.slice(0, 4).concat(eOrder.slice(0, 1)); // 大师前4 + 精英第1
          noteLine('擂台赛战罢，大师组前四与精英组第一直进淘汰赛：' + teamNote(groups.__direct));
          noteLine('突围赛：' + teamNote(groups.__masterTail.concat(groups.__eliteTail)));
          if (track != null && !(trackIn(groups.__direct) || trackIn(groups.__masterTail) || trackIn(groups.__eliteTail))) {
            stopTrack('擂台赛收官，' + (names[track] || '本队') + '未能进入淘汰赛阶段');
          }
        } else if (def.swiss) {
          var swOrder = Object.keys(rec).sort(function (x, y) {
            var rx = rec[x], ry = rec[y];
            if (ry.wins !== rx.wins) return ry.wins - rx.wins;
            if (ry.net !== rx.net) return ry.net - rx.net;
            return (strengths[y] || 50) - (strengths[x] || 50);
          });
          groups.__advance = swOrder.slice(0, regFmt.advance || 8);
          noteLine('小组赛（瑞士轮）战罢，' + (regFmt.advance || 8) + '支队伍晋级淘汰赛：' + teamNote(groups.__advance));
          if (track != null && !trackIn(groups.__advance)) stopTrack('小组赛收官，' + (names[track] || '本队') + '未能晋级淘汰赛');
        } else if (def.bracket) {
          // 32 强为单败：按官方对阵逐场取胜者，动态生成 16 强
          var w32 = [];
          (def.matches || []).forEach(function (m) {
            var ra = rec[m.a_id] || { wins: 0 }, rb = rec[m.b_id] || { wins: 0 };
            var w = ra.wins >= rb.wins ? m.a_id : m.b_id;
            if (w && w32.indexOf(w) < 0) w32.push(w);
          });
          groups.__w32 = w32;
          noteLine('32强战罢，' + w32.length + '支战队晋级16强');
          if (track != null && !trackIn(w32)) stopTrack('32强战罢，' + (names[track] || '本队') + '未能晋级16强');
        }
      } else if (kind === 'rr_regroup') {
        if (def.r2) {
          // 生成卡位赛所需分组排名
          Object.keys(groups).forEach(function (gn) { groups[gn] = rankOfGroup(groups[gn]); });
          noteLine('常规赛第二轮战罢，卡位赛：S组第5/6名对阵A组前2名，A组第5/6名对阵B组前2名');
        } else if (def.r3) {
          groups.S = rankOfGroup(groups.S || []);
          groups.A = rankOfGroup(groups.A || []);
          var S6 = groups.S, A4 = groups.A.slice(0, 4);
          noteLine('常规赛第三轮战罢，S组前六与A组前四晋级季后赛：' + teamNote(S6.concat(A4)));
          if (track != null && !(trackIn(S6) || trackIn(A4))) {
            stopTrack('常规赛收官，' + (names[track] || '本队') + '未能进入季后赛');
          }
        }
      } else if (kind === 'playin_sab') {
        // 卡位赛结果：S5/S6 vs A1/A2 胜者进 S；A5/A6 vs B1/B2 胜者进 A
        var s = groups.S || [], a = groups.A || [], b = groups.B || [];
        var sWin = [], aFail = [], aWin = [];
        [[s[4], a[1]], [s[5], a[0]]].forEach(function (p) {
          if (!p[0] || !p[1]) return;
          var ra = rec[p[0]] || { wins: 0 }, rb = rec[p[1]] || { wins: 0 };
          var w = ra.wins > rb.wins ? p[0] : p[1];
          sWin.push(w);
          aFail.push(w === p[0] ? p[1] : p[0]);
        });
        [[a[4], b[1]], [a[5], b[0]]].forEach(function (p) {
          if (!p[0] || !p[1]) return;
          var ra = rec[p[0]] || { wins: 0 }, rb = rec[p[1]] || { wins: 0 };
          aWin.push(ra.wins > rb.wins ? p[0] : p[1]);
        });
        var s6 = s.slice(0, 4).concat(sWin);
        var a6 = a.slice(2, 4).concat(aFail).concat(aWin);
        groups.S = rankOfGroup(s6);
        groups.A = rankOfGroup(a6);
        groups.B = [];
        noteLine('卡位赛结束，B组队伍无缘常规赛第三轮');
        if (track != null && !(trackIn(groups.S) || trackIn(groups.A))) {
          stopTrack('卡位赛失利，' + (names[track] || '本队') + '止步常规赛');
        }
      }
    }

    // 淘汰赛一轮（返回 entries 卡；完成返回 null）
    function elimStep(def) {
      var kind = def.kind;
      // 返回协议：{card: 展示卡} 有主队场次；{done: true} 本阶段完成；null 继续推进（无主队场次）
      if (kind === 'kpl_playoff10') {
        if (p10Step === 0) {
          var ws = runPairs(p10.wPairs, '胜者组半决赛', def.bo || 7);
          p10.w2 = ws.winners; p10.wLosers = ws.losers; p10Step = 1;
          return ws.entries.length ? { card: { kind: 'regular_round', title: '胜者组半决赛', entries: ws.entries } } : null;
        }
        if (p10Step === 1) {
          var ls1 = runPairs(p10.l1Pairs, '败者组第一轮', def.bo || 7);
          p10.l2 = ls1.winners; p10Step = 2;
          return ls1.entries.length ? { card: { kind: 'regular_round', title: '败者组第一轮', entries: ls1.entries } } : null;
        }
        if (p10Step === 2) {
          if (p10.mode === 'legacy') {
            // 败者组第二轮：3 胜者 + 2 半决败者 = 5 队，轮空种子最高的半决败者，打 2 场
            var pairsL2 = [[p10.l2[0], p10.l2[1]], [p10.l2[2], p10.wLosers[1]]];
            var ls2l = runPairs(pairsL2, '败者组第二轮', def.bo || 7);
            p10.l3 = ls2l.winners.concat(p10.wLosers[0]);
            p10Step = 3;
            return ls2l.entries.length ? { card: { kind: 'regular_round', title: '败者组第二轮', entries: ls2l.entries } } : null;
          }
          var pairs2 = [[p10.l2[0], p10.late[0]], [p10.l2[1], p10.late[1]]];
          var ls2 = runPairs(pairs2, '败者组第二轮', def.bo || 7);
          p10.l3 = ls2.winners; p10Step = 3;
          return ls2.entries.length ? { card: { kind: 'regular_round', title: '败者组第二轮', entries: ls2.entries } } : null;
        }
        if (p10Step === 3) {
          var wf = runPairs([[p10.w2[0], p10.w2[1]]], '胜者组决赛', def.bo || 7);
          p10.wChamp = wf.winners[0]; p10.wLoser = wf.losers[0]; p10Step = 4;
          return wf.entries.length ? { card: { kind: 'regular_round', title: '胜者组决赛', entries: wf.entries } } : null;
        }
        if (p10Step === 4) {
          if (p10.mode === 'legacy') {
            // 败者组第三轮：L2 的 3 队打 1 场 + 轮空 → 2 队（半决赛席位）
            // 胜者组决赛败者不在这里入场，留到败者组决赛（只打一场）
            var pairsL3 = [[p10.l3[0], p10.l3[1]]];
            var ls3l = runPairs(pairsL3, '败者组第三轮', def.bo || 7);
            p10.l4 = ls3l.winners.concat(p10.l3[2]);
            p10Step = 5;
            return ls3l.entries.length ? { card: { kind: 'regular_round', title: '败者组第三轮', entries: ls3l.entries } } : null;
          }
          var pairs3 = [[p10.l3[0], p10.wLosers[0]], [p10.l3[1], p10.wLosers[1]]];
          var ls3 = runPairs(pairs3, '败者组第三轮', def.bo || 7);
          p10.l4 = ls3.winners; p10Step = 5;
          return ls3.entries.length ? { card: { kind: 'regular_round', title: '败者组第三轮', entries: ls3.entries } } : null;
        }
        if (p10Step === 5) {
          // 败者组半决赛：2 队 1 场，胜者获得败者组决赛资格
          var pairsSemis = [[p10.l4[0], p10.l4[1]]];
          var lsSemis = runPairs(pairsSemis, '败者组半决赛', def.bo || 7);
          p10.l5 = lsSemis.winners;
          p10Step = 6;
          return lsSemis.entries.length ? { card: { kind: 'regular_round', title: '败者组半决赛', entries: lsSemis.entries } } : null;
        }
        if (p10Step === 6) {
          // 败者组决赛：半决赛胜者 vs 胜者组决赛败者，一场定生死
          var lf = runPairs([[p10.l5[0], p10.wLoser]], '败者组决赛', def.bo || 7);
          p10.lChamp = lf.winners[0]; p10Step = 7;
          return lf.entries.length ? { card: { kind: 'regular_round', title: '败者组决赛', entries: lf.entries } } : null;
        }
        if (p10Step === 7) {
          var fin = runPairs([[p10.wChamp, p10.lChamp]], '总决赛', def.bo || 7);
          champion = fin.winners[0]; done = true;
          return fin.entries.length ? { card: { kind: 'regular_round', title: '总决赛', entries: fin.entries } } : { done: true };
        }
        return { done: true };
      }
      if (kind === 'de8') {
        if (!d8) return { done: true };
        while (d8.queue.length) {
          var s = d8.queue.shift();
          if (s.kind === 'w') {
            var pairsW = [];
            for (var i = 0; i + 1 < d8.w.length; i += 2) pairsW.push([d8.w[i], d8.w[i + 1]]);
            var resW = runPairs(pairsW, '胜者组', elimBo);
            d8.l = d8.l.concat(resW.losers);
            d8.w = resW.winners.concat(d8.w.length % 2 ? [d8.w[d8.w.length - 1]] : []);
            if (resW.entries.length) return { card: { kind: 'regular_round', title: '胜者组', entries: resW.entries } };
            continue;
          }
          if (s.kind === 'l') {
            var pairsL = [];
            for (var k = 0; k + 1 < d8.l.length; k += 2) pairsL.push([d8.l[k], d8.l[k + 1]]);
            var resL = runPairs(pairsL, '败者组', elimBo);
            d8.l = resL.winners.concat(d8.l.length % 2 ? [d8.l[d8.l.length - 1]] : []);
            if (resL.entries.length) return { card: { kind: 'regular_round', title: '败者组', entries: resL.entries } };
            continue;
          }
          if (s.kind === 'lf') {
            // 败者组决赛：L3 胜者 vs 胜者组决赛败者（各输一场的 2 队），一场定生死
            while (d8.l.length > 2) {
              var pairsPre = [];
              for (var mp = 0; mp + 1 < d8.l.length; mp += 2) pairsPre.push([d8.l[mp], d8.l[mp + 1]]);
              var resPre = runPairs(pairsPre, '败者组', elimBo);
              d8.l = resPre.winners.concat(d8.l.length % 2 ? [d8.l[d8.l.length - 1]] : []);
              if (resPre.entries.length) return { card: { kind: 'regular_round', title: '败者组', entries: resPre.entries } };
            }
            var pairsLF = [];
            for (var m = 0; m + 1 < d8.l.length; m += 2) pairsLF.push([d8.l[m], d8.l[m + 1]]);
            var resLF = runPairs(pairsLF, '败者组决赛', elimBo);
            d8.l = resLF.winners;
            if (resLF.entries.length) return { card: { kind: 'regular_round', title: '败者组决赛', entries: resLF.entries } };
            continue;
          }
          if (s.kind === 'final1') {
            if (!d8.l.length) { champion = d8.w[0]; done = true; return { done: true }; }
            var rf = runPairs([[d8.w[0], d8.l[0]]], '总决赛', elimFinalBo);
            champion = rf.winners[0]; done = true;
            if (rf.entries.length) return { card: { kind: 'regular_round', title: '总决赛', entries: rf.entries } };
            return { done: true };
          }
        }
        done = true;
        return { done: true };
      }
      if (kind === 'after_groups' || kind === 'bracket_r16' || kind === 'annual_survive') {
        if (!se) return { done: true };
        if (kind === 'annual_survive') {
          // 突围赛：6 队一轮 BO7 单败（3 场），胜者 3 队与直进队会师淘汰赛
          if (!se.pairs) se.pairs = bracketPair(se.pool);
          var resS = runPairs(se.pairs, def.title, se.bo || 7);
          groups.__q8 = groups.__direct.concat(resS.winners);
          se = null;
          if (track != null && !trackIn(groups.__q8)) stopTrack('突围赛失利，' + (names[track] || '本队') + '止步' + def.title);
          if (resS.entries.length) return { card: { kind: 'regular_round', title: def.title, entries: resS.entries } };
          return { done: true };
        }
        var isFinal = se.pool.length <= 2;
        var bo = isFinal ? se.finalBo : se.bo;
        var pairs = se.pairs || bracketPair(se.pool);
        var roundName = isFinal ? '总决赛' : (se.pool.length >= 16 ? '16强' : se.pool.length === 8 ? '8强' : se.pool.length === 4 ? '半决赛' : '淘汰赛·第' + se.round + '轮');
        var res = runPairs(pairs, roundName, bo);
        se.pool = res.winners;
        se.pairs = null;
        se.round++;
        if (kind === 'bracket_r16') {
          // 16 强单败一轮 16→8，之后交给 8 强双败（de8）
          groups.__q8 = se.pool;
          se = null;
          if (res.entries.length) return { card: { kind: 'regular_round', title: roundName, entries: res.entries } };
          return { done: true };
        }
        if (se.pool.length <= 1) {
          champion = se.pool[0]; done = true;
          if (res.entries.length) return { card: { kind: 'regular_round', title: roundName, entries: res.entries } };
          return { done: true };
        }
        if (res.entries.length) return { card: { kind: 'regular_round', title: roundName, entries: res.entries } };
        return null;
      }
      return null;
    }

    function runPairs(pairs, title, bo) {
      var winners = [], losers = [], entries = [];
      currentRoundTag = title;
      pairs.forEach(function (p) {
        if (!p[0] || !p[1]) return;
        var r = runMatch(p[0], p[1], bo, true);
        winners.push(r.winnerId);
        losers.push(r.loserId);
        if (track != null && (track === p[0] || track === p[1])) {
          entries.push(entryFor({ aId: p[0], bId: p[1], winnerId: r.winnerId, scoreA: r.scoreA, scoreB: r.scoreB, results: r.results }, title, bo));
        }
      });
      return { winners: winners, losers: losers, entries: entries };
    }

    function computeRegular() {
      if (!Object.keys(regularGames).length) return;
      var order = Object.keys(regularGames).sort(function (a, b) {
        var wa = -(regularWins[a] || 0), wb = -(regularWins[b] || 0);
        if (wa !== wb) return wa - wb;
        var na = (regularGa[a] || 0) - (regularGf[a] || 0);
        var nb2 = (regularGa[b] || 0) - (regularGf[b] || 0);
        if (na !== nb2) return na - nb2;
        return (strengths[b] || 50) - (strengths[a] || 50);
      });
      order.forEach(function (fid, i) {
        regularRank[fid] = i + 1;
        regularInfo[fid] = { rank: i + 1, wins: regularWins[fid] || 0, losses: regularGames[fid] - (regularWins[fid] || 0), games: regularGames[fid], net: (regularGf[fid] || 0) - (regularGa[fid] || 0) };
      });
    }

    function recapLines() {
      var lines = [];
      var info = track != null ? regularInfo[track] : null;
      if (info) {
        var recapTpls = tpl.regular_recap || ['常规赛收官，{team}以第{rank}名进入季后赛。'];
        lines.push(rng.choice(recapTpls).replace(/\{team\}/g, names[track]).replace(/\{rank\}/g, info.rank).replace(/\{wins\}/g, info.wins).replace(/\{losses\}/g, info.losses));
      }
      return lines.concat(seedNotes[track] || []);
    }

    return {
      setRoster: function (fid, records) {
        rosters[fid] = records;
        strengths[fid] = teamStrength(records, opts.chem);
      },
      next: function () {
        var guard = 0;
        while (guard++ < 2000) {
          if (done) return { kind: 'done', title: '赛季收官', champion: champion };
          // 1) 跑当前阶段对阵
          if (curDef && stageQueue.length) {
            var q = stageQueue.shift();
            currentRoundTag = q.title;
            var r = runMatch(q.aId, q.bId, q.bo, true);
            if (track != null && (track === q.aId || track === q.bId)) {
              return { kind: 'regular_round', title: q.title, entries: [entryFor({ aId: q.aId, bId: q.bId, winnerId: r.winnerId, scoreA: r.scoreA, scoreB: r.scoreB, results: r.results }, q.title, q.bo)] };
            }
            continue;
          }
          // 2) 当前阶段完成 → 收尾
          if (curDef) {
            var isElim = ['kpl_playoff10', 'de8', 'after_groups', 'bracket_r16', 'annual_survive'].indexOf(curDef.kind) >= 0;
            if (isElim) {
              if (pendingNotes.length) { continue; }  // 先出说明/止步卡
              var st = elimStep(curDef);
              if (st && st.card) return st.card;
              if (st && st.done) { curDef = null; continue; }
              continue;
            }
            finishPhase(curDef);
            curDef = null;
            continue;
          }
          // 3) 说明卡
          if (pendingNotes.length) {
            var nl = pendingNotes;
            pendingNotes = [];
            if (trackStopped) {
              computeRegular();
              done = true;
              return { kind: 'regular_recap', title: '赛季落幕', lines: nl };
            }
            return { kind: 'regular_recap', title: '赛程动态', lines: nl };
          }
          // 4) 进入下一阶段
          if (phaseIdx >= phaseDefs.length) {
            computeRegular();
            if (!recapDone) {
              recapDone = true;
              return { kind: 'regular_recap', title: '赛季收官', lines: recapLines() };
            }
            done = true;
            return { kind: 'done', title: '赛季收官', champion: champion };
          }
          var def = phaseDefs[phaseIdx++];
          setupPhase(def);
          if (curDef && ['kpl_playoff10', 'de8', 'after_groups', 'bracket_r16', 'annual_survive'].indexOf(curDef.kind) >= 0) {
            if (pendingNotes.length) { continue; }  // 止步/说明卡优先
            var st2 = elimStep(curDef);
            if (st2 && st2.card) return st2.card;
            if (st2 && st2.done) { curDef = null; continue; }
            continue;
          }
        }
        done = true;
        return { kind: 'done', title: '赛季收官', champion: champion };
      },
      getRegular: function () {
        computeRegular();
        return { standings: regularInfo, track: track != null ? (regularInfo[track] || null) : null, seed_notes: seedNotes[track] || [] };
      },
      getTree: function () { return tree; },
      isDone: function () { return done; },
      getChampion: function () { return champion; }
    };
  }

  /* ---------------- 分阶段模拟（轮间可换人） ---------------- */
  function createSession(opts) {
    var fmt0 = opts.formats[opts.season_id];
    if (fmt0 && ((fmt0.regular_format || {}).type || 'official') !== 'official') {
      return createDynamicSession(opts);
    }
    var rosters = opts.rosters;
    if (opts.override_rosters) rosters = Object.assign({}, rosters, opts.override_rosters);
    var fmt = opts.formats[opts.season_id];
    if (!fmt) return null;
    var rng = opts.rng;
    var names = opts.names, tpl = opts.tpl, track = opts.track || null;
    var year = seasonYear(opts.season_id);
    var pnames = {};
    if (opts.players) {
      Object.keys(opts.players).forEach(function (pid) { pnames[pid] = opts.players[pid].name; });
    }

    var strengths = {};
    Object.keys(rosters).forEach(function (fid) {
      strengths[fid] = teamStrength(pickStarter(rosters[fid]), opts.chem);
    });
    if (track != null && strengths[track] !== undefined) strengths[track] += PLAYER_BOOST;
    var losses = {};
    var regularWins = {}, regularGames = {}, regularGf = {}, regularGa = {};

    // 轮队列
    var regularQueue = [], playInQueue = [], treeRounds = [];
    fmt.rounds.forEach(function (rnd) {
      if (rnd.type === 'round_robin') {
        (rnd.matches || []).forEach(function (m) { regularQueue.push({ rnd: rnd, m: m }); });
      } else if (rnd.type === 'play_in') {
        (rnd.matches || []).forEach(function (m) { playInQueue.push({ rnd: rnd, m: m }); });
      } else if (['single_elim', 'double_elim', 'playoffs', 'final'].indexOf(rnd.type) >= 0) {
        treeRounds.push(rnd);
      }
    });

    var teams = [];
    var wildcardNote = null;
    if (treeRounds.length) {
      var firstRound = treeRounds[0];
      (firstRound.matches || []).forEach(function (m) {
        if (teams.indexOf(m.a_id) < 0) teams.push(m.a_id);
        if (teams.indexOf(m.b_id) < 0) teams.push(m.b_id);
      });
      teams.forEach(function (t) { if (!(t in strengths)) strengths[t] = 50.0; });
      // 外卡：玩家队不在本赛事参赛名单时，顶替首轮最弱队，并优先对阵剩余最弱对手，保证有真实对阵与战报
      if (track != null && teams.indexOf(track) < 0 && teams.length) {
        var sortedT = teams.slice().sort(function (x, y) {
          return (strengths[x] || 50) - (strengths[y] || 50);
        });
        var weakest = sortedT[0];
        var secondWeak = sortedT[1] || null;
        var replacedNote = names[weakest] || '?';
        var idxW = teams.indexOf(weakest);
        teams[idxW] = track;
        if (secondWeak && Math.floor(teams.indexOf(secondWeak) / 2) !== Math.floor(idxW / 2)) {
          var idxS = teams.indexOf(secondWeak);
          var posOppW = idxW % 2 === 0 ? idxW + 1 : idxW - 1;
          var oppW = teams[posOppW];
          teams[posOppW] = secondWeak;
          teams[idxS] = oppW;
        }
        if (!(track in strengths)) strengths[track] = 50.0;
        var firstOpp = teams[idxW % 2 === 0 ? idxW + 1 : idxW - 1];
        wildcardNote = [
          (names[track] || '这支队伍') + '以外卡身份顶替' + replacedNote +
            '，登上' + (fmt.name || '本次赛事') + '的淘汰赛舞台，首轮对阵' + (names[firstOpp] || '?') + '。',
          '注：在原时间线中，该战队未进入' + (fmt.name || '本次赛事') + '，故以外卡身份参赛。'
        ];
      }
    }
    var cfgType = (fmt.playoff_config || {}).type;
    var singleRounds = treeRounds.filter(function (r) {
      return r.type === 'single_elim' || (cfgType === 'single_elim' && (r.type === 'playoffs' || r.type === 'final'));
    });
    var multiRounds = treeRounds.filter(function (r) {
      return cfgType !== 'single_elim' && ['double_elim', 'playoffs', 'final'].indexOf(r.type) >= 0;
    });
    var singleIdx = 0;
    var current = teams.slice();
    var champion = null;
    var regularRank = {}, regularInfo = {}, seedNotes = {};
    var recapDone = false;
    var d = null;          // 双败状态
    var done = false;
    var finalBo = 7;
    var tree = [];
    var currentRoundTag = '';
    if (multiRounds.length) {
      finalBo = multiRounds[0].bo || 7;
      var finalR = multiRounds.filter(function (r) { return r.type === 'final'; });
      if (finalR.length && finalR[0].bo) finalBo = finalR[0].bo;
    }

    function runMatch(aId, bId, bo, record) {
      var r = playMatch(rng, strengths, aId, bId, bo);
      var winnerId = r[0], scoreA = r[1], scoreB = r[2], results = r[3];
      var loserId = winnerId === aId ? bId : aId;
      tree.push({ round: currentRoundTag || '对局', a: aId, b: bId, w: winnerId,
                  sa: scoreA, sb: scoreB, done: true });
      if (record) {
        losses[loserId] = (losses[loserId] || 0) + 1;
        regularWins[winnerId] = (regularWins[winnerId] || 0) + 1;
        [[aId, scoreA, scoreB], [bId, scoreB, scoreA]].forEach(function (t) {
          regularGames[t[0]] = (regularGames[t[0]] || 0) + 1;
          regularGf[t[0]] = (regularGf[t[0]] || 0) + t[1];
          regularGa[t[0]] = (regularGa[t[0]] || 0) + t[2];
        });
      }
      return { aId: aId, bId: bId, winnerId: winnerId, loserId: loserId,
               scoreA: scoreA, scoreB: scoreB, results: results };
    }

    function entryFor(m, rndName, bo) {
      var aId = m.aId, bId = m.bId;
      var na = names[aId] || 'A队', nb = names[bId] || 'B队';
      var rosterA = pickStarter(rosters[aId] || []), rosterB = pickStarter(rosters[bId] || []);
      var trackIsA = track === aId;
      var opp = trackIsA ? bId : aId;
      var oppRoster = trackIsA ? rosterB : rosterA;
      var oppPlayers = oppRoster.map(function (x) { return pnames[x.player_id] || x.player_id; });
      var scoreTrack = trackIsA ? m.scoreA : m.scoreB;
      var scoreOpp = trackIsA ? m.scoreB : m.scoreA;
      var resultsTrack = trackIsA ? m.results : m.results.map(function (g) { return g === 'A' ? 'B' : 'A'; });
      return {
        round: rndName, opp: names[opp] || '?', opp_players: oppPlayers,
        score: scoreTrack + ':' + scoreOpp, win: m.winnerId === track,
        games: narrateSeries(rng, tpl, na, nb, m.results, rosterA, rosterB, pnames, bo, year),
        results: resultsTrack,
        stats: simMatchStats(rng, rosterA, rosterB, m.results)
      };
    }

    function computeRegular() {
      if (!Object.keys(regularGames).length) return;
      var order = Object.keys(regularGames).sort(function (a, b) {
        var wa = -(regularWins[a] || 0), wb = -(regularWins[b] || 0);
        if (wa !== wb) return wa - wb;
        var na = (regularGa[a] || 0) - (regularGf[a] || 0);
        var nb2 = (regularGa[b] || 0) - (regularGf[b] || 0);
        if (na !== nb2) return na - nb2;
        var sa = -(strengths[a] || 50), sb = -(strengths[b] || 50);
        if (sa !== sb) return sa - sb;
        return a < b ? -1 : 1;
      });
      order.forEach(function (fid, i) {
        regularRank[fid] = i + 1;
        regularInfo[fid] = {
          rank: i + 1, wins: regularWins[fid] || 0,
          losses: regularGames[fid] - (regularWins[fid] || 0),
          games: regularGames[fid], net: (regularGf[fid] || 0) - (regularGa[fid] || 0)
        };
      });
      var seedTpl = tpl.seed_lines || {};
      for (var pi = 0; pi < teams.length; pi += 2) {
        var a = teams[pi], b = teams[pi + 1];
        if (b == null) continue;
        var ra = regularRank[a], rb = regularRank[b];
        if (!ra || !rb) continue;
        var gap = Math.abs(ra - rb);
        function seedLine(side, oppSide, rankSide, rankOpp) {
          var pool;
          if (gap >= 2 && rankSide > rankOpp) pool = seedTpl.underdog || [];
          else if (gap >= 2 && rankSide < rankOpp) pool = seedTpl.favorite || [];
          else pool = seedTpl.neutral || [];
          return rng.choice(pool)
            .replace(/\{team\}/g, names[side] || side)
            .replace(/\{opp\}/g, names[oppSide] || oppSide)
            .replace(/\{rank\}/g, rankSide)
            .replace(/\{opp_rank\}/g, rankOpp);
        }
        if (track != null && (track === a || track === b)) {
          var opp = track === a ? b : a;
          var line = seedLine(track, opp, regularRank[track], regularRank[opp]);
          (seedNotes[track] = seedNotes[track] || []).push(line);
        } else if (gap >= 3) {
          var low = ra > rb ? a : b, high = low === a ? b : a;
          var rl = Math.max(ra, rb), rh = Math.min(ra, rb);
          (seedNotes[low] = seedNotes[low] || []).push(seedLine(low, high, rl, rh));
        }
      }
    }

    function recapLines() {
      var lines = [];
      var info = track != null ? regularInfo[track] : null;
      if (info) {
        var recapTpls = tpl.regular_recap || ['常规赛收官，{team}以第{rank}名进入季后赛。'];
        lines.push(rng.choice(recapTpls)
          .replace(/\{team\}/g, names[track])
          .replace(/\{rank\}/g, info.rank)
          .replace(/\{wins\}/g, info.wins)
          .replace(/\{losses\}/g, info.losses));
      }
      lines = lines.concat(seedNotes[track] || []);
      return lines;
    }

    function pairEntries(pairs, tag) {
      var winners = [], entries = [];
      currentRoundTag = tag;
      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];
        var r = runMatch(pair[0], pair[1], pair[2], false);
        winners.push(r.winnerId);
        if (track != null && (track === pair[0] || track === pair[1])) {
          entries.push(entryFor({
            aId: pair[0], bId: pair[1], winnerId: r.winnerId,
            scoreA: r.scoreA, scoreB: r.scoreB, results: r.results
          }, tag, pair[2]));
        }
      }
      return { winners: winners, entries: entries };
    }

    function runDoubleStage() {
      if (!d) {
        d = { w: current.slice(), l: [], queue: [] };
        var w = d.w, l = [];
        while (w.length > 1) {
          d.queue.push({ tag: '胜者组', kind: 'w' });
          l = l.concat(new Array(Math.floor(w.length / 2)));
          if (l.length >= 2) d.queue.push({ tag: '败者组', kind: 'l' });
          w = new Array(Math.ceil(w.length / 2));
        }
        while (l.length > 1) {
          d.queue.push({ tag: '败者组', kind: 'l' });
          l = new Array(Math.ceil(l.length / 2));
        }
        d.queue.push({ tag: '总决赛', kind: 'final1' });
      }
      while (d.queue.length) {
        var s = d.queue.shift();
        if (s.kind === 'w') {
          var pairs = [];
          for (var i = 0; i + 1 < d.w.length; i += 2) pairs.push([d.w[i], d.w[i + 1], 7]);
          var res = pairEntries(pairs, '胜者组');
          var losers = [];
          for (var j = 0; j < pairs.length; j++) {
            losers.push(res.winners[j] === pairs[j][0] ? pairs[j][1] : pairs[j][0]);
          }
          d.w = res.winners.concat(d.w.length % 2 ? [d.w[d.w.length - 1]] : []);
          d.l = d.l.concat(losers);
          return { title: '胜者组', entries: res.entries };
        }
        if (s.kind === 'l') {
          var pairsL = [];
          for (var k = 0; k + 1 < d.l.length; k += 2) pairsL.push([d.l[k], d.l[k + 1], 7]);
          var resL = pairEntries(pairsL, '败者组');
          d.l = resL.winners.concat(d.l.length % 2 ? [d.l[d.l.length - 1]] : []);
          return { title: '败者组', entries: resL.entries };
        }
        if (s.kind === 'final1') {
          if (!d.l.length) { champion = d.w[0]; return null; }
          var r1 = runMatch(d.w[0], d.l[0], finalBo, false);
          champion = r1.winnerId;
          var en1 = (track != null && (track === d.w[0] || track === d.l[0]))
            ? [entryFor({ aId: d.w[0], bId: d.l[0], winnerId: r1.winnerId, scoreA: r1.scoreA, scoreB: r1.scoreB, results: r1.results }, '总决赛', finalBo)] : [];
          return { title: '总决赛', entries: en1 };
        }
      }
      return null;
    }

    return {
      setRoster: function (fid, records) {
        rosters[fid] = records;
        strengths[fid] = teamStrength(records, opts.chem);
      },
      next: function () {
        if (done) return { kind: 'done', title: '赛季收官', champion: champion };
        // 常规赛队列（跑到主队场次为止）
        while (regularQueue.length) {
          var q = regularQueue.shift();
          currentRoundTag = q.rnd.name;
          var r = runMatch(q.m.a_id, q.m.b_id, q.rnd.bo || 5, true);
          if (track != null && (track === q.m.a_id || track === q.m.b_id)) {
            return { kind: 'regular_round', title: q.rnd.name, entries: [entryFor({
              aId: q.m.a_id, bId: q.m.b_id, winnerId: r.winnerId,
              scoreA: r.scoreA, scoreB: r.scoreB, results: r.results
            }, q.rnd.name, q.rnd.bo || 5)] };
          }
        }
        while (playInQueue.length) {
          var qp = playInQueue.shift();
          currentRoundTag = qp.rnd.name;
          var rp = runMatch(qp.m.a_id, qp.m.b_id, qp.rnd.bo || 7, true);
          if (track != null && (track === qp.m.a_id || track === qp.m.b_id)) {
            return { kind: 'play_in', title: qp.rnd.name, entries: [entryFor({
              aId: qp.m.a_id, bId: qp.m.b_id, winnerId: rp.winnerId,
              scoreA: rp.scoreA, scoreB: rp.scoreB, results: rp.results
            }, qp.rnd.name, qp.rnd.bo || 7)] };
          }
        }
        if (wildcardNote) {
          var wl = wildcardNote;
          wildcardNote = null;
          return { kind: 'regular_recap', title: '外卡登场', lines: wl };
        }
        if (!recapDone && Object.keys(regularGames).length) {
          recapDone = true;
          computeRegular();
          return { kind: 'regular_recap', title: '常规赛收官', lines: recapLines() };
        }
        // 单败轮
        while (singleIdx < singleRounds.length) {
          var rnd = singleRounds[singleIdx++];
          var bo = rnd.bo || 5;
          var pairs = [];
          for (var i = 0; i + 1 < current.length; i += 2) pairs.push([current[i], current[i + 1], bo]);
          var res = pairEntries(pairs, rnd.name);
          current = res.winners.concat(current.length % 2 ? [current[current.length - 1]] : []);
          if (current.length === 1) champion = current[0];
          if (res.entries.length) return { kind: 'elim_round', title: rnd.name, entries: res.entries };
          if (current.length <= 1) break;
        }
        // 双败
        if (multiRounds.length && current.length > 1) {
          var st = runDoubleStage();
          if (st) return { kind: 'elim_round', title: st.title, entries: st.entries };
        }
        if (!champion && current.length === 1) champion = current[0];
        done = true;
        return { kind: 'done', title: '赛季收官', champion: champion };
      },
      getRegular: function () {
        return { standings: regularInfo, track: track != null ? (regularInfo[track] || null) : null, seed_notes: seedNotes[track] || [] };
      },
      isDone: function () {
        if (done) return true;
        if (wildcardNote) return false;
        if (regularQueue.length || playInQueue.length) return false;
        if (!recapDone && Object.keys(regularGames).length) return false;
        if (singleIdx < singleRounds.length) return false;
        if (multiRounds.length && current.length > 1) {
          if (champion) return true;
          if (!d) return false;
          if (d.queue.length) return false;
        }
        return true;
      },
      getChampion: function () {
        return champion;
      },
      getTree: function () { return tree; }
    };
  }

  global.KPL_ENGINE = {
    POSITIONS: POSITIONS, K: K, STRENGTH_NOISE: STRENGTH_NOISE, COMPRESS: COMPRESS,
    makeRng: makeRng, pickStarter: pickStarter, teamStrength: teamStrength,
    buildChem: buildChem, lineupStrength: lineupStrength,
    seriesWinProb: seriesWinProb, playSeries: playSeries, playMatch: playMatch,
    dynamicSingleElim: dynamicSingleElim, dynamicDoubleElim: dynamicDoubleElim,
    gameNarration: gameNarration, narrateSeries: narrateSeries, simMatchStats: simMatchStats,
    franchiseNames: franchiseNames, simulateSeason: simulateSeason, createSession: createSession
  };
})(typeof window !== 'undefined' ? window : globalThis);
