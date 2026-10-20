/* storage: injected coordination callbacks; no module imports or listener installation at load. */
(function(global){'use strict';
(global.KPL_UI_MODULES=global.KPL_UI_MODULES||{}).storage=function(ctx){
  function showStorageWarning(message) {
    var el = ctx.$('storage-warning');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    if (ctx.storageWarningTimer) clearTimeout(ctx.storageWarningTimer);
    ctx.storageWarningTimer = setTimeout(function () { el.classList.remove('show'); }, 5000);
  }

  function mergeCustomPlayers(base, extra) {
    var out = [], seen = {};
    (base || []).concat(extra || []).forEach(function (p) {
      if (!p || !p.id || seen[p.id]) return;
      seen[p.id] = true;
      out.push(p);
    });
    return out;
  }

  function compactAllStarState(allStar) {
    return {
      aTeam: allStar.aTeam, bTeam: allStar.bTeam,
      aRoster: (allStar.aRoster || []).slice(), bRoster: (allStar.bRoster || []).slice(),
      bo: allStar.bo || 5
    };
  }

  function normalizeAllStarState(value) {
    var source = value && typeof value === 'object' ? value : {};
    var bo = parseInt(source.bo, 10);
    return {
      aTeam: typeof source.aTeam === 'string' ? source.aTeam : null,
      bTeam: typeof source.bTeam === 'string' ? source.bTeam : null,
      aRoster: Array.isArray(source.aRoster) ? source.aRoster.slice(0, 5) : [],
      bRoster: Array.isArray(source.bRoster) ? source.bRoster.slice(0, 5) : [],
      bo: [3, 5, 7].indexOf(bo) >= 0 ? bo : 5,
      customs: Array.isArray(source.customs) ? source.customs.filter(function (player) {
        return player && typeof player.id === 'string' && typeof player.name === 'string';
      }) : []
    };
  }

  function saveState() {
    var payload = JSON.stringify({
      mode: ctx.STATE.mode, budgetTotal: ctx.STATE.budgetTotal, team: ctx.STATE.team, roster: ctx.STATE.roster, season: ctx.STATE.season, seed: ctx.STATE.seed, tactic: ctx.STATE.tactic,
      dynasty: ctx.STATE.dynasty,
      lastRun: ctx.STATE.lastRun, allStar: ctx.STATE.allStar
    });
    try {
      localStorage.setItem(ctx.STATE_KEY, payload);
      return true;
    } catch (e) {
      var storageHistory = loadHistory();
      while (storageHistory.length) {
        storageHistory.pop();
        try {
          localStorage.setItem(ctx.HISTORY_KEY, JSON.stringify(storageHistory));
          localStorage.setItem(ctx.STATE_KEY, payload);
          showStorageWarning('本地空间不足，已自动移除最早的部分历史战绩。');
          return true;
        } catch (retryError) { /* keep pruning oldest history */ }
      }
    }
    showStorageWarning('本地存储空间不足，本次设置可能无法保留。请清理浏览器存储后重试。');
    return false;
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(ctx.STATE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      ctx.STATE.mode = ['allstar', 'budget'].indexOf(s.mode) >= 0 ? s.mode : 'classic';
      ctx.STATE.budgetTotal = Number.isFinite(s.budgetTotal) ? s.budgetTotal : null;
      ctx.STATE.team = typeof s.team === 'string' ? s.team : null;
      ctx.STATE.roster = Array.isArray(s.roster) ? s.roster.slice(0, 5) : [];
      ctx.STATE.season = typeof s.season === 'string' ? s.season : null;
      ctx.STATE.seed = Number.isFinite(s.seed) ? Math.max(0, Math.floor(s.seed)) : 0;
      ctx.STATE.tactic = ['stable', 'balanced', 'gamble'].indexOf(s.tactic) >= 0 ? s.tactic : 'balanced';
      ctx.STATE.dynasty = typeof s.dynasty === 'string' ? s.dynasty : null;
      ctx.STATE.lastRun = s.lastRun && typeof s.lastRun === 'object' ? s.lastRun : null;
      ctx.STATE.allStar = normalizeAllStarState(s.allStar);
    } catch (e) { /* ignore */ }
  }


  function loadHistory() {
    try {
      var value = JSON.parse(localStorage.getItem(ctx.HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (e) { return []; }
  }
  function saveHistory(h) {
    var out = h.slice(0, 20).map(function (item) {
      if (!item || item.mode !== 'allstar' || !item.allStar) return item;
      var copy = Object.assign({}, item);
      copy.allStar = compactAllStarState(item.allStar);
      return copy;
    });
    while (out.length) {
      try {
        localStorage.setItem(ctx.HISTORY_KEY, JSON.stringify(out));
        if (out.length < Math.min(h.length, 20)) {
          showStorageWarning('本地空间不足，已自动移除最早的部分历史战绩。');
        }
        return true;
      } catch (e) {
        out.pop();
      }
    }
    try { localStorage.setItem(ctx.HISTORY_KEY, '[]'); } catch (e2) { /* storage unavailable */ }
    showStorageWarning('历史战绩保存失败：浏览器本地存储空间不足。');
    return false;
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function renderHomeHistory() {
    var entry = ctx.$('history-entry');
    if (!entry) return;
    var h = loadHistory();
    if (!h.length) { entry.style.display = 'none'; return; }
    entry.style.display = 'flex';
    ctx.$('history-count').textContent = h.length;
  }
  /* 按战队名关键字匹配官方口号（KSG/Hero 等存多条的随机取一条） */
  function teamSlogan(name) {
    var map = ctx.DATA.teamSlogans || {};
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      if (name.indexOf(keys[i]) >= 0) {
        var s = map[keys[i]];
        if (Array.isArray(s)) return s[Math.floor(Math.random() * s.length)];
        return s;
      }
    }
    return null;
  }
  function showHistory() {
    ctx.showPage('history');
    ctx.recordAchievementEvent('historyReads');
    var h = loadHistory();
    var list = ctx.$('history-list');
    ctx.$('history-meta').textContent = h.length ? '共 ' + h.length + ' 条征战记录' : '';
    ctx.$('history-empty').style.display = h.length ? 'none' : 'block';
    ctx.$('history-clear').style.visibility = h.length ? '' : 'hidden';
    list.innerHTML = h.map(function (r, i) {
      var cls = r.champ ? 'win' : (r.banner && String(r.banner).indexOf('亚军') >= 0 ? 'runner' : 'elim');
      return '<div class="his-item" data-i="' + i + '">' +
        '<button class="his-open" data-i="' + i + '"><div class="his-top"><span class="his-team">' + ctx.esc(r.teamName) + ' · ' + ctx.esc(r.seasonName) + '</span>' +
        '<span class="his-banner ' + cls + '">' + ctx.esc(r.banner) + '</span></div>' +
        '<div class="his-sub">' + ctx.esc((r.rosterNames || []).join('、')) + ' · ' + fmtTime(r.savedAt) + '</div></button>' +
        '<button class="his-delete" data-i="' + i + '" aria-label="删除这条战绩">删除</button></div>';
    }).join('');
    list.querySelectorAll('.his-open').forEach(function (el) {
      el.addEventListener('click', function () { restoreHistory(parseInt(el.getAttribute('data-i'), 10)); });
    });
    list.querySelectorAll('.his-delete').forEach(function (el) {
      el.addEventListener('click', function () {
        var index = parseInt(el.getAttribute('data-i'), 10);
        ctx.openConfirm('删除这条战绩', '删除后无法恢复，确定继续吗？', function () {
          var next = loadHistory();
          next.splice(index, 1);
          saveHistory(next);
          showHistory();
          renderHomeHistory();
        }, '确认删除');
      });
    });
    ctx.$('history-clear').onclick = function () {
      if (!loadHistory().length) return;
      ctx.openConfirm('清空历史战绩', '全部战绩都将被删除，并且无法恢复。确定继续吗？', function () {
        saveHistory([]);
        showHistory();
        renderHomeHistory();
      }, '确认清空');
    };
  }
  function restoreHistory(i) {
    var h = loadHistory();
    var r = h[i];
    if (!r || !r.lastRun) return;
    if (r.mode === 'allstar') {
      ctx.STATE.mode = 'allstar';
      var savedAllStar = r.allStar || {};
      var customs = mergeCustomPlayers(ctx.STATE.allStar.customs, savedAllStar.customs);
      ctx.STATE.allStar = Object.assign({}, ctx.STATE.allStar, savedAllStar, { customs: customs });
      ctx.STATE.seed = r.seed || 0;
      ctx.STATE.tactic = (r.lastRun && r.lastRun.tactic) || 'balanced';
      ctx.STATE.lastRun = r.lastRun;
      saveState(); ctx.go('#/result'); return;
    }
    ctx.STATE.mode = r.mode === 'budget' ? 'budget' : 'classic';
    ctx.STATE.budgetTotal = r.lastRun && Number.isFinite(r.lastRun.budgetTotal) ? r.lastRun.budgetTotal : null;
    ctx.STATE.team = r.team;
    ctx.STATE.roster = r.roster || [];
    ctx.STATE.season = r.season;
    ctx.STATE.seed = r.seed;
    ctx.STATE.tactic = (r.lastRun && r.lastRun.tactic) || 'balanced';
    ctx.STATE.dynasty = null;
    ctx.STATE.lastRun = r.lastRun;
    saveState();
    ctx.go('#/result');
  }

  /* ---------------- 本地成就任务 ---------------- */

return {showStorageWarning,mergeCustomPlayers,compactAllStarState,normalizeAllStarState,saveState,loadState,loadHistory,saveHistory,fmtTime,renderHomeHistory,teamSlogan,showHistory,restoreHistory};
};
})(window);
