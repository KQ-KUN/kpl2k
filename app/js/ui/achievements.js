/* achievements: injected coordination callbacks; no module imports or listener installation at load. */
(function(global){'use strict';
(global.KPL_UI_MODULES=global.KPL_UI_MODULES||{}).achievements=function(ctx){
  function emptyAchievementProgress() {
    return {
      version: 1, runs: 0, championships: 0, perfectRuns: 0, comebacks: 0,
      deciders: 0, loserRuns: 0, allStarRuns: 0, customRuns: 0,
      savedCards: 0, sharedRuns: 0, historyReads: 0, rosterEdits: 0,
      tactics: {}, seasons: {}, libraryPlayers: {}, unlocked: {}, lastRunKey: ''
    };
  }

  function normalizeAchievementProgress(value) {
    var base = emptyAchievementProgress();
    if (!value || typeof value !== 'object') return base;
    ['runs', 'championships', 'perfectRuns', 'comebacks', 'deciders', 'loserRuns', 'allStarRuns', 'customRuns', 'savedCards', 'sharedRuns', 'historyReads', 'rosterEdits'].forEach(function (key) {
      var count = Number(value[key]);
      base[key] = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
    });
    ['tactics', 'seasons', 'libraryPlayers', 'unlocked'].forEach(function (key) {
      if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) base[key] = value[key];
    });
    base.libraryPlayers = Object.fromEntries(Object.keys(base.libraryPlayers).map(function (key) { return [key.split('@')[0], true]; }));
    base.lastRunKey = typeof value.lastRunKey === 'string' ? value.lastRunKey : '';
    return base;
  }

  function achievementDefinitions(progress) {
    return [
      { id: 'first_run', icon: '🎮', name: '平行时空启程', desc: '完成1次比赛模拟', value: progress.runs, target: 1 },
      { id: 'ten_runs', icon: '🗓️', name: '身经百战', desc: '累计完成10次比赛模拟', value: progress.runs, target: 10 },
      { id: 'first_champ', icon: '🏆', name: '第一座奖杯', desc: '在经典模式中首次夺冠', value: progress.championships, target: 1 },
      { id: 'three_champs', icon: '👑', name: '冠军经理', desc: '在经典模式中累计夺冠3次', value: progress.championships, target: 3 },
      { id: 'perfect_run', icon: '🔥', name: '不败登顶', desc: '以全胜战绩完成一次冠军征程', value: progress.perfectRuns, target: 1 },
      { id: 'comeback', icon: '⚡', name: '绝境反击', desc: '完成一次让二追三、让三追四或逆风翻盘', value: progress.comebacks, target: 1 },
      { id: 'deciders', icon: '🎯', name: '决胜局专家', desc: '累计经历3次决胜局系列赛', value: progress.deciders, target: 3 },
      { id: 'loser_run', icon: '🛡️', name: '败者组奇迹', desc: '从败者组连续赢下至少2轮', value: progress.loserRuns, target: 1 },
      { id: 'allstar', icon: '🌟', name: '群星召集人', desc: '完成1场全明星对决', value: progress.allStarRuns, target: 1 },
      { id: 'custom_star', icon: '🪪', name: '这次我上场', desc: '使用自定义选手完成全明星对决', value: progress.customRuns, target: 1 },
      { id: 'tactics', icon: '🧠', name: '战术万花筒', desc: '分别使用三种赛前策略完成比赛', value: Object.keys(progress.tactics).length, target: 3 },
      { id: 'seasons', icon: '🕰️', name: '时空旅行者', desc: '征战5个不同赛季', value: Object.keys(progress.seasons).length, target: 5 },
      { id: 'library_read', icon: '📖', name: '初识群星', desc: '在选手图鉴中展开1位选手的年度资料', value: Object.keys(progress.libraryPlayers).length, target: 1 },
      { id: 'library_ten', icon: '🔭', name: '群星观察家', desc: '在选手图鉴中阅读10位不同选手', value: Object.keys(progress.libraryPlayers).length, target: 10 },
      { id: 'save_card', icon: '🖼️', name: '留住高光', desc: '下载保存1张战绩卡', value: progress.savedCards, target: 1 },
      { id: 'history_read', icon: '📜', name: '回望来路', desc: '查看1次历史战绩', value: progress.historyReads, target: 1 },
      { id: 'roster_edit', icon: '🔧', name: '阵容工程师', desc: '手动调整1次首发阵容', value: progress.rosterEdits, target: 1 },
      { id: 'share_run', icon: '🔗', name: '平行时空信使', desc: '复制1次可还原的战绩链接', value: progress.sharedRuns, target: 1 }
    ];
  }

  function achievementRunKey(run) {
    return [run.completedAt || '', run.mode || 'classic', run.team || '', run.season || '', run.seed || '', run.score || '',
      (run.path || []).map(function (entry) { return entry.round + ':' + entry.score; }).join(',')].join('|');
  }

  function applyAchievementRun(progress, run, notify) {
    if (!run) return [];
    var key = achievementRunKey(run);
    if (key === progress.lastRunKey) return [];
    var before = {};
    achievementDefinitions(progress).forEach(function (item) { before[item.id] = item.value >= item.target; });
    var tags = ctx.achievementTags(run);
    var isAllStar = run.mode === 'allstar';
    var isChamp = !isAllStar && (run.champ === true || (run.champion && ctx.teamName(run.champion) === ctx.teamName(run.team)));
    progress.runs += 1;
    if (isChamp) progress.championships += 1;
    if (tags.indexOf('全胜夺冠') >= 0) progress.perfectRuns += 1;
    if (tags.some(function (tag) { return tag === '让二追三' || tag === '让三追四' || tag === '逆风翻盘'; })) progress.comebacks += 1;
    progress.deciders += (run.path || []).filter(function (entry) {
      var score = ctx.scoreParts(entry.score);
      return Math.abs(score[0] - score[1]) === 1 && Math.min(score[0], score[1]) >= 1;
    }).length;
    if (tags.some(function (tag) { return String(tag).indexOf('败者组一穿') === 0; })) progress.loserRuns += 1;
    if (isAllStar) progress.allStarRuns += 1;
    if (isAllStar && ctx.allStarHasCustom(run)) progress.customRuns += 1;
    progress.tactics[run.tactic || 'balanced'] = true;
    if (run.season) progress.seasons[run.season] = true;
    progress.lastRunKey = key;
    var unlocked = [];
    achievementDefinitions(progress).forEach(function (item) {
      if (item.value >= item.target && !progress.unlocked[item.id]) {
        progress.unlocked[item.id] = Date.now();
        if (notify && !before[item.id]) unlocked.push(item);
      }
    });
    return unlocked;
  }

  function saveAchievementProgress(progress) {
    try {
      localStorage.setItem(ctx.ACHIEVEMENT_KEY, JSON.stringify(progress));
      return true;
    } catch (e) {
      ctx.showStorageWarning('成就进度保存失败：浏览器本地存储空间不足。');
      return false;
    }
  }

  function reconcileAchievementHistory(progress) {
    var before = JSON.stringify([progress.runs, progress.championships, progress.allStarRuns, progress.tactics, progress.seasons]);
    var history = ctx.loadHistory();
    progress.runs = Math.max(progress.runs, history.length);
    progress.championships = Math.max(progress.championships, history.filter(function (item) {
      return item && item.mode !== 'allstar' && item.champ === true;
    }).length);
    progress.allStarRuns = Math.max(progress.allStarRuns, history.filter(function (item) { return item && item.mode === 'allstar'; }).length);
    history.forEach(function (item) {
      var run = item && item.lastRun;
      if (!run) return;
      progress.tactics[run.tactic || 'balanced'] = true;
      if (run.season) progress.seasons[run.season] = true;
    });
    return before !== JSON.stringify([progress.runs, progress.championships, progress.allStarRuns, progress.tactics, progress.seasons]);
  }

  function loadAchievementProgress() {
    try {
      var raw = localStorage.getItem(ctx.ACHIEVEMENT_KEY);
      if (raw) {
        var saved = normalizeAchievementProgress(JSON.parse(raw));
        if (reconcileAchievementHistory(saved)) {
          var repairedUnlocks = [];
          achievementDefinitions(saved).forEach(function (item) {
            if (item.value >= item.target && !saved.unlocked[item.id]) {
              saved.unlocked[item.id] = Date.now();
              repairedUnlocks.push(item);
            }
          });
          saveAchievementProgress(saved);
          if (repairedUnlocks.length) setTimeout(function () { showAchievementToast(repairedUnlocks); }, 0);
        }
        return saved;
      }
    } catch (e) { /* migrate from history below */ }
    var progress = emptyAchievementProgress();
    ctx.loadHistory().slice().reverse().forEach(function (item) {
      if (!item || !item.lastRun) return;
      var historicalRun = Object.assign({}, item.lastRun, { completedAt: item.savedAt, champ: item.champ });
      applyAchievementRun(progress, historicalRun, false);
    });
    saveAchievementProgress(progress);
    return progress;
  }

  function showAchievementToast(items) {
    if (!items.length) return;
    var toast = ctx.$('achievement-toast');
    ctx.$('achievement-toast-name').textContent = items.slice(0, 2).map(function (item) { return item.name; }).join('、') + (items.length > 2 ? '等' : '');
    toast.classList.add('show');
    if (ctx.achievementToastTimer) clearTimeout(ctx.achievementToastTimer);
    ctx.achievementToastTimer = setTimeout(function () { toast.classList.remove('show'); }, 6500);
  }

  function recordAchievementRun(run) {
    var progress = loadAchievementProgress();
    var unlocked = applyAchievementRun(progress, run, true);
    if (!saveAchievementProgress(progress)) return;
    renderHomeAchievements(progress);
    showAchievementToast(unlocked);
  }

  function recordAchievementEvent(key) {
    var progress = loadAchievementProgress();
    var before = {};
    achievementDefinitions(progress).forEach(function (item) { before[item.id] = item.value >= item.target; });
    progress[key] = (progress[key] || 0) + 1;
    var unlocked = [];
    achievementDefinitions(progress).forEach(function (item) {
      if (item.value >= item.target && !progress.unlocked[item.id]) {
        progress.unlocked[item.id] = Date.now();
        if (!before[item.id]) unlocked.push(item);
      }
    });
    if (!saveAchievementProgress(progress)) return;
    renderHomeAchievements(progress);
    showAchievementToast(unlocked);
  }

  function renderHomeAchievements(progress) {
    progress = progress || loadAchievementProgress();
    var defs = achievementDefinitions(progress);
    var count = defs.filter(function (item) { return item.value >= item.target; }).length;
    if (ctx.$('achievement-count')) ctx.$('achievement-count').textContent = count + ' / ' + defs.length;
  }

  function showAchievements() {
    ctx.showPage('achievements');
    var progress = loadAchievementProgress();
    var defs = achievementDefinitions(progress);
    var count = defs.filter(function (item) { return item.value >= item.target; }).length;
    ctx.$('achievement-page-count').textContent = count + ' / ' + defs.length;
    ctx.$('achievement-summary-title').textContent = count === defs.length ? '传奇经理' : (count >= 8 ? '冠军经理' : (count >= 4 ? '进阶经理' : '新锐经理'));
    ctx.$('achievement-summary-text').textContent = '已完成 ' + count + ' 项挑战 · 累计模拟 ' + progress.runs + ' 次 · 经典冠军 ' + progress.championships + ' 次';
    ctx.$('achievement-grid').innerHTML = defs.map(function (item) {
      var unlocked = item.value >= item.target;
      var value = Math.min(item.value, item.target);
      var pct = Math.round(value / item.target * 100);
      return '<div class="achievement-card' + (unlocked ? ' unlocked' : '') + '">' +
        '<div class="achievement-icon">' + item.icon + '</div><div><div class="achievement-card-head">' +
        '<div class="achievement-name">' + item.name + '</div><div class="achievement-state">' + (unlocked ? '已完成' : value + ' / ' + item.target) + '</div></div>' +
        '<div class="achievement-desc">' + item.desc + '</div><div class="achievement-progress"><div class="achievement-progress-fill" style="width:' + pct + '%"></div></div></div></div>';
    }).join('');
  }


return {emptyAchievementProgress,normalizeAchievementProgress,achievementDefinitions,achievementRunKey,applyAchievementRun,saveAchievementProgress,reconcileAchievementHistory,loadAchievementProgress,showAchievementToast,recordAchievementRun,recordAchievementEvent,renderHomeAchievements,showAchievements};
};
})(window);
