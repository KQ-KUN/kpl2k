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
  var STRENGTH_NOISE = 4.0;
  var COMPRESS = 1.0;
  var SYNERGY_CAP = 4.0;
  var SYNERGY_SCALE = 0.8;
  var PAIR_WIN_MIN = 10;
  var PAIR_WIN_WEIGHT = 6.0;
  var STYLE_PENALTY = 1.5;

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

  function gameNarration(rng, tpl, teamA, teamB, winner, scoreA, scoreB, gameNo, namesA, namesB, comeback, isLast, isPeak, year) {
    var poolA = (namesA && namesA.length) ? namesA.slice() : ['选手'];
    var poolB = (namesB && namesB.length) ? namesB.slice() : ['选手'];
    var winPool = winner === teamA ? poolA : poolB;
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
      var list = listFor(rng.choice(roles));
      return list.length ? rng.choice(list) : '不知火舞';
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
    var devPool = listFor('发育路');
    var heroB = rng.choice(devPool.length ? devPool : ['戈娅']);
    var loser = winner === teamA ? teamB : teamA;
    var opening = rng.choice(tpl.openings)
      .replace(/\{team_a\}/g, teamA).replace(/\{team_b\}/g, teamB)
      .replace(/\{system\}/g, systemA).replace(/\{hero_b\}/g, heroB)
      .replace(/\{player_a\}/g, pa).replace(/\{player_b\}/g, pb);
    var events = rng.sample(tpl.events, 2);
    function fmtEvent(tmpl, minute, player) {
      return tmpl
        .replace(/\{team\}/g, winner).replace(/\{player\}/g, player)
        .replace(/\{opp\}/g, loser).replace(/\{minute\}/g, minute)
        .replace(/\{objective\}/g, rng.choice(OBJECTIVES));
    }
    var mid1 = fmtEvent(events[0], rng.randint(7, 12), p1);
    var mid2 = fmtEvent(events[1], rng.randint(13, 19), p2);
    var ending;
    if (comeback) {
      // 拖进巅峰对决/让二追三等措辞取决于是否已是系列赛最后一场
      var cbPool = tpl.comebacks.filter(function (c) {
        if (isLast) return c.indexOf('巅峰对决') < 0;      // 最后一场不能再"拖入"
        return c.indexOf('让二追三') < 0 && c.indexOf('让三追三') < 0;  // 未结束不能提前宣布翻盘完成
      });
      ending = rng.choice(cbPool.length ? cbPool : tpl.comebacks).replace(/\{team_a\}/g, winner);
    } else {
      var endPool = tpl.endings.filter(function (e) {
        return isLast ? (e.indexOf('目前比分') < 0 && e.indexOf('比分来到') < 0) : (e.indexOf('终结比赛') < 0);
      });
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
    var line = '第' + gameNo + '局\nBP：' + bp + '\n开局：' + opening + '\n中期：' + mid1 + '；' + mid2 + '\n结束：' + ending;
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
    var curA = 0, curB = 0;
    var everBehind = false;
    for (var idx = 0; idx < results.length; idx++) {
      var g = results[idx];
      var winTeam, winRoster, loseTeam;
      if (g === 'A') {
        curA += 1; winTeam = na; winRoster = rosterA; loseTeam = nb;
      } else {
        curB += 1; winTeam = nb; winRoster = rosterB; loseTeam = na;
      }
      if ((winTeam === na && curA < curB) || (winTeam === nb && curB < curA)) everBehind = true;
      var winScore = winTeam === na ? curA : curB;
      var loseScore = winTeam === na ? curB : curA;
      var isPeak = bo && results.length >= bo && idx === results.length - 1;
      lines.push(gameNarration(rng, tpl, na, nb, winTeam, winScore, loseScore, idx + 1, namesA, namesB, everBehind,
        idx === results.length - 1, isPeak, year));
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
      var wk = rng.randint(9, 22);
      var lk = rng.randint(3, 12);
      var wK = dist(winnerR, wk, K_W), wA = dist(winnerR, Math.round(wk * 1.1), A_W);
      var lK = dist(loserR, lk, K_W), lA = dist(loserR, Math.round(lk * 0.9), A_W);
      var wD = dist(winnerR, rng.randint(1, 4), D_W);
      var lD = dist(loserR, rng.randint(8, 16), D_W);
      winnerR.concat(loserR).forEach(function (r) {
        var s = ensure(r.player_id);
        s.games++;
        s.k += (wK[r.player_id] || 0) + (lK[r.player_id] || 0);
        s.a += (wA[r.player_id] || 0) + (lA[r.player_id] || 0);
        s.d += (wD[r.player_id] || 0) + (lD[r.player_id] || 0);
      });
      var best = null, bestScore = -1;
      winnerR.forEach(function (r) {
        var sc = (wK[r.player_id] || 0) + (wA[r.player_id] || 0) * 0.6 - (wD[r.player_id] || 0) * 0.7 + rng.random() * 3.0;
        if (sc > bestScore) { bestScore = sc; best = r.player_id; }
      });
      if (best) ensure(best).mvp++;
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

  function simulateSeason(opts) {
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

  /* ---------------- 分阶段模拟（轮间可换人） ---------------- */
  function createSession(opts) {
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
    if (multiRounds.length) {
      finalBo = multiRounds[0].bo || 7;
      var finalR = multiRounds.filter(function (r) { return r.type === 'final'; });
      if (finalR.length && finalR[0].bo) finalBo = finalR[0].bo;
    }

    function runMatch(aId, bId, bo, record) {
      var r = playMatch(rng, strengths, aId, bId, bo);
      var winnerId = r[0], scoreA = r[1], scoreB = r[2], results = r[3];
      var loserId = winnerId === aId ? bId : aId;
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
      }
    };
  }

  global.KPL_ENGINE = {
    POSITIONS: POSITIONS, K: K, STRENGTH_NOISE: STRENGTH_NOISE, COMPRESS: COMPRESS,
    makeRng: makeRng, pickStarter: pickStarter, teamStrength: teamStrength,
    buildChem: buildChem, lineupStrength: lineupStrength,
    seriesWinProb: seriesWinProb, playSeries: playSeries, playMatch: playMatch,
    dynamicSingleElim: dynamicSingleElim, dynamicDoubleElim: dynamicDoubleElim,
    gameNarration: gameNarration, narrateSeries: narrateSeries,
    franchiseNames: franchiseNames, simulateSeason: simulateSeason, createSession: createSession
  };
})(typeof window !== 'undefined' ? window : globalThis);
