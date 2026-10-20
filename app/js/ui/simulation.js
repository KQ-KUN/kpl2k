/* simulation: injected coordination callbacks; no module imports or listener installation at load. */
(function(global){'use strict';
(global.KPL_UI_MODULES=global.KPL_UI_MODULES||{}).simulation=function(ctx){


  function showSim() {
    ctx.showPage('sim');
    BGM.play('battle');
    ctx.$('sim-track-btn').textContent = '🎵 ' + (BGM.getTrackName() || '');
    ctx.$('sim-progress-fill').style.width = '0%';
    ctx.$('sim-events').innerHTML = '';
    ctx.$('sim-skip').style.display = '';
    ctx.$('sim-sub').style.display = 'none';
    ctx.$('sim-goon').style.display = 'none';
    ctx.$('sim-next').style.display = 'none';
    ctx.$('sim-done-tip').style.display = 'none';
    ctx.SIM.queue = [];
    if (ctx.SIM.timer) { clearTimeout(ctx.SIM.timer); ctx.SIM.timer = null; }
    ctx.SIM.paused = false;
    ctx.SIM.speed = 1;
    updateRevealControls();
    ctx.SIM.tree = [];
    ctx.SIM.rosterChanged = false;
    if (ctx.STATE.mode === 'allstar') startAllStarSimulation();
    else startSimulation();
  }

  function startSimulation() {
    if (!ctx.STATE.season || !ctx.STATE.team || !ctx.STATE.roster.length) {
      ctx.go('#/season');
      return;
    }
    ctx.$('sim-events').innerHTML = '<div class="story-event show" id="sim-loading"><div class="se-title">📡 正在生成平行时空</div>' +
      '<div class="se-line mut">赛程与选手数据已就绪，马上开赛…</div></div>';
    var battleSid = ctx.STATE.season;
    var rosterSids = ctx.STATE.roster.map(function (s) { return s.sid; }).filter(Boolean);
    var sids = [battleSid].concat(rosterSids).filter(function (v, i, a) { return a.indexOf(v) === i; });
    ctx.D.loadSeasons(sids).then(function () {
      var battle = ctx.DATA.seasonCache[battleSid];
      var rosters = {};
      battle.rosters.forEach(function (r) {
        if ((r.games || 0) < 5) return;
        (rosters[r.team_franchise] = rosters[r.team_franchise] || []).push(r);
      });
      Object.keys(rosters).forEach(function (fid) {
        rosters[fid].sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
      });
      var override = {};
      var recs = ctx.recordsForRoster(ctx.STATE.roster);
      if (recs.length) override[ctx.STATE.team] = recs;
      if (!ctx.STATE.seed) ctx.STATE.seed = Math.floor(Math.random() * 100000);
      var formats = {};
      formats[battleSid] = battle;
      ctx.SIM.session = ctx.E.createSession({
        season_id: battleSid, formats: formats, rosters: rosters, rng: ctx.E.makeRng(ctx.STATE.seed),
        names: ctx.DATA.names, tpl: ctx.DATA.tpl, chem: ctx.D.buildChemFor(sids),
        override_rosters: override, track: ctx.STATE.team, players: ctx.DATA.players, tactic: ctx.STATE.tactic,
        player_boost: ctx.STATE.mode === 'budget' ? ctx.BUDGET_PLAYER_BOOST : undefined,
        budget_duos: ctx.STATE.mode === 'budget' ? ctx.DATA.budgetPairs : undefined,
        budget_mode: ctx.STATE.mode === 'budget'
      });
      if (window.KPLAnalytics) window.KPLAnalytics.trackEvent('kpl2k-start');
      ctx.SIM.stageNo = 0;
      ctx.SIM.path = [];
      ctx.SIM.seasonName = battle.name;
      var loading = ctx.$('sim-loading');
      if (loading) loading.remove();
      if (ctx.shareVersionNotice) {
        appendCard({ title: '版本提示', lines: [ctx.shareVersionNotice], cls: 'reg' });
        ctx.shareVersionNotice = '';
      }
      var dynasty = ctx.activeDynasty();
      if (dynasty && dynasty.story && dynasty.story.opening) {
        appendCard({ title: '📜 专属篇章 · ' + dynasty.theme, lines: dynasty.story.opening, cls: 'reg' });
      }
      renderOpeningTree();
      advance();
    }).catch(function (e) {
      ctx.$('sim-events').innerHTML = '<div class="card red">模拟失败：' + ctx.esc(e.message) + '</div>';
    });
  }

  function startAllStarSimulation() {
    var aSlots = ctx.STATE.allStar.aRoster || [], bSlots = ctx.STATE.allStar.bRoster || [];
    if (aSlots.length !== 5 || bSlots.length !== 5) { ctx.go('#/allstar'); return; }
    ctx.$('sim-events').innerHTML = '<div class="story-event show" id="sim-loading"><div class="se-title">📡 正在生成全明星对决</div>' +
      '<div class="se-line mut">双方阵容与历史版本已就绪，马上开赛…</div></div>';
    var slots = aSlots.concat(bSlots), sids = slots.map(function (s) { return s.sid; });
    ctx.D.loadSeasons(sids).then(function () {
      if (!ctx.STATE.seed) ctx.STATE.seed = Math.floor(Math.random() * 100000);
      var rng = ctx.E.makeRng(ctx.STATE.seed);
      var aSource = ctx.allStarRecords('a', true), bSource = ctx.allStarRecords('b', true);
      var chem = ctx.D.buildChemFor(sids);
      var aStrength = ctx.E.lineupStrength(aSource, chem, ctx.E.COMPRESS);
      var bStrength = ctx.E.lineupStrength(bSource, chem, ctx.E.COMPRESS);
      var strengths = { ALLSTAR_A: aStrength[0], ALLSTAR_B: bStrength[0] };
      var aRecords = ctx.allStarRecords('a', false), bRecords = ctx.allStarRecords('b', false);
      var result = ctx.E.playMatch(rng, strengths, 'ALLSTAR_A', 'ALLSTAR_B', ctx.STATE.allStar.bo, ctx.STATE.tactic);
      var aName = ctx.teamName(ctx.STATE.allStar.aTeam) + '联队';
      var bName = ctx.teamName(ctx.STATE.allStar.bTeam) + '联队';
      var pnames = {};
      slots.forEach(function (slot) { pnames[slot.pid] = ctx.playerName(slot.pid); });
      var teamNames = { ALLSTAR_A: aName, ALLSTAR_B: bName };
      var games = ctx.E.narrateSeries(rng, ctx.DATA.tpl, aName, bName, result[3], aRecords, bRecords, pnames, ctx.STATE.allStar.bo, 2026, teamNames);
      var rawStats = ctx.E.simMatchStats(rng, aRecords, bRecords, result[3]);
      var runStats = allStarRunStats(rawStats, aRecords, bRecords, result[3]);
      var entry = {
        round: '全明星对决', opp: bName, score: result[1] + ':' + result[2], win: result[0] === 'ALLSTAR_A',
        games: games, results: result[3], stats: runStats
      };
      ctx.STATE.lastRun = {
        mode: 'allstar', champion: result[0], team: 'ALLSTAR_A', season: null, seed: ctx.STATE.seed,
        completedAt: Date.now(),
        version: ctx.buildVersion(), tactic: ctx.STATE.tactic,
        seasonName: 'BO' + ctx.STATE.allStar.bo + ' 全明星对决', score: result[1] + ':' + result[2],
        aName: aName, bName: bName, aTeam: ctx.STATE.allStar.aTeam, bTeam: ctx.STATE.allStar.bTeam,
        aRoster: aSlots.slice(), bRoster: bSlots.slice(), aRecords: aRecords, bRecords: bRecords,
        records: aRecords.concat(bRecords), runStats: runStats, path: [entry], tree: [], regular: {},
        strengthBreakdown: { a: aStrength[1], b: bStrength[1] }
      };
      if (window.KPLAnalytics) {
        window.KPLAnalytics.trackEvent('kpl2k-start');
        window.KPLAnalytics.trackEvent('kpl2k-complete');
      }
      ctx.saveState(); saveAllStarHistory();
      ctx.SIM.session = { isDone: function () { return true; }, getChampion: function () { return result[0]; } };
      ctx.SIM.path = [];
      ctx.SIM.seasonName = ctx.STATE.lastRun.seasonName;
      var loading = ctx.$('sim-loading'); if (loading) loading.remove();
      if (ctx.shareVersionNotice) {
        appendCard({ title: '版本提示', lines: [ctx.shareVersionNotice], cls: 'reg' });
        ctx.shareVersionNotice = '';
      }
      appendEntryCard(entry, '全明星对决');
      ctx.$('sim-progress-fill').style.width = '100%';
      pumpReveal();
    }).catch(function (e) {
      ctx.$('sim-events').innerHTML = '<div class="card red">模拟失败：' + ctx.esc(e.message) + '</div>';
    });
  }

  function allStarRunStats(raw, aRecords, bRecords, results) {
    var out = {};
    var gameCount = (results || []).length;
    var sideWins = {
      ALLSTAR_A: (results || []).filter(function (winner) { return winner === 'A'; }).length,
      ALLSTAR_B: (results || []).filter(function (winner) { return winner === 'B'; }).length
    };
    [['ALLSTAR_A', aRecords], ['ALLSTAR_B', bRecords]].forEach(function (side) {
      var teamKills = 0;
      side[1].forEach(function (r) { teamKills += (raw[r.player_id + '|' + side[0]] || {}).k || 0; });
      side[1].forEach(function (r) {
        var s = raw[r.player_id + '|' + side[0]] || { games: 0, k: 0, d: 0, a: 0, mvp: 0 };
        out[r.player_id] = {
          games: s.games, k: s.k, d: s.d, a: s.a, mvp: s.mvp,
          kda: s.d ? (s.k + s.a) / s.d : (s.k + s.a),
          avgK: s.games ? s.k / s.games : 0, avgD: s.games ? s.d / s.games : 0,
          avgA: s.games ? s.a / s.games : 0,
          participation: teamKills ? (s.k + s.a) / teamKills : 0,
          winRate: gameCount ? sideWins[side[0]] / gameCount : 0
        };
      });
    });
    return out;
  }

  function saveAllStarHistory() {
    ctx.recordAchievementRun(ctx.STATE.lastRun);
    var run = JSON.parse(JSON.stringify(ctx.STATE.lastRun));
    run.path = run.path.map(function (p) { return { round: p.round, opp: p.opp, score: p.score, win: p.win, placement: p.placement, results: p.results }; });
    var hist = ctx.loadHistory();
    hist.unshift({
      mode: 'allstar', teamName: ctx.STATE.lastRun.aName + ' vs ' + ctx.STATE.lastRun.bName,
      seasonName: ctx.STATE.lastRun.seasonName, savedAt: ctx.STATE.lastRun.completedAt,
      champ: true, banner: ctx.STATE.lastRun.score,
      rosterNames: ctx.STATE.lastRun.records.map(function (r) { return ctx.playerName(r.player_id); }),
      allStar: ctx.compactAllStarState(ctx.STATE.allStar), seed: ctx.STATE.seed, lastRun: run
    });
    ctx.saveHistory(hist);
  }

  function advance() {
    var stage = ctx.SIM.session.next();
    ctx.SIM.stageNo += 1;
    ctx.$('sim-progress-fill').style.width = Math.min(96, ctx.SIM.stageNo * 2) + '%';
    if (stage.kind === 'done') {
      ctx.finishSim(stage.champion);
      return;
    }
    if (stage.kind === 'regular_recap') {
      appendCard({ title: stage.title, lines: stage.lines, cls: 'reg' });
      // 说明卡（如"32强战罢"）也同步赛程图：内部消化的场次一次性补齐
      if (ctx.SIM.session && ctx.SIM.session.getTree) renderTreeCard(ctx.SIM.session.getTree(), stage.title);
      // 由"继续征战"触发的说明卡：滚动到新卡顶部（绝不回到页面最顶端）
      if (ctx.SIM.jump) {
        ctx.SIM.jump = false;
        scrollToLatestCard();
      }
      showStageButtons();
      return;  // 保留 SIM.jump，继续征战能跳到真正的赛程
    }
    if (!stage.entries.length) { advance(); return; }  // 主队无赛事的轮次自动跳过（保留 jump）
    stage.entries.forEach(function (entry) {
      appendEntryCard(entry, stage.title);
    });
    // 每场结束后更新赛程图（谁干掉了谁、主队走到哪）
    if (ctx.SIM.session && ctx.SIM.session.getTree) renderTreeCard(ctx.SIM.session.getTree(), stage.title);
    // reveal 期间隐藏轮间按钮，避免在文字播放中误点"继续征战"
    ctx.$('sim-goon').style.display = 'none';
    ctx.$('sim-sub').style.display = 'none';
    pumpReveal();
    if (ctx.SIM.jump) {
      ctx.SIM.jump = false;
      setTimeout(scrollToLatestCard, 30);
    }
  }

  /* 滚动到最新一张比赛/说明卡的顶部（继续征战后的目标位置） */
  function scrollToLatestCard() {
    var cards = ctx.$('sim-events').querySelectorAll('.story-event');
    if (cards.length) {
      var el = cards[cards.length - 1];
      var top = el.getBoundingClientRect().top + window.pageYOffset - 8;
      window.scrollTo({ top: top, behavior: ctx.scrollBehavior() });
    }
  }

  function seriesContext(stageTitle, entry) {
    var lines = ['经理指令：' + ctx.tacticName(ctx.STATE.tactic) + '。' +
      ({ stable: '先稳住阵型与资源交换，等待对手露出破绽。', balanced: '按标准节奏寻找机会，临场应变优先。', gamble: '主动提速争抢前期窗口，接受更高的赛果波动。' }[ctx.STATE.tactic] || '')];
    var title = String(stageTitle || '');
    if (title.indexOf('总决赛') >= 0 || title === '决赛') lines.push('所有悬念都收敛到这一场，下一座水晶决定奖杯归属。');
    else if (title.indexOf('败者组') >= 0) lines.push('败者组没有回头路，任何一次失误都可能让整个赛季停在这里。');
    else if (title.indexOf('半决赛') >= 0 || title.indexOf('淘汰') >= 0) lines.push('比赛进入淘汰区间，阵容上限之外，更考验谁先顶住压力。');
    var streak = 0;
    for (var i = ctx.SIM.path.length - 1; i >= 0 && ctx.SIM.path[i].win; i--) streak++;
    if (streak >= 2) lines.push('此前已经连胜' + streak + '轮，气势正在成为第六名队员。');
    if (ctx.SIM.rosterChanged) {
      lines.push('阵容刚刚完成调整，新五人组能否立刻形成默契，是这一轮最大的变量。');
      ctx.SIM.rosterChanged = false;
    }
    var storyBucket = (title.indexOf('总决赛') >= 0 || title === '决赛')
      ? 'final' : (entry && entry.win ? 'victory' : 'defeat');
    var dynastyLine = ctx.dynastyStoryLine(storyBucket, ctx.SIM.path.length + title.length);
    if (dynastyLine) lines.push(dynastyLine);
    return lines.join('<br>');
  }

  function appendEntryCard(entry, stageTitle) {
    var context = seriesContext(stageTitle, entry);
    ctx.SIM.path.push(entry);
    var el = document.createElement('div');
    el.className = 'story-event';
    el.innerHTML = '<div class="se-title">' + stageIcon(stageTitle) + ' ' + ctx.esc(stageTitle) + ' · vs ' + ctx.esc(entry.opp) +
      ' <span class="score-pill ' + (entry.win ? 'win' : 'lose') + '">' + ctx.esc(entry.score) + ' ' + (entry.win ? '胜' : '负') + '</span></div>' +
      '<div class="se-context">' + context + '</div>';
    ctx.$('sim-events').appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    entry.games.forEach(function (g, gi) {
      var fn = function () {
        var gd = document.createElement('div');
        gd.className = 'se-game';
        var activeSlots = ctx.STATE.mode === 'allstar'
          ? ctx.STATE.allStar.aRoster.concat(ctx.STATE.allStar.bRoster)
          : ctx.STATE.roster;
        gd.innerHTML = gameHtml(g, activeSlots.map(function (s) { return ctx.playerName(s.pid); }));
        el.appendChild(gd);
      };
      if (gi === 0) fn();
      else ctx.SIM.queue.push(fn);
    });
  }

  /* ---------- 赛程图：谁干掉了谁、主队走到哪 ---------- */
  function renderOpeningTree() {
    var battle = ctx.DATA.seasonCache[ctx.STATE.season];
    if (!battle) return;
    // 找第一个有官方对阵的轮次（小组赛/首轮/32强等）做开局图
    var firstRound = null;
    (battle.rounds || []).forEach(function (r) {
      if (!firstRound && r.matches && r.matches.length) firstRound = r;
    });
    var title = firstRound ? (firstRound.name || '首轮对阵') : '参赛队伍';
    var html = '<div class="card tree-card" id="sim-tree-card">' +
      '<div class="tc-head">🗺️ ' + ctx.esc(battle.name || ctx.STATE.season) + ' · ' + ctx.esc(title) + '</div>';
    if (firstRound) {
      html += '<div class="tc-round">揭幕对阵</div>';
      var shown = 0;
      (firstRound.matches || []).forEach(function (m) {
        if (!m.a_id || !m.b_id) return;
        var selfA = m.a_id === ctx.STATE.team, selfB = m.b_id === ctx.STATE.team;
        if (!selfA && !selfB && shown >= 16) return; // 非主队对阵最多展示 16 场
        shown++;
        var aCls = selfA ? ' tc-self' : '';
        var bCls = selfB ? ' tc-self' : '';
        html += '<div class="tc-match"><span class="tc-team' + aCls + '">' + ctx.esc(ctx.teamName(m.a_id)) + '</span>' +
          '<span class="tc-score">vs</span>' +
          '<span class="tc-team' + bCls + '">' + ctx.esc(ctx.teamName(m.b_id)) + '</span></div>';
      });
      if (firstRound.matches.length > shown) html += '<div class="tc-more">… 其余对阵开赛后揭晓</div>';
    } else {
      var seenTeams = {};
      (ctx.DATA.seasonCache[ctx.STATE.season].rosters || []).forEach(function (r) {
        if (r.team_franchise) seenTeams[r.team_franchise] = true;
      });
      var uniq = Object.keys(seenTeams);
      html += '<div class="tc-teams">' + uniq.map(function (fid) {
        return '<span class="tc-team-chip' + (fid === ctx.STATE.team ? ' sel' : '') + '">' + ctx.esc(ctx.teamName(fid)) + '</span>';
      }).join('') + '</div>';
    }
    html += '<div class="tc-tip">你的战队已就位，赛程图将随每一战更新</div></div>';
    var old = ctx.$('sim-tree-card');
    if (old) old.remove();
    var el = document.createElement('div');
    el.innerHTML = html;
    ctx.$('sim-events').appendChild(el.firstChild);
  }

  function renderTreeCard(tree, title) {
    var old = ctx.$('sim-tree-card');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'card tree-card';
    el.id = 'sim-tree-card';
    el.innerHTML = treeCardHtml(tree, title, false, true);
    ctx.$('sim-events').appendChild(el);
  }

  /* 树卡内容（模拟页/战绩卡共用；compact 为缩小版） */
  function treeCardHtml(tree, title, compact, showHead) {
    var groups = [];
    var seen = {};
    (tree || []).forEach(function (m) {
      var key = m.round || '对局';
      // 注意：第一个分组的索引是 0，不能用 !seen[key] 判断（0 为 falsy）
      if (seen[key] === undefined) { seen[key] = groups.length; groups.push({ round: key, matches: [] }); }
      groups[seen[key]].matches.push(m);
    });
    // 只保留淘汰赛轮次（常规赛/卡位赛不进树）
    var ko = groups.filter(function (g) { return ctx.BRACKET_EXPECT[g.round]; });
    var first = ko.length ? ko[0] : null;
    var chain = first ? ctx.MAIN_CHAINS[first.round] : null;
    var main, loser;
    if (chain) {
      main = chain.map(function (r) {
        return ko.find(function (g) { return g.round === r; }) || { round: r, matches: [] };
      });
      var lc = ctx.LOSER_CHAINS[first.round];
      loser = lc ? lc.map(function (r) {
        return ko.find(function (g) { return g.round === r; }) || { round: r, matches: [] };
      }) : ko.filter(function (g) { return /败者组/.test(g.round); });
    } else {
      main = ko.filter(function (g) { return !/败者组/.test(g.round); });
      loser = ko.filter(function (g) { return /败者组/.test(g.round); });
    }
    var html = showHead
      ? '<div class="tc-head">🗺️ 赛程图' + (title ? ' · ' + ctx.esc(title) : '') + '</div>'
      : '';
    if (!main.length) {
      // 常规赛/小组赛阶段没有淘汰树，改显示已打场次列表
      var regHtml = regularListHtml(tree);
      html += regHtml || '<div class="tc-tip">尚未开战，等待第一场对决…</div>';
    } else {
      html += bracketColumns(main, 'bk-main', compact);
      if (loser.length) html += bracketColumns(loser, 'bk-loser', compact);
      html += treeStatusLine(tree);
    }
    return html;
  }

  /* 常规赛/小组赛：逐轮列出已打对阵（谁赢谁一目了然） */
  function regularListHtml(tree) {
    var groups = [];
    var seen = {};
    (tree || []).forEach(function (m) {
      var key = m.round || '';
      if (!/常规赛|小组赛|卡位/.test(key)) return;
      if (seen[key] === undefined) { seen[key] = groups.length; groups.push({ round: key, matches: [] }); }
      groups[seen[key]].matches.push(m);
    });
    if (!groups.length) return '';
    var html = '';
    groups.forEach(function (g) {
      html += '<div class="tc-round">' + ctx.esc(g.round) + '</div>';
      html += '<div class="tc-grid">';
      g.matches.forEach(function (m) {
        var na = ctx.teamName(m.a), nb = ctx.teamName(m.b);
        var winnerIsA = m.w === m.a;
        var trackIn = m.a === ctx.STATE.team || m.b === ctx.STATE.team;
        var trackWon = m.w === ctx.STATE.team;
        var cls = trackIn ? (trackWon ? ' tc-track tc-win' : ' tc-track tc-loss') : '';
        var aCls = (m.a === ctx.STATE.team ? ' tc-self' : (winnerIsA ? ' tc-win' : ''));
        var bCls = (m.b === ctx.STATE.team ? ' tc-self' : (!winnerIsA ? ' tc-win' : ''));
        html += '<div class="tc-match' + cls + '"><span class="tc-team' + aCls + '">' +
          ctx.teamAvaHtml(m.a, ctx.abbrOf(m.a)) + '<span class="tc-tn">' + ctx.esc(na) + '</span></span>' +
           '<span class="tc-score">' + ctx.esc(m.sa) + ' : ' + ctx.esc(m.sb) + '</span>' +
          '<span class="tc-team' + bCls + '">' +
          ctx.teamAvaHtml(m.b, ctx.abbrOf(m.b)) + '<span class="tc-tn">' + ctx.esc(nb) + '</span></span></div>';
      });
      html += '</div>';
    });
    return html;
  }

  /* 各淘汰赛轮次的期望框数（用于补"待定"空位，凑出完整树） */


  /* 各赛制的主链/败者组链（按首轮名匹配，用于补全未打轮次的空框） */



  /* 画一列组的标准淘汰树（首列在最左，胜者向右衍生；连线 floor(i/2)） */
  function bracketColumns(cols, cls, compact) {
    var COL_W = compact ? 150 : 176;
    var GAP = compact ? 18 : 34;
    var BOX_H = compact ? 46 : 50;
    var ROW_H = compact ? 50 : 55;
    var firstN = cols.length ? Math.max(cols[0].matches.length, ctx.BRACKET_EXPECT[cols[0].round] || cols[0].matches.length) : 1;
    var H = Math.max(200, firstN * ROW_H);
    var totalW = cols.length * (COL_W + GAP) + 10;
    var lines = [];
    var boxes = '';
    cols.forEach(function (g, c) {
      var n = Math.max(g.matches.length, ctx.BRACKET_EXPECT[g.round] || g.matches.length);
      var x = c * (COL_W + GAP); // 首列在最左，胜者向右衍生
      boxes += '<div class="bk-round-label" style="left:' + x + 'px;top:-20px">' + ctx.esc(g.round) + '</div>';
      for (var i = 0; i < n; i++) {
        var m = g.matches[i];
        var y = (i + 0.5) * (H / n) - BOX_H / 2;
        var clsB = 'bk-match';
        var inner, isSelf = false, won = false, lost = false;
        if (m) {
          var na = ctx.teamName(m.a), nb = ctx.teamName(m.b);
          var ab = ctx.abbrOf(m.a), bb = ctx.abbrOf(m.b);
          var winnerIsA = m.w === m.a;
          var score = m.sa + ':' + m.sb;
          // 左侧两队（带对标，上下排列），右侧比分：胜者绿加粗、败者灰，主队所在框金色
          inner = '<div class="bk-teams">' +
            '<div class="bk-row' + (winnerIsA ? ' bk-win' : '') + '" title="' + ctx.esc(na) + '">' +
              ctx.teamAvaHtml(m.a, ab) + '<span class="bk-tname">' + ctx.esc(ab) + '</span></div>' +
            '<div class="bk-row' + (!winnerIsA ? ' bk-win' : '') + '" title="' + ctx.esc(nb) + '">' +
              ctx.teamAvaHtml(m.b, bb) + '<span class="bk-tname">' + ctx.esc(bb) + '</span></div>' +
            '</div><div class="bk-score">' + ctx.esc(score) + '</div>';
          isSelf = m.w === ctx.STATE.team;
          lost = !isSelf && (m.a === ctx.STATE.team || m.b === ctx.STATE.team);
          won = isSelf;
        } else {
          inner = '<div class="bk-teams"><div class="bk-row"><span class="bk-tname mut">待定</span></div></div>' +
            '<div class="bk-score"></div>';
        }
        if (won) clsB += ' bk-win bk-self';
        else if (lost) clsB += ' bk-loss';
        boxes += '<div class="' + clsB + '" style="left:' + x + 'px;top:' + y + 'px;width:' + COL_W + 'px;height:' + BOX_H + 'px">' + inner + '</div>';
        // 连线：本场胜者 → 下一列 floor(i/2)
        if (c + 1 < cols.length) {
          var nextN = Math.max(cols[c + 1].matches.length, ctx.BRACKET_EXPECT[cols[c + 1].round] || cols[c + 1].matches.length);
          var j = Math.min(Math.floor(i / 2), nextN - 1);
          var x1 = x + COL_W;
          var y1 = y + BOX_H / 2;
          var x2 = x + COL_W + GAP;
          var y2 = (j + 0.5) * (H / nextN);
          var midX = x + COL_W + GAP / 2;
          lines.push('<path d="M ' + x1 + ' ' + y1 + ' H ' + midX + ' V ' + y2 + ' H ' + x2 + '" fill="none" stroke="currentColor" stroke-width="1.7"/>');
        }
      }
    });
    return '<div class="bk-wrap' + (compact ? ' bk-sm' : '') + '"><div class="bk-inner ' + cls + '" style="width:' + totalW + 'px;height:' + H + 'px">' +
      '<svg class="bk-lines" width="' + totalW + '" height="' + H + '" style="position:absolute;left:0;top:0">' +
      lines.join('') + '</svg>' + boxes + '</div></div>';
  }

  function treeStatusLine(tree) {
    var lastTrack = null;
    for (var i = (tree || []).length - 1; i >= 0; i--) {
      var mm = tree[i];
      if (mm.a === ctx.STATE.team || mm.b === ctx.STATE.team) { lastTrack = mm; break; }
    }
    if (!lastTrack) return '';
    return lastTrack.w === ctx.STATE.team
      ? '<div class="tc-status ok">✅ ' + ctx.esc(ctx.teamName(ctx.STATE.team)) + ' 晋级下一轮</div>'
      : '<div class="tc-status bad">❌ ' + ctx.esc(ctx.teamName(ctx.STATE.team)) + ' 止步' + ctx.esc(lastTrack.round) + '</div>';
  }

  function appendCard(ev) {
    var cls = ev.cls === 'reg' ? ' reg' : (ev.cls === 'final' ? ' final' : '');
    var lines = (ev.lines || []).map(function (l) {
      return '<div class="se-line">' + ctx.esc(l).replace(/\n/g, '<br>') + '</div>';
    }).join('');
    var el = document.createElement('div');
    el.className = 'story-event' + cls;
    el.innerHTML = '<div class="se-title">' + ctx.esc(ev.title) + '</div>' + lines;
    ctx.$('sim-events').appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
  }

  function updateRevealControls() {
    var active = !!(ctx.SIM.queue.length || ctx.SIM.timer);
    ctx.$('sim-reveal-controls').style.display = active ? 'grid' : 'none';
    ctx.$('sim-pause').disabled = !active;
    ctx.$('sim-pause').textContent = ctx.SIM.paused ? '继续' : '暂停';
    ctx.$('sim-pause').setAttribute('aria-pressed', ctx.SIM.paused ? 'true' : 'false');
    ctx.$('sim-speed').textContent = ctx.SIM.speed + '× 速度';
    ctx.$('sim-skip-series').disabled = !active;
  }

  function finishReveal() {
    ctx.SIM.paused = false;
    updateRevealControls();
    if (ctx.SIM.session && ctx.SIM.session.isDone && ctx.SIM.session.isDone()) {
      // 整个赛季的最后一把打完：滚动到最后一场文字，显示"结束征战"，由玩家点击进入战绩卡
      var cards = ctx.$('sim-events').querySelectorAll('.story-event');
      if (cards.length) {
        var el = cards[cards.length - 1];
        var top = el.getBoundingClientRect().top + window.pageYOffset - 8;
        window.scrollTo({ top: top, behavior: ctx.scrollBehavior() });
      }
      ctx.$('sim-skip').style.display = 'none';
      ctx.$('sim-sub').style.display = 'none';
      ctx.$('sim-goon').style.display = 'none';
      ctx.$('sim-next').style.display = '';
      return;
    }
    showStageButtons();
  }

  function pumpReveal() {
    if (ctx.SIM.timer || ctx.SIM.paused) { updateRevealControls(); return; }
    if (!ctx.SIM.queue.length) { finishReveal(); return; }
    ctx.SIM.timer = setTimeout(function () {
      ctx.SIM.timer = null;
      if (ctx.SIM.paused) { updateRevealControls(); return; }
      var reveal = ctx.SIM.queue.shift();
      if (reveal) reveal();
      pumpReveal();
    }, 550 / ctx.SIM.speed);
    updateRevealControls();
  }

  function toggleRevealPause() {
    if (!ctx.SIM.queue.length && !ctx.SIM.timer) return;
    ctx.SIM.paused = !ctx.SIM.paused;
    if (ctx.SIM.paused && ctx.SIM.timer) { clearTimeout(ctx.SIM.timer); ctx.SIM.timer = null; }
    if (!ctx.SIM.paused) pumpReveal();
    updateRevealControls();
  }

  function toggleRevealSpeed() {
    ctx.SIM.speed = ctx.SIM.speed === 1 ? 2 : 1;
    if (ctx.SIM.timer) { clearTimeout(ctx.SIM.timer); ctx.SIM.timer = null; }
    if (!ctx.SIM.paused) pumpReveal();
    updateRevealControls();
  }

  function skipCurrentReveal() {
    if (ctx.SIM.timer) { clearTimeout(ctx.SIM.timer); ctx.SIM.timer = null; }
    ctx.SIM.paused = false;
    while (ctx.SIM.queue.length) ctx.SIM.queue.shift()();
    finishReveal();
  }

  function scrollBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: ctx.scrollBehavior() });
  }

  /* 战报文本 -> 结构化块（BP/开局/中期/结束 + 名场面引用），选手名高亮 */
  function hlText(t, names) {
    var out = t;
    (names || []).forEach(function (n) {
      if (!n) return;
      var re = new RegExp('(\\.)' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      out = out.replace(re, '<b class="hl">$1' + n + '</b>');
    });
    return out;
  }

  function gameHtml(g, names) {
    var lines = ctx.esc(g).split('\n');
    var parts = [];
    lines.forEach(function (line) {
      var m = line.match(/^(第\d+局)(.*)$/);
      if (m) {
        parts.push('<div class="g-head">' + m[1] + (m[2] ? ' · ' + m[2] : '') + '</div>');
        return;
      }
      var tag = null;
      ['BP', '开局', '中期', '结束', '本局MVP'].forEach(function (t) {
        if (tag === null && line.indexOf(t + '：') === 0) tag = t;
      });
      if (tag) {
        var txt = line.slice(tag.length + 1);
        var segs = txt.split('；').filter(function (s) { return s.trim(); });
        var cls = tag === 'BP' ? 'bp' : (tag === '开局' ? 'open' : (tag === '中期' ? 'mid' : (tag === '结束' ? 'end' : 'mvp')));
        segs.forEach(function (s) {
          parts.push('<div class="g-row ' + cls + '"><span class="g-tag">' + tag + '</span>' +
            '<span class="g-txt">' + hlText(s.trim(), names) + '</span></div>');
        });
        return;
      }
      if (line.trim()) parts.push('<div class="g-quote">' + hlText(line.trim(), names) + '</div>');
    });
    return parts.join('');
  }

  function stageIcon(title) {
    var t = String(title || '');
    if (t.indexOf('决赛') >= 0 || t.indexOf('总决赛') >= 0) return '🏆';
    if (t.indexOf('胜者组') >= 0 || t.indexOf('败者组') >= 0) return '⚔️';
    if (t.indexOf('卡位') >= 0) return '🎯';
    return '📋';
  }

  function showStageButtons() {
    ctx.$('sim-skip').style.display = '';
    ctx.$('sim-sub').style.display = ctx.STATE.mode === 'budget' ? 'none' : '';
    ctx.$('sim-goon').style.display = '';
    updateRevealControls();
  }

  function skipAll() {
    if (ctx.SIM.timer) { clearTimeout(ctx.SIM.timer); ctx.SIM.timer = null; }
    ctx.SIM.paused = false;
    while (ctx.SIM.queue.length) ctx.SIM.queue.shift()();
    if (ctx.STATE.mode === 'allstar') { ctx.go('#/result'); return; }
    ctx.SIM.jump = false;
    var guard = 0;
    while (guard++ < 500) {
      var stage = ctx.SIM.session.next();
      ctx.SIM.stageNo += 1;
      if (stage.kind === 'done') {
        ctx.finishSim(stage.champion);
        ctx.go('#/result');
        return;
      }
      if (stage.kind === 'regular_recap') continue;
      (stage.entries || []).forEach(function (entry) { ctx.SIM.path.push(entry); });
    }
    ctx.go('#/result');
  }


return {showSim,startSimulation,startAllStarSimulation,allStarRunStats,saveAllStarHistory,advance,scrollToLatestCard,seriesContext,appendEntryCard,renderOpeningTree,renderTreeCard,treeCardHtml,regularListHtml,bracketColumns,treeStatusLine,appendCard,updateRevealControls,finishReveal,pumpReveal,toggleRevealPause,toggleRevealSpeed,skipCurrentReveal,scrollBottom,hlText,gameHtml,stageIcon,showStageButtons,skipAll};
};
})(window);
