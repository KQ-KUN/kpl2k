/* router: injected coordination callbacks; no module imports or listener installation at load. */
(function(global){'use strict';
(global.KPL_UI_MODULES=global.KPL_UI_MODULES||{}).router=function(ctx){
  function router() {
    var hash = location.hash || '#/';
    var m = hash.match(/^#\/s\?(.*)$/);
    if (m) { applyShare(m[1]); return; }
    var a = hash.match(/^#\/a\?(.*)$/);
    if (a) { applyAllStarShare(a[1]); return; }
    if (hash.indexOf('#/team') === 0) ctx.showTeam();
    else if (hash.indexOf('#/budget') === 0) ctx.showBudget();
    else if (hash.indexOf('#/allstar') === 0) ctx.showAllStar();
    else if (hash.indexOf('#/season') === 0) ctx.showSeason();
    else if (hash.indexOf('#/sim') === 0) ctx.showSim();
    else if (hash.indexOf('#/result') === 0) ctx.showResult();
    else if (hash.indexOf('#/history') === 0) ctx.showHistory();
    else if (hash.indexOf('#/achievements') === 0) ctx.showAchievements();
    else ctx.showHome();
  }

  function applyShare(qs) {
    var params = new URLSearchParams(qs);
    var t = params.get('t'), s = params.get('s'), r = params.get('r'), seed = params.get('seed');
    var sharedVersion = params.get('v');
    var versionMismatch = !sharedVersion || sharedVersion !== ctx.buildVersion();
    var roster = [];
    (r || '').split(',').forEach(function (pair) {
      var parts = pair.split('@');
      if (parts.length === 2) roster.push({ pid: parts[0], sid: parts[1] });
    });
    if (t && roster.length === 5) {
      ctx.STATE.mode = 'classic';
      ctx.STATE.team = t;
      ctx.STATE.roster = roster;
      ctx.STATE.season = s || null;
      ctx.STATE.dynasty = null;
      ctx.STATE.seed = parseInt(seed || '0', 10) || 0;
      ctx.STATE.tactic = ['stable', 'balanced', 'gamble'].indexOf(params.get('tc')) >= 0 ? params.get('tc') : 'balanced';
      ctx.saveState();
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(ctx.STATE_KEY) || 'null'); } catch (e) { /* ignore */ }
      var requestedRoster = roster.map(function (slot) { return slot.pid + '@' + slot.sid; }).join(',');
      var cachedRoster = cached && cached.lastRun && (cached.lastRun.records || []).map(function (record) {
        return record.player_id + '@' + record.season_id;
      }).join(',');
      var hit = cached && cached.lastRun &&
        !versionMismatch && cached.lastRun.version === ctx.buildVersion() &&
        cached.lastRun.team === t && cached.lastRun.seed === ctx.STATE.seed && cached.lastRun.season === ctx.STATE.season &&
        (cached.lastRun.tactic || 'balanced') === ctx.STATE.tactic && cachedRoster === requestedRoster;
      if (versionMismatch) ctx.shareVersionNotice = '该分享来自旧版本，已使用当前数据与规则重新模拟，赛果可能与原分享不同。';
      location.hash = hit ? '#/result' : '#/sim';
    } else {
      location.hash = '#/';
    }
  }

  function unpackAllStarSlots(value) {
    var out = [];
    (value || '').split(',').forEach(function (item) {
      var parts = item.split('@');
      if (parts.length < 2 || !parts[0] || !parts[1]) return;
      out.push({ pid: parts[0], sid: parts[1], teamFid: parts[2] || null });
    });
    return out;
  }

  function applyAllStarShare(qs) {
    var params = new URLSearchParams(qs);
    var aRoster = unpackAllStarSlots(params.get('ar'));
    var bRoster = unpackAllStarSlots(params.get('br'));
    var bo = parseInt(params.get('bo') || '5', 10);
    if (aRoster.length !== 5 || bRoster.length !== 5 || [3, 5, 7].indexOf(bo) < 0) {
      location.hash = '#/';
      return;
    }
    ctx.STATE.mode = 'allstar';
    ctx.STATE.allStar = Object.assign({}, ctx.STATE.allStar, {
      aTeam: params.get('at') || ctx.STATE.allStar.aTeam,
      bTeam: params.get('bt') || ctx.STATE.allStar.bTeam,
      aRoster: aRoster, bRoster: bRoster, bo: bo
    });
    ctx.STATE.seed = parseInt(params.get('seed') || '0', 10) || Math.floor(Math.random() * 100000);
    ctx.STATE.tactic = ['stable', 'balanced', 'gamble'].indexOf(params.get('tc')) >= 0 ? params.get('tc') : 'balanced';
    if (params.get('v') !== ctx.buildVersion()) {
      ctx.shareVersionNotice = '该全明星分享来自旧版本，已使用当前数据与规则重新模拟。';
    }
    ctx.saveState();
    location.hash = '#/sim';
  }

  /* ---------------- 视图切换 ---------------- */

  function shouldAnimatePage(nextPage) {
    if (!ctx.activePage) return true;
    return (ctx.activePage === 'home' && ['team', 'allstar', 'budget'].indexOf(nextPage) >= 0) ||
      (ctx.activePage === 'team' && nextPage === 'season') ||
      (ctx.activePage === 'sim' && nextPage === 'result');
  }
  function showPage(name) {
    var animateEntry = shouldAnimatePage(name);
    ['home', 'team', 'budget', 'allstar', 'season', 'sim', 'result', 'history', 'achievements'].forEach(function (p) {
      var page = ctx.$(p);
      page.classList.toggle('active', p === name);
      page.classList.toggle('page-enter', p === name && animateEntry);
    });
    ctx.activePage = name;
    ['team-bar', 'budget-bar', 'allstar-bar', 'season-bar', 'sim-bar', 'result-bar'].forEach(function (b) {
      var el = ctx.$(b);
      if (el) el.style.display = 'none';
    });
    if (name !== 'home') {
      var bar = ctx.$(name + '-bar');
      if (bar) bar.style.display = '';
    }
    window.scrollTo(0, 0);
  }


return {router,applyShare,unpackAllStarSlots,applyAllStarShare,shouldAnimatePage,showPage};
};
})(window);
