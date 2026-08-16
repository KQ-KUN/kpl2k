/* KPL 2K 浏览器端叙事生成 v1（与 tools/narrative.py 对齐）
 *
 * 输入一次模拟的"球队旅程"，输出结构化故事事件列表：
 * intro（开赛）→ regular（常规赛收官，若有）→ round×N → final → summary → epilogue
 */
(function (global) {
  'use strict';

  function pick(rng, lst) {
    if (!lst || !lst.length) return '';
    return rng.choice(lst);
  }

  function teamNickname(rng, teamFlavor, teamName) {
    var keys = Object.keys(teamFlavor || {});
    for (var i = 0; i < keys.length; i++) {
      var nicks = teamFlavor[keys[i]] || [];
      if (teamName.indexOf(keys[i]) >= 0 && nicks.length) return pick(rng, nicks);
    }
    return null;
  }

  function maxDeficit(results, winnerIsA) {
    var a = 0, b = 0, worst = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i] === 'A') a += 1; else b += 1;
      var diff = winnerIsA ? (a - b) : (b - a);
      if (diff < worst) worst = diff;
    }
    return -worst;
  }

  function roundTag(rng, tpl, score, results, win) {
    var parts = String(score).split(':');
    var sa = parseInt(parts[0], 10), sb = parseInt(parts[1], 10);
    var deficit = maxDeficit(results, true);
    var key;
    if (!win) {
      if (sa === 0) key = 'sweep';
      else if (Math.abs(sa - sb) === 1) key = 'close';
      else key = 'tight';
    } else if (deficit >= 2) {
      key = 'comeback';
    } else if (sa === 0 || sb === 0) {
      key = 'sweep';
    } else if (sa + sb >= 6 && Math.max(sa, sb) - Math.min(sa, sb) === 1) {
      key = 'close';
    } else if (Math.max(sa, sb) - Math.min(sa, sb) >= 2) {
      key = 'dominant';
    } else {
      key = 'tight';
    }
    var pool = (tpl.round_tags || {})[key] || ['激烈的一轮'];
    return pick(rng, pool);
  }

  function sceneLine(rng, tpl, scene, text) {
    var leads = ((tpl.scene_leads || {})[scene]) || [''];
    var lead = leads.length ? pick(rng, leads) : '';
    return lead ? lead + text : text;
  }

  function findRivalry(rivalries, playersA, playersB) {
    var setA = {}, setB = {};
    (playersA || []).forEach(function (n) { setA[n] = true; });
    (playersB || []).forEach(function (n) { setB[n] = true; });
    for (var i = 0; i < (rivalries || []).length; i++) {
      var r = rivalries[i];
      var p = r.players || [];
      if ((setA[p[0]] && setB[p[1]]) || (setB[p[0]] && setA[p[1]])) return r;
    }
    return null;
  }

  /* ctx: { season_name, year, team, roster, champion, path, regular } */
  function buildStory(rng, tpl, flavor, ctx) {
    var events = [];
    var season = ctx.season_name, team = ctx.team, roster = ctx.roster || [];
    var rivalries = ctx.rivalries || [];
    var teamFlavor = ctx.team_flavor || {};
    var usedFlavor = {}, usedPlayers = {};
    var lastPlayer = null;

    function flavorTake(scene) {
      var fallback = null;
      for (var i = 0; i < roster.length; i++) {
        var name = roster[i];
        if (usedPlayers[name]) continue;
        var entry = (flavor || {})[name];
        if (!entry) continue;
        var candidates = [];
        if (typeof entry === 'object' && !Array.isArray(entry)) {
          candidates = (entry[scene] || []).slice();
          if (scene !== '低谷') candidates = candidates.concat(entry['名场面'] || []);
        } else {
          candidates = entry.slice();
        }
        for (var j = 0; j < candidates.length; j++) {
          var line = candidates[j];
          if (usedFlavor[line]) continue;
          var picked = [line, name];
          if (name !== lastPlayer) {
            usedFlavor[line] = true;
            usedPlayers[name] = true;
            lastPlayer = name;
            return picked;
          }
          if (!fallback) fallback = picked;
        }
      }
      if (fallback) {
        usedFlavor[fallback[0]] = true;
        usedPlayers[fallback[1]] = true;
        lastPlayer = fallback[1];
      }
      return fallback;
    }

    function fmt(tmpl, map) {
      return tmpl.replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : ''; });
    }

    var opener = fmt(pick(rng, tpl.season_openers), {
      year: ctx.year || '', season: season, team: team, roster: roster.join('、')
    });
    var introLines = [opener];
    usedPlayers = {};
    var fl0 = flavorTake('开场');
    if (fl0) introLines.push('名单公布当晚，' + fl0[1] + '的应援词刷了屏：「' + fl0[0] + '」');
    var nick = teamNickname(rng, teamFlavor, team);
    if (nick) introLines.push('评论区刷屏：' + team + '？那不是「' + nick + '」吗');
    events.push({ type: 'intro', title: season + ' · 开赛', lines: introLines });

    var regular = ctx.regular || {};
    if (regular.track) {
      var recapTpls = tpl.regular_recap || ['常规赛收官，{team}以第{rank}名进入季后赛。'];
      var recap = fmt(pick(rng, recapTpls), {
        team: team, rank: regular.track.rank, wins: regular.track.wins, losses: regular.track.losses
      });
      var regLines = [recap].concat(regular.seed_notes || []);
      events.push({ type: 'regular', title: '常规赛收官', lines: regLines });
    }

    var lastLines = [];
    for (var i = 0; i < (ctx.path || []).length; i++) {
      usedPlayers = {};
      var p = ctx.path[i];
      var isFinal = String(p.round).indexOf('决赛') >= 0;
      var deficit = maxDeficit(p.results || [], true);
      var lines;
      if (!isFinal) {
        lines = [roundTag(rng, tpl, p.score, p.results || [], p.win)];
        lines = lines.concat(p.games || []);
        var riv = findRivalry(rivalries, roster, p.opp_players || []);
        if (riv && rng.random() < 0.55) {
          lines.push(sceneLine(rng, tpl, '恩怨局', pick(rng, riv.lines || [])));
        }
        var fl = null, fname = null, flScene = null;
        if (i === 0) { fl = flavorTake('名场面'); flScene = '名场面'; }
        else if (deficit >= 2) { fl = flavorTake('翻盘'); flScene = '翻盘'; }
        else if (i === ctx.path.length - 1) { fl = flavorTake('名场面'); flScene = '名场面'; }
        if (fl) {
          lines.push(sceneLine(rng, tpl, flScene || '名场面', fl[0].replace(/xx/g, p.opp)));
        }
        if ((p.results || []).indexOf('B') >= 0) {
          var fl2 = flavorTake('低谷');
          if (fl2) lines.push(sceneLine(rng, tpl, '低谷', fl2[0]));
        }
        var sumKey = p.win ? 'win' : 'loss';
        var sumPool = (tpl.round_summaries || {})[sumKey] || ['这一轮结束。'];
        lines.push(fmt(pick(rng, sumPool), { team: team, opp: p.opp, score: p.score }));
      } else {
        lines = [pick(rng, tpl.final_lines)];
        lines = lines.concat(p.games || []);
        var flF = flavorTake('决赛');
        if (flF) lines.push(sceneLine(rng, tpl, '决赛', flF[0]));
        lastLines = lines;
        continue;
      }
      if (isFinal) continue;
      events.push({
        type: 'round', title: '第 ' + (i + 1) + ' 轮 · ' + p.round,
        meta: { opp: p.opp, score: p.score, win: p.win },
        lines: lines
      });
    }

    var hasFinalPath = ctx.path.length > 0 && String(ctx.path[ctx.path.length - 1].round).indexOf('决赛') >= 0;
    var finalLines;
    if (hasFinalPath) {
      finalLines = lastLines.slice();
      if (ctx.champion === ctx.team) {
        var flC = flavorTake('夺冠');
        var story = flC ? ('这一次，' + flC[1] + '没有让机会溜走。') : '这一次，他们没有让机会溜走。';
        finalLines.push(fmt(pick(rng, tpl.champion_lines), { team: team, story: story }));
        if (flC) finalLines.push(sceneLine(rng, tpl, '夺冠', flC[0]));
      } else {
        finalLines.push(fmt(pick(rng, tpl.runnerup_lines), { team: team }));
        var flR = flavorTake('遗憾');
        if (flR) finalLines.push(sceneLine(rng, tpl, '遗憾', flR[0]));
      }
      events.push({ type: 'final', title: '总决赛', lines: finalLines });
    } else if (ctx.champion === ctx.team) {
      finalLines = [fmt(pick(rng, tpl.default_champion || ['决赛的另一半倒在了半路，{team}不战而冠。']), { team: team, season: season })];
      var flD = flavorTake('夺冠');
      if (flD) finalLines.push(sceneLine(rng, tpl, '夺冠', flD[0]));
      events.push({ type: 'final', title: '加冕', lines: finalLines });
    } else {
      finalLines = [fmt(pick(rng, tpl.eliminations || ['{team}的{season}之旅，止步于此。']), { season: season, team: team })];
      var flE = flavorTake('遗憾');
      if (flE) finalLines.push(sceneLine(rng, tpl, '遗憾', flE[0]));
      events.push({ type: 'final', title: '赛季收官', lines: finalLines });
    }

    var wins = ctx.path.filter(function (p) { return p.win; }).length;
    var losses = ctx.path.length - wins;
    var summaryLines = ['【赛季战绩】' + wins + ' 胜 ' + losses + ' 负'];
    ctx.path.forEach(function (p) {
      summaryLines.push('  ' + p.round + ' vs ' + p.opp + '：' + p.score + ' ' + (p.win ? '胜' : '负'));
    });
    var parts = tpl.season_summary_parts || {};
    if (ctx.champion === team) {
      summaryLines.push(fmt(pick(rng, parts.champion || ['最终，{team}捧起冠军奖杯。']), { team: team, season: season }));
    } else if (hasFinalPath) {
      summaryLines.push(fmt(pick(rng, parts.runnerup || ['最终，{team}屈居亚军。']), { team: team, season: season }));
    } else {
      var stage = ctx.path.length ? ctx.path[ctx.path.length - 1].round : season;
      summaryLines.push(fmt(pick(rng, parts.eliminated || ['最终，{team}止步于此。']), { team: team, season: season, stage: stage }));
    }
    events.push({ type: 'summary', title: '赛季总结', lines: summaryLines });

    var epilogue = fmt(pick(rng, tpl.epilogues), { season: season, team: team });
    events.push({ type: 'epilogue', title: '赛季终章', lines: [epilogue] });
    return events;
  }

  global.KPL_NARRATIVE = { buildStory: buildStory, maxDeficit: maxDeficit };
})(typeof window !== 'undefined' ? window : globalThis);
