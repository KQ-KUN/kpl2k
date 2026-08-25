/* KPL 2K SPA 主逻辑：路由 / 组队 / 战场 / 模拟 / 结算 / 分享 */
(function (global) {
  'use strict';

  var E = KPL_ENGINE, N = KPL_NARRATIVE, D = KPL_DATA, DATA = D.DATA;
  var STATE_KEY = 'kpl2k_state_v1';
  var DISCLAIMER_KEY = 'kpl2k_disclaimer_v1';
  var HISTORY_KEY = 'kpl2k_history_v1';
  var POS_ORDER = ['对抗路', '打野', '中路', '发育路', '游走'];
  var PRESET_SEASONS = ['KPL2026S2', 'KPL2026S1']; // 2026 现役首发优先取最新

  var STATE = {
    mode: 'classic',
    team: null,
    roster: [],          // [{pid, sid}] 5 槽
    season: null,
    seed: 0,
    tactic: 'balanced',
    dynasty: null,
    lastRun: null,       // {champion, path, regular, events, rosterNames, records}
    allStar: {
      aTeam: null, bTeam: null, aRoster: [], bRoster: [], bo: 5, customs: []
    }
  };

  var picker = { open: false, slot: 0, pid: null, sid: null };
  var storageWarningTimer = null;
  var shareVersionNotice = '';

  /* ---------------- 状态持久化 ---------------- */
  function showStorageWarning(message) {
    var el = $('storage-warning');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    if (storageWarningTimer) clearTimeout(storageWarningTimer);
    storageWarningTimer = setTimeout(function () { el.classList.remove('show'); }, 5000);
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

  function saveState() {
    var payload = JSON.stringify({
      mode: STATE.mode, team: STATE.team, roster: STATE.roster, season: STATE.season, seed: STATE.seed, tactic: STATE.tactic,
      dynasty: STATE.dynasty,
      lastRun: STATE.lastRun, allStar: STATE.allStar
    });
    try {
      localStorage.setItem(STATE_KEY, payload);
      return true;
    } catch (e) {
      var storageHistory = loadHistory();
      while (storageHistory.length) {
        storageHistory.pop();
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(storageHistory));
          localStorage.setItem(STATE_KEY, payload);
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
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      STATE.mode = s.mode || 'classic';
      STATE.team = s.team || null;
      STATE.roster = s.roster || [];
      STATE.season = s.season || null;
      STATE.seed = s.seed || 0;
      STATE.tactic = ['stable', 'balanced', 'gamble'].indexOf(s.tactic) >= 0 ? s.tactic : 'balanced';
      STATE.dynasty = s.dynasty || null;
      STATE.lastRun = s.lastRun || null;
      STATE.allStar = s.allStar || STATE.allStar;
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function f1(v) { return (v == null || isNaN(v)) ? '-' : (Math.round(v * 10) / 10); }
  function pct(v) {
    if (v == null || isNaN(v)) return '-';
    var x = v > 1 ? v : v * 100;  // 部分字段是百分数值（参团），部分是小数值（输出/胜率）
    return (Math.round(x * 10) / 10) + '%';
  }
  function go(hash) { location.hash = hash; }
  function buildVersion() { return (DATA.manifest && DATA.manifest.build_version) || 'legacy'; }
  function tacticName(value) {
    return { stable: '稳健运营', balanced: '均衡应对', gamble: '放手一搏' }[value] || '均衡应对';
  }
  function renderTacticPickers() {
    document.querySelectorAll('.tactic-picker button').forEach(function (button) {
      button.classList.toggle('sel', button.getAttribute('data-tactic') === STATE.tactic);
    });
  }

  /* ---------------- 玩家须知（未同意前全屏遮罩） ---------------- */
  function initDisclaimer() {
    var mask = $('disclaimer');
    if (!mask) return;
    $('btn-disclaimer').addEventListener('click', function () {
      $('dc-hint').style.display = 'none';
      mask.style.display = 'flex';
    });
    $('dc-agree').addEventListener('click', function () {
      try { localStorage.setItem(DISCLAIMER_KEY, '1'); } catch (e) { /* ignore */ }
      $('dc-hint').style.display = 'none';
      mask.style.display = 'none';
    });
    $('dc-refuse').addEventListener('click', function () {
      $('dc-hint').style.display = 'block';
    });
    var agreed = false;
    try { agreed = localStorage.getItem(DISCLAIMER_KEY) === '1'; } catch (e) { /* ignore */ }
    mask.style.display = agreed ? 'none' : 'flex';
  }

  /* ---------------- 历史战绩（首页） ---------------- */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
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
        localStorage.setItem(HISTORY_KEY, JSON.stringify(out));
        if (out.length < Math.min(h.length, 20)) {
          showStorageWarning('本地空间不足，已自动移除最早的部分历史战绩。');
        }
        return true;
      } catch (e) {
        out.pop();
      }
    }
    try { localStorage.setItem(HISTORY_KEY, '[]'); } catch (e2) { /* storage unavailable */ }
    showStorageWarning('历史战绩保存失败：浏览器本地存储空间不足。');
    return false;
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function renderHomeHistory() {
    var entry = $('history-entry');
    if (!entry) return;
    var h = loadHistory();
    if (!h.length) { entry.style.display = 'none'; return; }
    entry.style.display = 'flex';
    $('history-count').textContent = h.length;
  }
  /* 按战队名关键字匹配官方口号（KSG/Hero 等存多条的随机取一条） */
  function teamSlogan(name) {
    var map = DATA.teamSlogans || {};
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
    showPage('history');
    var h = loadHistory();
    var list = $('history-list');
    $('history-meta').textContent = h.length ? '共 ' + h.length + ' 条征战记录' : '';
    $('history-empty').style.display = h.length ? 'none' : 'block';
    list.innerHTML = h.map(function (r, i) {
      var cls = r.champ ? 'win' : (r.banner && String(r.banner).indexOf('亚军') >= 0 ? 'runner' : 'elim');
      return '<div class="his-item" data-i="' + i + '">' +
        '<div class="his-top"><span class="his-team">' + esc(r.teamName) + ' · ' + esc(r.seasonName) + '</span>' +
        '<span class="his-banner ' + cls + '">' + esc(r.banner) + '</span></div>' +
        '<div class="his-sub">' + esc((r.rosterNames || []).join('、')) + ' · ' + fmtTime(r.savedAt) + '</div></div>';
    }).join('');
    list.querySelectorAll('.his-item').forEach(function (el) {
      el.addEventListener('click', function () { restoreHistory(parseInt(el.getAttribute('data-i'), 10)); });
    });
    $('history-clear').onclick = function () { saveHistory([]); showHistory(); };
  }
  function restoreHistory(i) {
    var h = loadHistory();
    var r = h[i];
    if (!r || !r.lastRun) return;
    if (r.mode === 'allstar') {
      STATE.mode = 'allstar';
      var savedAllStar = r.allStar || {};
      var customs = mergeCustomPlayers(STATE.allStar.customs, savedAllStar.customs);
      STATE.allStar = Object.assign({}, STATE.allStar, savedAllStar, { customs: customs });
      STATE.seed = r.seed || 0;
      STATE.tactic = (r.lastRun && r.lastRun.tactic) || 'balanced';
      STATE.lastRun = r.lastRun;
      saveState(); go('#/result'); return;
    }
    STATE.mode = 'classic';
    STATE.team = r.team;
    STATE.roster = r.roster || [];
    STATE.season = r.season;
    STATE.seed = r.seed;
    STATE.tactic = (r.lastRun && r.lastRun.tactic) || 'balanced';
    STATE.dynasty = null;
    STATE.lastRun = r.lastRun;
    saveState();
    go('#/result');
  }

  function teamName(fid) { return DATA.names[fid] || fid; }
  function abbrOf(fid) {
    var f = D.franchise(fid);
    return (f && f.abbr) || teamName(fid).slice(0, 2);
  }
  function teamIcon(fid) { return (DATA.teamIcons || {})[fid] || ''; }
  function teamAvaHtml(fid, name) {
    var icon = teamIcon(fid);
    var ch = esc(String(name || '?').slice(0, 1));
    if (!icon) return '<span class="bk-ava-fb">' + ch + '</span>';
    // img 加载失败时隐藏自身并显示首字兜底，避免在 onerror 里拼 HTML 导致转义错乱
    return '<span class="bk-ava-box"><img class="bk-ava" src="' + esc(icon) + '" alt="" loading="lazy" ' +
      'referrerpolicy="no-referrer" ' +
      'onerror="this.style.display=&#39;none&#39;;this.nextElementSibling.style.display=&#39;inline-flex&#39;">' +
      '<span class="bk-ava-fb" style="display:none">' + ch + '</span></span>';
  }
  /* 通用战队徽章（选人界面/战队条用），图片失败回退首字 */
  function teamBadgeHtml(fid, name) {
    var icon = teamIcon(fid);
    var ch = esc(String(name || abbrOf(fid) || '?').slice(0, 1));
    if (!icon) return '<span class="team-ava fb">' + ch + '</span>';
    return '<span class="team-ava box"><img src="' + esc(icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' +
      'onerror="this.style.display=&#39;none&#39;;this.nextElementSibling.style.display=&#39;inline-flex&#39;">' +
      '<span class="team-ava fb" style="display:none">' + ch + '</span></span>';
  }

  function customPlayer(pid) {
    return ((STATE.allStar && STATE.allStar.customs) || []).find(function (p) { return p.id === pid; });
  }
  function playerName(pid) {
    var custom = customPlayer(pid);
    return (custom && custom.name) || (DATA.players[pid] && DATA.players[pid].name) || pid;
  }
  function playerIcon(pid) {
    var custom = customPlayer(pid);
    return (custom && custom.icon) || (DATA.players[pid] && DATA.players[pid].icon) || '';
  }

  /* 把 roster 槽位映射为 record（从已加载赛季分片找） */
  function recordsForRoster(roster) {
    var out = [];
    roster.forEach(function (slot) {
      var rec = null;
      var season = DATA.seasonCache[slot.sid];
      if (season) {
        rec = season.rosters.find(function (r) {
          return r.player_id === slot.pid && r.season_id === slot.sid;
        });
      }
      if (!rec) rec = versionRecordFor(slot);
      if (rec) out.push(rec);
    });
    return out;
  }

  /* 兜底：赛季分片缺该选手记录（数据缺口/换人版本未收录）时，
     从战队图鉴版本数据构造 record，保证阵容 5 人齐全、战绩卡不丢人 */
  function versionRecordFor(slot) {
    var data = currentTeamData || DATA.teamsCache[STATE.team];
    if (!data || !data.players) return null;
    var p = data.players.find(function (x) { return x.player_id === slot.pid; });
    if (!p) return null;
    var v = (p.versions || []).find(function (x) { return x.season_id === slot.sid; });
    if (!v) return null;
    return {
      player_id: slot.pid,
      season_id: slot.sid,
      team_franchise: STATE.team,
      position: v.position,
      rating: v.rating || 70,
      games: v.games || 5,
      avg_kill_num: 0, avg_assist_num: 0, avg_death_num: 0,
      avg_participation_rate: 0, avg_hurt_to_hero_total_rate: 0,
      avg_be_hurt_by_hero_total_rate: 0, avg_gpm: 0,
      avg_damage_convert_rate: 0, avg_push_tower_num: 0,
      avg_kda: 0, win_rate: 0, mvp_count: 0
    };
  }

  function strengthOf() {
    var recs = recordsForRoster(STATE.roster);
    var sids = STATE.roster.map(function (s) { return s.sid; });
    var chem = D.buildChemFor(sids);
    return E.lineupStrength(recs, chem, E.COMPRESS);
  }

  /* ---------------- BGM ---------------- */
  function bgmIconHtml(muted) {
    var waves = muted ? '' :
      '<path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M18 6a9 9 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';
    var slash = muted ?
      '<path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>' : '';
    return '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">' +
      '<path d="M3 10v4h4l5 4V6L7 10H3z" fill="currentColor"/>' + waves + slash + '</svg>';
  }

  // 三处音量键联动：任意一个开关，其它同步
  function syncBgmToggles() {
    var muted = BGM.isMuted();
    ['bgm-toggle-home', 'sim-bgm-toggle', 'bgm-toggle'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.innerHTML = bgmIconHtml(muted);
      el.title = muted ? '开启音乐' : '关闭音乐';
      el.classList.toggle('muted', muted);
    });
  }

  function toggleBgm() {
    BGM.setMuted(!BGM.isMuted());
    syncBgmToggles();
  }

  function initBGM() {
    BGM.init({
      intro: ['assets/audio/首页.m4a'],
      battle: [
        { name: '王者冰刃', src: 'assets/audio/王者冰刃.m4a' },
        { name: '云梦谣', src: 'assets/audio/云梦谣.m4a' },
        { name: '荣耀主题', src: 'assets/audio/荣耀主题.m4a' },
        { name: '冠军杯', src: 'assets/audio/冠军杯.m4a' },
        { name: '明日坐标', src: 'assets/audio/明日坐标.m4a' }
      ],
      battleDefault: 0,
      champion: {
        default: 'assets/audio/无双的王者.m4a',
        byTeam: {
          '成都AG超玩会': 'assets/audio/红小孩.m4a',
          '重庆狼队': 'assets/audio/狼小孩.m4a',
          '武汉eStarPro': 'assets/audio/星小孩.m4a',
          '广州TTG': 'assets/audio/TT小孩.m4a',
          'KSG': 'assets/audio/KSG小孩.m4a',
          '南通Hero久竞': 'assets/audio/HERO小孩.m4a',
          '深圳DYG': 'assets/audio/DYG小孩.m4a',
          '长沙TES.A': 'assets/audio/突然的陀螺小孩.m4a'
        }
      }
    });
    syncBgmToggles();
    var once = function () {
      BGM.unlock();
      var hint = $('music-hint');
      if (hint) hint.style.display = 'none';
      // capture 标志必须与 addEventListener 一致，否则监听器永远不会被移除
      document.removeEventListener('click', once, true);
      document.removeEventListener('touchstart', once, true);
      document.removeEventListener('pointerdown', once, true);
    };
    // 手机端首次触摸（touchstart）即解锁，避免 click 被手势吞掉导致无声
    ['click', 'touchstart', 'pointerdown'].forEach(function (type) {
      document.addEventListener(type, once, { capture: true });
    });
  }

  function championTrack(teamName) {
    var cfg = { default: 'assets/audio/无双的王者.m4a', byTeam: {
      '成都AG超玩会': 'assets/audio/红小孩.m4a',
      '重庆狼队': 'assets/audio/狼小孩.m4a',
      '武汉eStarPro': 'assets/audio/星小孩.m4a',
      '广州TTG': 'assets/audio/TT小孩.m4a',
      'KSG': 'assets/audio/KSG小孩.m4a',
      '南通Hero久竞': 'assets/audio/HERO小孩.m4a',
      '深圳DYG': 'assets/audio/DYG小孩.m4a',
      '长沙TES.A': 'assets/audio/突然的陀螺小孩.m4a'
    } };
    var keys = Object.keys(cfg.byTeam);
    for (var i = 0; i < keys.length; i++) {
      if (teamName.indexOf(keys[i]) >= 0 || keys[i].indexOf(teamName) >= 0) return cfg.byTeam[keys[i]];
    }
    return cfg.default;
  }

  /* ---------------- 路由 ---------------- */
  function router() {
    var hash = location.hash || '#/';
    var m = hash.match(/^#\/s\?(.*)$/);
    if (m) { applyShare(m[1]); return; }
    var a = hash.match(/^#\/a\?(.*)$/);
    if (a) { applyAllStarShare(a[1]); return; }
    if (hash.indexOf('#/team') === 0) showTeam();
    else if (hash.indexOf('#/allstar') === 0) showAllStar();
    else if (hash.indexOf('#/season') === 0) showSeason();
    else if (hash.indexOf('#/sim') === 0) showSim();
    else if (hash.indexOf('#/result') === 0) showResult();
    else if (hash.indexOf('#/history') === 0) showHistory();
    else showHome();
  }

  function applyShare(qs) {
    var params = new URLSearchParams(qs);
    var t = params.get('t'), s = params.get('s'), r = params.get('r'), seed = params.get('seed');
    var sharedVersion = params.get('v');
    var versionMismatch = !sharedVersion || sharedVersion !== buildVersion();
    var roster = [];
    (r || '').split(',').forEach(function (pair) {
      var parts = pair.split('@');
      if (parts.length === 2) roster.push({ pid: parts[0], sid: parts[1] });
    });
    if (t && roster.length === 5) {
      STATE.mode = 'classic';
      STATE.team = t;
      STATE.roster = roster;
      STATE.season = s || null;
      STATE.seed = parseInt(seed || '0', 10) || 0;
      STATE.tactic = ['stable', 'balanced', 'gamble'].indexOf(params.get('tc')) >= 0 ? params.get('tc') : 'balanced';
      saveState();
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { /* ignore */ }
      var requestedRoster = roster.map(function (slot) { return slot.pid + '@' + slot.sid; }).join(',');
      var cachedRoster = cached && cached.lastRun && (cached.lastRun.records || []).map(function (record) {
        return record.player_id + '@' + record.season_id;
      }).join(',');
      var hit = cached && cached.lastRun &&
        !versionMismatch && cached.lastRun.version === buildVersion() &&
        cached.lastRun.team === t && cached.lastRun.seed === STATE.seed && cached.lastRun.season === STATE.season &&
        (cached.lastRun.tactic || 'balanced') === STATE.tactic && cachedRoster === requestedRoster;
      if (versionMismatch) shareVersionNotice = '该分享来自旧版本，已使用当前数据与规则重新模拟，赛果可能与原分享不同。';
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
    STATE.mode = 'allstar';
    STATE.allStar = Object.assign({}, STATE.allStar, {
      aTeam: params.get('at') || STATE.allStar.aTeam,
      bTeam: params.get('bt') || STATE.allStar.bTeam,
      aRoster: aRoster, bRoster: bRoster, bo: bo
    });
    STATE.seed = parseInt(params.get('seed') || '0', 10) || Math.floor(Math.random() * 100000);
    STATE.tactic = ['stable', 'balanced', 'gamble'].indexOf(params.get('tc')) >= 0 ? params.get('tc') : 'balanced';
    if (params.get('v') !== buildVersion()) {
      shareVersionNotice = '该全明星分享来自旧版本，已使用当前数据与规则重新模拟。';
    }
    saveState();
    location.hash = '#/sim';
  }

  /* ---------------- 视图切换 ---------------- */
  function showPage(name) {
    ['home', 'team', 'allstar', 'season', 'sim', 'result', 'history'].forEach(function (p) {
      $(p).classList.toggle('active', p === name);
    });
    ['team-bar', 'allstar-bar', 'season-bar', 'sim-bar', 'result-bar'].forEach(function (b) {
      var el = $(b);
      if (el) el.style.display = 'none';
    });
    if (name !== 'home') {
      var bar = $(name + '-bar');
      if (bar) bar.style.display = '';
    }
    window.scrollTo(0, 0);
  }

  /* ================= 首页 ================= */
  function showHome() {
    showPage('home');
    BGM.play('intro');
    var quick = $('btn-quick');
    if (quick) {
      quick.disabled = false;
      quick.querySelector('b').textContent = '30秒快速开赛';
    }
    if (DATA.manifest) {
      $('stat-line').innerHTML = '<b>' + DATA.manifest.teams2026.length + '</b> 支战队 · <b>' +
        DATA.manifest.seasons.length + '</b> 个赛季 · <b>' + Object.keys(DATA.players).length + '</b> 名选手';
    }
    renderHomeHistory();
  }

  function startQuickMatch() {
    var button = $('btn-quick');
    var featuredTeam = DATA.manifest.teams2026.some(function (t) { return t.id === '10001'; })
      ? '10001' : DATA.manifest.teams2026[0].id;
    var featuredSeason = DATA.manifest.seasons.some(function (s) { return s.season_id === 'KCC2026'; })
      ? 'KCC2026' : DATA.manifest.seasons[DATA.manifest.seasons.length - 1].season_id;
    button.disabled = true;
    button.querySelector('b').textContent = '正在载入推荐对局…';
    Promise.all([D.loadTeam(featuredTeam)].concat(D.loadSeasons([featuredSeason].concat(PRESET_SEASONS)))).then(function (res) {
      currentTeamData = res[0];
      STATE.mode = 'classic';
      STATE.team = featuredTeam;
      STATE.season = featuredSeason;
      STATE.dynasty = null;
      STATE.tactic = 'balanced';
      STATE.roster = presetRoster(featuredTeam);
      STATE.seed = Math.floor(Math.random() * 100000);
      saveState();
      if (STATE.roster.length === 5) go('#/sim');
      else go('#/team');
    }).catch(function () {
      showStorageWarning('快速开赛载入失败，请检查网络后重试。');
      button.disabled = false;
      button.querySelector('b').textContent = '30秒快速开赛';
    });
  }

  /* ================= 组队 ================= */
  var currentTeamData = null;

  function showTeam() {
    showPage('team');
    BGM.play('intro');
    if (!STATE.team && DATA.manifest.teams2026.length) {
      STATE.team = DATA.manifest.teams2026[0].id;
    }
    renderDynastyStrip();
    renderTeamStrip();
    loadTeamView(STATE.team);
  }

  /* 王朝战队预设：一键载入历史强阵（巅峰版本） */
  function renderDynastyStrip() {
    var html = DATA.dynasties.map(function (d) {
      var sel = STATE.dynasty === d.id ? ' sel' : '';
      return '<button class="dyn-chip' + sel + '" data-id="' + d.id + '">' +
        '<div class="dc-label">' + esc(d.label) + '</div>' +
        '<div class="dc-desc">' + esc(d.desc) + '</div></button>';
    }).join('');
    $('dynasty-strip').innerHTML = html;
    $('dynasty-strip').querySelectorAll('.dyn-chip').forEach(function (el) {
      el.addEventListener('click', function () { loadDynasty(el.getAttribute('data-id')); });
    });
  }

  function loadDynasty(id) {
    var d = DATA.dynasties.find(function (x) { return x.id === id; });
    if (!d) return;
    STATE.team = d.team_fid;
    STATE.roster = d.players.map(function (p) { return { pid: p.player_id, sid: p.season_id }; });
    STATE.dynasty = id;
    saveState();
    D.loadSeasons(d.players.map(function (p) { return p.season_id; })).then(function () {
      renderTeamStrip();
      renderDynastyStrip();
      renderSlots();
      renderStrength();
    }).catch(function (e) {
      $('team-slots').innerHTML = '<div class="mut">王朝阵容加载失败：' + esc(e.message) + '</div>';
    });
  }

  function renderTeamStrip() {
    var html = DATA.manifest.teams2026.map(function (t) {
      return '<button class="team-chip' + (t.id === STATE.team ? ' sel' : '') + '" data-fid="' + t.id + '">' +
        teamBadgeHtml(t.id, t.abbr || t.name) +
        '<div class="tc-name">' + esc(t.name) + '</div></button>';
    }).join('');
    $('team-strip').innerHTML = html;
    $('team-strip').querySelectorAll('.team-chip').forEach(function (el) {
      el.addEventListener('click', function () {
        var fid = el.getAttribute('data-fid');
        if (fid !== STATE.team) {
          STATE.team = fid;
          STATE.roster = [];  // 切队后重新加载该队 2026 首发
          STATE.dynasty = null;
        }
        saveState();
        renderTeamStrip();
        renderDynastyStrip();
        loadTeamView(STATE.team);
      });
    });
  }

  function loadTeamView(fid) {
    $('team-slots').innerHTML = '<div class="mut" style="padding:20px;text-align:center">正在加载选手数据…</div>';
    var loaders = PRESET_SEASONS.map(D.loadSeason);
    Promise.all([D.loadTeam(fid)].concat(loaders)).then(function (res) {
      currentTeamData = res[0];
      if (!STATE.roster.length) {
        STATE.roster = presetRoster(fid);
        saveState();
      }
      renderSlots();
      renderStrength();
    }).catch(function (e) {
      $('team-slots').innerHTML = '<div class="mut">加载失败：' + esc(e.message) + '</div>';
    });
  }

  /* 2026 现役首发：优先 S2，缺失队用 S1 */
  function presetRoster(fid) {
    // 1) 优先按"2026 年版本"拼 5 位置（槽位战力与选手图鉴版本一致）
    var data = currentTeamData;
    if (data && data.players && data.players.length) {
      var byPos = {};
      POS_ORDER.forEach(function (pos) { byPos[pos] = []; });
      data.players.forEach(function (p) {
        var best = null;
        (p.versions || []).forEach(function (v) {
          if (v.year === 2026 && (!best || v.rating > best.rating)) best = v;
        });
        if (best) byPos[best.position].push({ pid: p.player_id, sid: best.season_id, rating: best.rating });
      });
      var slots = POS_ORDER.map(function (pos) {
        var lst = byPos[pos].slice().sort(function (a, b) { return b.rating - a.rating; });
        return lst[0] ? { pid: lst[0].pid, sid: lst[0].sid } : null;
      }).filter(Boolean);
      if (slots.length === 5) return slots;
    }
    // 2) 回退：S2 / S1 赛季记录
    for (var i = 0; i < PRESET_SEASONS.length; i++) {
      var recs = D.seasonRoster(fid, PRESET_SEASONS[i]);
      if (recs.length >= 5) {
        return E.pickStarter(recs).map(function (r) { return { pid: r.player_id, sid: r.season_id }; });
      }
    }
    return [];
  }

  function slotInfo(pid, sid) {
    var season = DATA.seasonCache[sid];
    var rec = null;
    if (season) {
      rec = season.rosters.find(function (r) { return r.player_id === pid && r.season_id === sid; });
    }
    var ver = null;
    if (currentTeamData) {
      currentTeamData.players.forEach(function (p) {
        if (p.player_id !== pid) return;
        // 优先精确匹配版本赛季；旧状态可能存了同一年其它赛季，回退按年份匹配
        p.versions.forEach(function (v) {
          if (v.season_id === sid) ver = v;
        });
        if (!ver) {
          var y = String(sid).match(/(20\d{2})/);
          if (y) {
            p.versions.forEach(function (v) { if (String(v.year) === y[1] && (!ver || v.rating > ver.rating)) ver = v; });
          }
        }
      });
    }
    return { rec: rec, ver: ver, name: playerName(pid), icon: playerIcon(pid) };
  }

  function renderSlots() {
    var html = POS_ORDER.map(function (pos, i) {
      var slot = STATE.roster[i];
      var inner;
      if (slot) {
        var info = slotInfo(slot.pid, slot.sid);
        var rating = info.ver ? info.ver.rating : (info.rec ? info.rec.rating : null);
        var label = (info.ver && info.ver.label) || (slot.sid || '').replace(/^(KPL|KCC|L)/, '');
        var ava = info.icon
          ? '<div class="ava"><img src="' + esc(info.icon) + '" onerror="this.parentNode.textContent=&#39;' + esc(info.name[0]) + '&#39;"></div>'
          : '<div class="ava">' + esc(info.name[0]) + '</div>';
        inner = ava +
          '<div class="info"><div class="pname">' + esc(info.name) + '</div>' +
          '<div class="pmeta">' + esc(label) + ' · ' + esc(pos) + '</div></div>' +
          '<div class="rating">' + (rating != null ? Math.round(rating) : '-') + '</div><div class="arrow">›</div>';
      } else {
        inner = '<div class="info pname mut">点击补位</div><div class="arrow">›</div>';
      }
      return '<button class="slot" data-i="' + i + '"><div class="pos p' + i + '">' + esc(pos) + '</div>' + inner + '</button>';
    }).join('');
    $('team-slots').innerHTML = html;
    $('team-slots').querySelectorAll('.slot').forEach(function (el) {
      el.addEventListener('click', function () { openPicker(parseInt(el.getAttribute('data-i'), 10)); });
    });
  }

  function renderStrength() {
    var res = strengthOf();
    var eff = res[0], brk = res[1];
    var pctFill = Math.max(6, Math.min(100, (brk.raw - 40) / 55 * 100));
    $('strength-num').textContent = brk.raw.toFixed(1);
    $('strength-fill').style.width = pctFill + '%';
    $('strength-break').innerHTML =
      '<span>基础 <b>' + brk.base + '</b></span>' +
      '<span>覆盖 <b>' + brk.coverage + '</b></span>' +
      '<span>默契 <b>' + brk.synergy + '</b></span>' +
      '<span>胜率化学 <b>' + brk.win_synergy + '</b></span>' +
      '<span>风格 <b>' + brk.style + '</b></span>';
  }

  /* -------- 换人抽屉 -------- */
  function openPicker(slotIdx) {
    picker = { open: true, slot: slotIdx, pid: null, sid: null };
    D.loadTeam(STATE.team).then(function (data) {
      currentTeamData = data;
      renderPool(POS_ORDER[slotIdx]);
      $('drawer').classList.add('show');
      $('drawer-mask').classList.add('show');
    }).catch(function () {
      closePicker();
    });
  }

  /* 选手列表（可按返回回到此视图） */
  function renderPool(pos) {
    $('picker-pool').style.display = '';
    $('picker-ver').innerHTML = '';
    $('picker-back').style.display = 'none';
    $('picker-confirm').style.display = '';
    $('picker-title').textContent = pos + ' · 换人';
    $('picker-sub').innerHTML = teamBadgeHtml(STATE.team) + ' <span>' + esc(teamName(STATE.team)) + ' 历届' + esc(pos) + '</span>';
    var candidates = currentTeamData.players.filter(function (p) {
      return p.versions.some(function (v) { return v.position === pos; });
    }).sort(function (a, b) {
      var ra = maxRatingFor(a, pos), rb = maxRatingFor(b, pos);
      return rb - ra;
    });
    $('picker-pool').innerHTML = candidates.map(function (p) {
      var best = bestVersionFor(p, pos);
      var inRoster = STATE.roster.some(function (s) { return s && s.pid === p.player_id; });
      var ava = p.icon
        ? '<div class="ava"><img src="' + esc(p.icon) + '" onerror="this.parentNode.textContent=&#39;' + esc(p.name[0]) + '&#39;"></div>'
        : '<div class="ava">' + esc(p.name[0]) + '</div>';
      return '<button class="pool-item' + (inRoster ? ' sel' : '') + '" data-pid="' + p.player_id + '">' + ava +
        '<div><div class="pname">' + esc(p.name) + '</div>' +
        '<div class="pver">' + (inRoster ? '已在阵容 · ' : '') + esc(best.label) + ' · ' + esc(best.season_id) + '</div></div>' +
        '<div class="prate">' + Math.round(best.rating) + '</div></button>';
    }).join('');
    $('picker-pool').querySelectorAll('.pool-item').forEach(function (el) {
      el.addEventListener('click', function () {
        pickPlayer(el.getAttribute('data-pid'), pos);
      });
    });
  }

  function maxRatingFor(p, pos) {
    return p.versions.filter(function (v) { return v.position === pos; })
      .reduce(function (m, v) { return Math.max(m, v.rating || 0); }, 0);
  }
  function bestVersionFor(p, pos) {
    return p.versions.filter(function (v) { return v.position === pos; })
      .sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); })[0];
  }

  function pickPlayer(pid, pos) {
    var p = currentTeamData.players.find(function (x) { return x.player_id === pid; });
    if (!p) return;
    picker.pid = pid;
    var vers = p.versions.filter(function (v) { return v.position === pos; })
      .sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
    picker.sid = (vers[0] || {}).season_id || null;
    $('picker-pool').style.display = 'none';
    $('picker-back').style.display = '';
    $('picker-title').textContent = p.name + ' · 选择版本';
    $('picker-sub').textContent = '该选手在' + pos + '位的不同时期版本';
    $('picker-ver').innerHTML = vers.map(function (v) {
      var sel = v.season_id === picker.sid ? ' sel' : '';
      return '<button class="vchip' + sel + '" data-sid="' + v.season_id + '">' +
        esc(v.label) + ' · ' + Math.round(v.rating) + '</button>';
    }).join('');
    $('drawer').scrollTop = 0;
    $('picker-ver').querySelectorAll('.vchip').forEach(function (el) {
      el.addEventListener('click', function () {
        picker.sid = el.getAttribute('data-sid');
        $('picker-ver').querySelectorAll('.vchip').forEach(function (c) {
          c.classList.toggle('sel', c === el);
        });
      });
    });
  }

  function confirmPicker() {
    if (picker.mode === 'allstar') { confirmAllStarPicker(); return; }
    if (!picker.pid || !picker.sid) { closePicker(); return; }
    var slot = picker.slot;
    // 同一选手不能同时上场（转分路选手在不同位置也禁止重复，避免"两个无畏/两个妖刀"）
    var dupIdx = -1;
    STATE.roster.forEach(function (s, i) {
      if (i !== slot && s && s.pid === picker.pid) dupIdx = i;
    });
    if (dupIdx >= 0) {
      openConfirm('已在阵容中', '该选手已在阵容中，同一选手不能同时上场。请先更换原位置的选手。', null, '知道了');
      return;
    }
    // 换人后战绩卡按赛季记录渲染，新选手的版本赛季必须先加载，否则结果页会缺人
    var need = [picker.sid].filter(function (s) { return s && !DATA.seasonCache[s]; });
    var apply = function () {
      STATE.roster = STATE.roster.slice();
      while (STATE.roster.length < POS_ORDER.length) STATE.roster.push(null);
      STATE.roster[slot] = { pid: picker.pid, sid: picker.sid };
      if (SIM.session) {
        SIM.session.setRoster(STATE.team, recordsForRoster(STATE.roster));
        SIM.rosterChanged = true;
      }
      saveState();
      renderSlots();
      renderStrength();
      closePicker();
    };
    if (need.length) D.loadSeasons(need).then(apply).catch(apply);
    else apply();
  }
  function closePicker() {
    picker.open = false;
    $('drawer').classList.remove('show');
    $('drawer-mask').classList.remove('show');
    $('picker-confirm').style.display = '';
    $('picker-pool').style.display = '';
    $('picker-back').style.display = 'none';
  }

  /* ================= 全明星模式 ================= */
  function showAllStar() {
    showPage('allstar');
    BGM.play('intro');
    STATE.mode = 'allstar';
    var teams = DATA.manifest.teams2026 || [];
    if (!STATE.allStar.aTeam && teams.length) STATE.allStar.aTeam = teams[0].id;
    if (!STATE.allStar.bTeam && teams.length) STATE.allStar.bTeam = (teams[1] || teams[0]).id;
    renderAllStarTeamSelects();
    renderTacticPickers();
    $('allstar-a-slots').innerHTML = $('allstar-b-slots').innerHTML = '<div class="mut" style="padding:18px;text-align:center">正在加载全明星选手库…</div>';
    Promise.all([
      D.loadAllStar(), D.loadTeam(STATE.allStar.aTeam), D.loadTeam(STATE.allStar.bTeam)
    ].concat(PRESET_SEASONS.map(D.loadSeason))).then(function (res) {
      if (!STATE.allStar.aRoster.length) STATE.allStar.aRoster = presetRosterFromData(STATE.allStar.aTeam, res[1]);
      if (!STATE.allStar.bRoster.length) STATE.allStar.bRoster = presetRosterFromData(STATE.allStar.bTeam, res[2]);
      saveState();
      renderAllStar();
    }).catch(function (e) {
      $('allstar-a-slots').innerHTML = '<div class="mut">加载失败：' + esc(e.message) + '</div>';
      $('allstar-b-slots').innerHTML = '';
    });
  }

  function renderAllStarTeamSelects() {
    var options = (DATA.manifest.teams2026 || []).map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
    }).join('');
    ['a', 'b'].forEach(function (side) {
      var el = $('allstar-' + side + '-team');
      el.innerHTML = options;
      el.value = STATE.allStar[side + 'Team'];
    });
  }

  function presetRosterFromData(fid, data) {
    if (data && data.players) {
      var byPos = {};
      POS_ORDER.forEach(function (pos) { byPos[pos] = []; });
      data.players.forEach(function (p) {
        var best = null;
        (p.versions || []).forEach(function (v) {
          if (v.year === 2026 && (!best || v.rating > best.rating)) best = v;
        });
        if (best && byPos[best.position]) {
          byPos[best.position].push({ pid: p.player_id, sid: best.season_id, teamFid: fid, rating: best.rating });
        }
      });
      var slots = POS_ORDER.map(function (pos) {
        var item = byPos[pos].sort(function (a, b) { return b.rating - a.rating; })[0];
        return item ? { pid: item.pid, sid: item.sid, teamFid: item.teamFid } : null;
      }).filter(Boolean);
      if (slots.length === 5) return slots;
    }
    return [];
  }

  function allStarVersion(slot) {
    if (!slot || !DATA.allStar) return null;
    var pid = slot.templatePid || slot.pid;
    var p = (DATA.allStar.players || []).find(function (x) { return x.player_id === pid; });
    if (!p) return null;
    return (p.versions || []).find(function (v) {
      return v.season_id === slot.sid && (!slot.teamFid || v.team_fid === slot.teamFid);
    }) || (p.versions || []).find(function (v) { return v.season_id === slot.sid; }) || null;
  }

  function allStarRecord(slot, sideId, keepSourceTeam) {
    var v = allStarVersion(slot);
    if (!v) return null;
    var kda = v.kda || 0;
    var deaths = v.deaths;
    if (deaths == null && kda) deaths = ((v.kills || 0) + (v.assists || 0)) / kda;
    return {
      player_id: slot.pid, season_id: slot.sid,
      team_franchise: keepSourceTeam ? (v.team_fid || slot.teamFid) : sideId,
      position: v.position, rating: v.rating || 70, games: v.games || 5,
      avg_kda: kda, avg_kill_num: v.kills || 0, avg_death_num: deaths || 0,
      avg_assist_num: v.assists || 0, win_rate: v.win_rate || 0,
      avg_gpm: v.gpm || 0, avg_participation_rate: v.participation || 0,
      avg_hurt_to_hero_total_rate: v.hurt_rate || 0,
      avg_be_hurt_by_hero_total_rate: v.be_hurt_rate || 0,
      avg_damage_convert_rate: v.damage_convert || 0,
      avg_push_tower_num: v.towers || 0, mvp_count: v.mvp_count || 0
    };
  }

  function allStarRecords(side, keepSourceTeam) {
    var sideId = side === 'a' ? 'ALLSTAR_A' : 'ALLSTAR_B';
    return (STATE.allStar[side + 'Roster'] || []).map(function (slot) {
      return allStarRecord(slot, sideId, keepSourceTeam);
    }).filter(Boolean);
  }

  function renderAllStar() {
    ['a', 'b'].forEach(function (side) {
      var roster = STATE.allStar[side + 'Roster'] || [];
      $('allstar-' + side + '-slots').innerHTML = POS_ORDER.map(function (pos, i) {
        var slot = roster[i], inner;
        if (slot) {
          var v = allStarVersion(slot), name = playerName(slot.pid), icon = playerIcon(slot.pid);
          var ava = icon ? '<div class="ava"><img src="' + esc(icon) + '" onerror="this.parentNode.textContent=&#39;' + esc(name[0]) + '&#39;"></div>' : '<div class="ava">' + esc(name[0]) + '</div>';
          inner = ava + '<div class="info"><div class="pname">' + esc(name) + '</div>' +
            '<div class="pmeta">' + esc((v && v.label) || slot.sid) + ' · ' + esc((v && v.team_name) || '') +
            (slot.templatePid ? '<span class="custom-slot-hint">自定义选手 · 能力继承自 ' + esc(playerName(slot.templatePid)) + '</span>' : '') + '</div></div>' +
            '<div class="rating">' + (v ? Math.round(v.rating) : '-') + '</div><div class="arrow">›</div>';
        } else {
          inner = '<div class="info pname mut">点击补位</div><div class="arrow">›</div>';
        }
        return '<button class="slot" data-side="' + side + '" data-i="' + i + '"><div class="pos p' + i + '">' + esc(pos) + '</div>' + inner + '</button>';
      }).join('');
      $('allstar-' + side + '-slots').querySelectorAll('.slot').forEach(function (el) {
        el.addEventListener('click', function () { openAllStarPicker(side, parseInt(el.getAttribute('data-i'), 10)); });
      });
    });
    $('allstar-bo').querySelectorAll('button').forEach(function (el) {
      el.classList.toggle('sel', parseInt(el.getAttribute('data-bo'), 10) === STATE.allStar.bo);
    });
    var all = (STATE.allStar.aRoster || []).concat(STATE.allStar.bRoster || []).filter(Boolean);
    var ids = all.map(function (s) { return s.pid; });
    var valid = all.length === 10 && ids.filter(function (id, i) { return ids.indexOf(id) === i; }).length === 10;
    $('allstar-start').disabled = !valid;
    $('allstar-start').textContent = valid ? ('开始 ' + 'BO' + STATE.allStar.bo + ' 全明星对决') : '请补齐双方阵容并移除重复选手';
  }

  function changeAllStarTeam(side, fid) {
    STATE.allStar[side + 'Team'] = fid;
    STATE.allStar[side + 'Roster'] = [];
    D.loadTeam(fid).then(function (data) {
      STATE.allStar[side + 'Roster'] = presetRosterFromData(fid, data);
      saveState(); renderAllStar();
    });
  }

  function openAllStarPicker(side, slotIdx) {
    picker = { open: true, mode: 'allstar', side: side, slot: slotIdx, pid: null, sid: null, teamFid: null };
    renderAllStarPool(POS_ORDER[slotIdx], '');
    $('drawer').classList.add('show'); $('drawer-mask').classList.add('show');
  }

  function renderAllStarPool(pos, query) {
    var candidates = (DATA.allStar.players || []).filter(function (p) {
      return (p.versions || []).some(function (v) { return v.position === pos; }) &&
        (!query || p.name.toLowerCase().indexOf(query.toLowerCase()) >= 0);
    }).sort(function (a, b) { return maxRatingFor(a, pos) - maxRatingFor(b, pos); }).reverse();
    $('picker-title').textContent = pos + ' · 全联盟选人';
    $('picker-sub').textContent = '选择职业选手后可挑历史版本，也可把该版本设为自定义选手模板';
    $('picker-back').style.display = 'none'; $('picker-ver').innerHTML = ''; $('picker-confirm').style.display = 'none';
    $('picker-pool').style.display = '';
    $('picker-pool').innerHTML = '<div class="picker-tools"><input id="allstar-search" placeholder="搜索选手姓名" value="' + esc(query || '') + '"></div>' + candidates.map(function (p) {
      var best = bestVersionFor(p, pos);
      var ava = p.icon ? '<div class="ava"><img src="' + esc(p.icon) + '" onerror="this.parentNode.textContent=&#39;' + esc(p.name[0]) + '&#39;"></div>' : '<div class="ava">' + esc(p.name[0]) + '</div>';
      return '<button class="pool-item" data-pid="' + esc(p.player_id) + '" data-name="' + esc(p.name.toLowerCase()) + '">' + ava + '<div><div class="pname">' + esc(p.name) + '</div>' +
        '<div class="pver">' + esc(best.label) + ' · ' + esc(best.team_name || '') + '</div></div><div class="prate">' + Math.round(best.rating) + '</div></button>';
    }).join('');
    $('allstar-search').addEventListener('input', function () {
      var value = this.value.trim().toLowerCase();
      $('picker-pool').querySelectorAll('.pool-item').forEach(function (el) {
        el.style.display = !value || (el.getAttribute('data-name') || '').indexOf(value) >= 0 ? '' : 'none';
      });
    });
    $('picker-pool').querySelectorAll('.pool-item').forEach(function (el) {
      el.addEventListener('click', function () { pickAllStarPlayer(el.getAttribute('data-pid'), pos); });
    });
  }

  function pickAllStarPlayer(pid, pos) {
    var p = DATA.allStar.players.find(function (x) { return x.player_id === pid; });
    var versions = (p.versions || []).filter(function (v) { return v.position === pos; })
      .sort(function (a, b) { return (b.year || 0) - (a.year || 0) || (b.rating || 0) - (a.rating || 0); });
    picker.pid = pid; picker.sid = versions[0].season_id; picker.teamFid = versions[0].team_fid;
    $('picker-pool').style.display = 'none'; $('picker-back').style.display = '';
    $('picker-title').textContent = p.name + ' · 选择版本';
    $('picker-sub').textContent = '直接上场，或用所选版本的能力创建自定义选手';
    $('picker-ver').innerHTML = versions.map(function (v, i) {
      return '<button class="vchip' + (i === 0 ? ' sel' : '') + '" data-sid="' + esc(v.season_id) + '" data-fid="' + esc(v.team_fid) + '">' +
        esc(v.label) + ' · ' + esc(v.team_name) + ' · ' + Math.round(v.rating) + '</button>';
    }).join('') + '<button class="custom-entry" id="allstar-custom">＋ 用这个版本创建自定义选手</button>';
    $('picker-confirm').style.display = '';
    $('picker-ver').querySelectorAll('.vchip').forEach(function (el) {
      el.addEventListener('click', function () {
        picker.sid = el.getAttribute('data-sid'); picker.teamFid = el.getAttribute('data-fid');
        $('picker-ver').querySelectorAll('.vchip').forEach(function (v) { v.classList.toggle('sel', v === el); });
      });
    });
    $('allstar-custom').addEventListener('click', renderCustomPlayerForm);
  }

  function renderCustomPlayerForm() {
    var templateName = playerName(picker.pid);
    $('picker-title').textContent = '创建自定义选手'; $('picker-back').style.display = '';
    $('picker-sub').textContent = '能力模板：' + templateName + ' · ' + picker.sid;
    $('picker-ver').innerHTML = '';
    $('picker-pool').style.display = '';
    $('picker-confirm').style.display = 'none';
    $('picker-pool').innerHTML = '<div class="custom-form"><div class="custom-note">自定义选手只替换姓名和头像，位置、战力与比赛数据继承所选职业版本。头像仅保存在当前设备。</div>' +
      '<label>选手姓名<input id="custom-name" maxlength="12" placeholder="输入你的名字"></label>' +
      '<label>默认头像</label><div class="default-avatars"><button class="default-avatar sel" data-src="assets/custom-avatar-male.webp" aria-label="选择默认头像一"><img src="assets/custom-avatar-male.webp" alt=""></button>' +
      '<button class="default-avatar" data-src="assets/custom-avatar-female.webp" aria-label="选择默认头像二"><img src="assets/custom-avatar-female.webp" alt=""></button></div>' +
      '<label>或上传头像<input id="custom-avatar" type="file" accept="image/*"></label>' +
      '<div class="avatar-editor"><canvas class="avatar-crop" id="avatar-crop" width="384" height="384"></canvas>' +
      '<div class="zoom-control"><span>缩小</span><input id="avatar-zoom" type="range" min="1" max="3" step="0.01" value="1"><span>放大</span></div>' +
      '<span class="mut" style="font-size:11px">拖动头像调整裁剪位置</span></div>' +
      '<button class="btn gold" id="custom-create">创建并上场</button></div>';
    var editor = setupAvatarEditor('assets/custom-avatar-male.webp');
    $('picker-pool').querySelectorAll('.default-avatar').forEach(function (el) {
      el.addEventListener('click', function () {
        $('picker-pool').querySelectorAll('.default-avatar').forEach(function (b) { b.classList.toggle('sel', b === el); });
        editor.load(el.getAttribute('data-src'));
      });
    });
    $('custom-avatar').addEventListener('change', function () {
      var file = this.files && this.files[0]; if (!file) return;
      readImageFile(file).then(function (data) {
        $('picker-pool').querySelectorAll('.default-avatar').forEach(function (b) { b.classList.remove('sel'); });
        editor.load(data);
      }).catch(function () { openConfirm('头像读取失败', '请选择常见的 JPG、PNG 或 WebP 图片。', null, '知道了'); });
    });
    $('custom-create').addEventListener('click', function () {
      var name = $('custom-name').value.trim();
      var avatarData = editor.output();
      if (!name || !avatarData) { openConfirm('资料未完成', '请输入姓名并选择或上传头像。', null, '知道了'); return; }
      var id = 'custom_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 10000);
      STATE.allStar.customs.push({ id: id, name: name, icon: avatarData, templatePid: picker.pid });
      applyAllStarSlot({ pid: id, templatePid: picker.pid, sid: picker.sid, teamFid: picker.teamFid });
    });
  }

  function readImageFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () { resolve(reader.result); };
      reader.readAsDataURL(file);
    });
  }

  function setupAvatarEditor(initialSrc) {
    var canvas = $('avatar-crop'), ctx = canvas.getContext('2d'), zoom = $('avatar-zoom');
    var image = new Image(), baseScale = 1, scale = 1, x = 0, y = 0, dragging = false, lastX = 0, lastY = 0;
    function clamp() {
      var w = image.width * scale, h = image.height * scale;
      x = Math.min(0, Math.max(canvas.width - w, x));
      y = Math.min(0, Math.max(canvas.height - h, y));
    }
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (image.complete && image.naturalWidth) ctx.drawImage(image, x, y, image.width * scale, image.height * scale);
    }
    function load(src) {
      image = new Image();
      image.onload = function () {
        baseScale = Math.max(canvas.width / image.width, canvas.height / image.height);
        scale = baseScale; zoom.value = '1';
        x = (canvas.width - image.width * scale) / 2; y = (canvas.height - image.height * scale) / 2;
        draw();
      };
      image.src = src;
    }
    zoom.addEventListener('input', function () {
      var cx = (canvas.width / 2 - x) / scale, cy = (canvas.height / 2 - y) / scale;
      scale = baseScale * parseFloat(zoom.value);
      x = canvas.width / 2 - cx * scale; y = canvas.height / 2 - cy * scale; clamp(); draw();
    });
    canvas.addEventListener('pointerdown', function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var ratio = canvas.width / canvas.getBoundingClientRect().width;
      x += (e.clientX - lastX) * ratio; y += (e.clientY - lastY) * ratio;
      lastX = e.clientX; lastY = e.clientY; clamp(); draw();
    });
    canvas.addEventListener('pointerup', function () { dragging = false; });
    canvas.addEventListener('pointercancel', function () { dragging = false; });
    load(initialSrc);
    return { load: load, output: function () { return image.complete && image.naturalWidth ? canvas.toDataURL('image/jpeg', .84) : ''; } };
  }

  function applyAllStarSlot(slot) {
    var all = (STATE.allStar.aRoster || []).concat(STATE.allStar.bRoster || []);
    var current = STATE.allStar[picker.side + 'Roster'][picker.slot];
    var duplicate = all.some(function (s) { return s && s.pid === slot.pid && (!current || s.pid !== current.pid); });
    if (duplicate) { openConfirm('已在阵容中', '同一选手不能在双方重复上场。', null, '知道了'); return; }
    var roster = STATE.allStar[picker.side + 'Roster'].slice();
    while (roster.length < 5) roster.push(null);
    roster[picker.slot] = slot; STATE.allStar[picker.side + 'Roster'] = roster;
    D.loadSeasons([slot.sid]).then(function () { saveState(); renderAllStar(); closePicker(); })
      .catch(function () { saveState(); renderAllStar(); closePicker(); });
  }

  function confirmAllStarPicker() {
    if (!picker.pid || !picker.sid) return;
    applyAllStarSlot({ pid: picker.pid, sid: picker.sid, teamFid: picker.teamFid });
  }

  /* 模拟页：按曲名选择对局 BGM */
  function showTrackPicker() {
    $('picker-title').textContent = '选择对局音乐';
    $('picker-sub').textContent = '点击曲目立即切换';
    var names = BGM.getTrackNames() || [];
    var cur = BGM.getTrackIndex();
    $('picker-ver').innerHTML = '';
    $('picker-pool').innerHTML = names.map(function (n, i) {
      var playing = i === cur;
      return '<button class="pool-item' + (playing ? ' sel' : '') + '" data-i="' + i + '">' +
        '<div class="ava" style="background:linear-gradient(135deg,#f0b90b,#ff7b3d)">♪</div>' +
        '<div><div class="pname">' + esc(n) + '</div>' +
        '<div class="pver">' + (playing ? '正在播放' : '点击切换') + '</div></div>' +
        '<div class="prate">' + (playing ? '▶' : '›') + '</div></button>';
    }).join('');
    $('picker-pool').querySelectorAll('.pool-item').forEach(function (el) {
      el.addEventListener('click', function () {
        BGM.playTrack(parseInt(el.getAttribute('data-i'), 10));
        $('sim-track-btn').textContent = '🎵 ' + (BGM.getTrackName() || '');
        closePicker();
      });
    });
    $('picker-confirm').style.display = 'none';
    $('drawer').classList.add('show');
    $('drawer-mask').classList.add('show');
  }

  /* 模拟中"更换阵容"：先选要换的位置 */
  function showPosPicker() {
    $('picker-title').textContent = '更换阵容 · 选择位置';
    $('picker-sub').innerHTML = teamBadgeHtml(STATE.team) + ' <span>' + esc(teamName(STATE.team)) + '</span>';
    $('picker-ver').innerHTML = '';
    $('picker-pool').innerHTML = POS_ORDER.map(function (pos, i) {
      var slot = STATE.roster[i];
      var name = slot ? playerName(slot.pid) : '空位';
      var ava = slot ? esc(playerName(slot.pid)[0]) : '+';
      return '<button class="pool-item" data-i="' + i + '">' +
        '<div class="ava">' + ava + '</div>' +
        '<div><div class="pname">' + esc(pos) + '</div>' +
        '<div class="pver">当前：' + esc(name) + '</div></div>' +
        '<div class="prate">›</div></button>';
    }).join('');
    $('picker-pool').querySelectorAll('.pool-item').forEach(function (el) {
      el.addEventListener('click', function () {
        openPicker(parseInt(el.getAttribute('data-i'), 10));
      });
    });
    $('drawer').classList.add('show');
    $('drawer-mask').classList.add('show');
  }

  /* ================= 战场 ================= */
  function showSeason() {
    showPage('season');
    BGM.play('intro');
    $('season-team-name').textContent = STATE.team
      ? (teamName(STATE.team) + ' · ' + STATE.roster.map(function (s) { return playerName(s.pid); }).join('、'))
      : '未组队';
    renderTacticPickers();
    renderSeasonList();
  }

  function renderSeasonList() {
    var byYear = {};
    DATA.manifest.seasons.forEach(function (s) {
      var y = s.year || 0;
      (byYear[y] = byYear[y] || []).push(s);
    });
    var years = Object.keys(byYear).sort(function (a, b) { return b - a; });
    var curYear = null;
    DATA.manifest.seasons.forEach(function (s) {
      if (s.season_id === STATE.season) curYear = s.year;
    });
    var html = years.map(function (y) {
      var items = byYear[y].map(function (s) {
        var sel = s.season_id === STATE.season ? ' sel' : '';
        var tags = [];
        tags.push(s.source === 'kpl' ? 'KPL' : (s.source === 'kcc' ? '挑战者杯' : '杯赛'));
        if (s.has_regular) tags.push('常规赛');
        if (s.playoff_type === 'double_elim') tags.push('双败');
        else if (s.playoff_type === 'single_elim') tags.push('单败');
        return '<button class="season-item' + sel + '" data-sid="' + s.season_id + '">' +
          '<div><div class="si-name">' + esc(s.name) + '</div>' +
          '<div class="si-tags">' + tags.map(function (t) { return '<span class="tag-pill">' + t + '</span>'; }).join('') + '</div></div>' +
          '<div class="si-go">›</div></button>';
      }).join('');
      var open = String(curYear) === String(y);
      return '<div class="season-group" data-year="' + y + '">' +
        '<button class="sg-year' + (open ? ' open' : '') + '" data-year="' + y + '">' +
        '<span class="sg-label">' + y + ' 年</span>' +
        '<span class="sg-arrow">' + (open ? '▾' : '▸') + '</span></button>' +
        '<div class="sg-items"' + (open ? '' : ' style="display:none"') + '>' + items + '</div></div>';
    }).join('');
    $('season-list').innerHTML = html;
    // 年份手风琴：默认只显示年份，点击展开/收起，一次只开一个
    $('season-list').querySelectorAll('.sg-year').forEach(function (el) {
      el.addEventListener('click', function () {
        var items = el.parentNode.querySelector('.sg-items');
        var wasOpen = items.style.display !== 'none';
        $('season-list').querySelectorAll('.season-group').forEach(function (g) {
          var gi = g.querySelector('.sg-items');
          if (gi) gi.style.display = 'none';
          var gy = g.querySelector('.sg-year');
          if (gy) gy.classList.remove('open');
        });
        if (!wasOpen) {
          items.style.display = 'block';
          el.classList.add('open');
        }
      });
    });
    $('season-list').querySelectorAll('.season-item').forEach(function (el) {
      el.addEventListener('click', function () {
        STATE.season = el.getAttribute('data-sid');
        saveState();
        renderSeasonList();
      });
    });
    var canGo = !!(STATE.season && STATE.team && STATE.roster.length);
    $('season-go').disabled = !canGo;
  }

  /* ================= 模拟 ================= */
  /* 分阶段模拟：逐局 reveal，每轮后可换人 */
  var SIM = { session: null, stageNo: 0, path: [], queue: [], timer: null, seasonName: '', jump: false, tree: [], rosterChanged: false };

  function showSim() {
    showPage('sim');
    BGM.play('battle');
    $('sim-track-btn').textContent = '🎵 ' + (BGM.getTrackName() || '');
    $('sim-progress-fill').style.width = '0%';
    $('sim-events').innerHTML = '';
    $('sim-skip').style.display = '';
    $('sim-sub').style.display = 'none';
    $('sim-goon').style.display = 'none';
    $('sim-next').style.display = 'none';
    $('sim-done-tip').style.display = 'none';
    SIM.queue = [];
    if (SIM.timer) { clearInterval(SIM.timer); SIM.timer = null; }
    SIM.tree = [];
    SIM.rosterChanged = false;
    if (STATE.mode === 'allstar') startAllStarSimulation();
    else startSimulation();
  }

  function startSimulation() {
    if (!STATE.season || !STATE.team || !STATE.roster.length) {
      go('#/season');
      return;
    }
    $('sim-events').innerHTML = '<div class="story-event show" id="sim-loading"><div class="se-title">📡 正在生成平行时空</div>' +
      '<div class="se-line mut">赛程与选手数据已就绪，马上开赛…</div></div>';
    var battleSid = STATE.season;
    var rosterSids = STATE.roster.map(function (s) { return s.sid; }).filter(Boolean);
    var sids = [battleSid].concat(rosterSids).filter(function (v, i, a) { return a.indexOf(v) === i; });
    D.loadSeasons(sids).then(function () {
      var battle = DATA.seasonCache[battleSid];
      var rosters = {};
      battle.rosters.forEach(function (r) {
        if ((r.games || 0) < 5) return;
        (rosters[r.team_franchise] = rosters[r.team_franchise] || []).push(r);
      });
      Object.keys(rosters).forEach(function (fid) {
        rosters[fid].sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
      });
      var override = {};
      var recs = recordsForRoster(STATE.roster);
      if (recs.length) override[STATE.team] = recs;
      if (!STATE.seed) STATE.seed = Math.floor(Math.random() * 100000);
      var formats = {};
      formats[battleSid] = battle;
      SIM.session = E.createSession({
        season_id: battleSid, formats: formats, rosters: rosters, rng: E.makeRng(STATE.seed),
        names: DATA.names, tpl: DATA.tpl, chem: D.buildChemFor(sids),
        override_rosters: override, track: STATE.team, players: DATA.players, tactic: STATE.tactic
      });
      SIM.stageNo = 0;
      SIM.path = [];
      SIM.seasonName = battle.name;
      var loading = $('sim-loading');
      if (loading) loading.remove();
      if (shareVersionNotice) {
        appendCard({ title: '版本提示', lines: [shareVersionNotice], cls: 'reg' });
        shareVersionNotice = '';
      }
      renderOpeningTree();
      advance();
    }).catch(function (e) {
      $('sim-events').innerHTML = '<div class="card red">模拟失败：' + esc(e.message) + '</div>';
    });
  }

  function startAllStarSimulation() {
    var aSlots = STATE.allStar.aRoster || [], bSlots = STATE.allStar.bRoster || [];
    if (aSlots.length !== 5 || bSlots.length !== 5) { go('#/allstar'); return; }
    $('sim-events').innerHTML = '<div class="story-event show" id="sim-loading"><div class="se-title">📡 正在生成全明星对决</div>' +
      '<div class="se-line mut">双方阵容与历史版本已就绪，马上开赛…</div></div>';
    var slots = aSlots.concat(bSlots), sids = slots.map(function (s) { return s.sid; });
    D.loadSeasons(sids).then(function () {
      var rng = E.makeRng(STATE.seed || Math.floor(Math.random() * 100000));
      if (!STATE.seed) STATE.seed = Math.floor(Math.random() * 100000);
      rng = E.makeRng(STATE.seed);
      var aSource = allStarRecords('a', true), bSource = allStarRecords('b', true);
      var chem = D.buildChemFor(sids);
      var strengths = {
        ALLSTAR_A: E.lineupStrength(aSource, chem, E.COMPRESS)[0],
        ALLSTAR_B: E.lineupStrength(bSource, chem, E.COMPRESS)[0]
      };
      var aRecords = allStarRecords('a', false), bRecords = allStarRecords('b', false);
      var result = E.playMatch(rng, strengths, 'ALLSTAR_A', 'ALLSTAR_B', STATE.allStar.bo, STATE.tactic);
      var aName = teamName(STATE.allStar.aTeam) + '联队';
      var bName = teamName(STATE.allStar.bTeam) + '联队';
      var pnames = {};
      slots.forEach(function (slot) { pnames[slot.pid] = playerName(slot.pid); });
      var teamNames = { ALLSTAR_A: aName, ALLSTAR_B: bName };
      var games = E.narrateSeries(rng, DATA.tpl, aName, bName, result[3], aRecords, bRecords, pnames, STATE.allStar.bo, 2026, teamNames);
      var rawStats = E.simMatchStats(rng, aRecords, bRecords, result[3]);
      var runStats = allStarRunStats(rawStats, aRecords, bRecords, result[3]);
      var entry = {
        round: '全明星对决', opp: bName, score: result[1] + ':' + result[2], win: result[0] === 'ALLSTAR_A',
        games: games, results: result[3], stats: runStats
      };
      STATE.lastRun = {
        mode: 'allstar', champion: result[0], team: 'ALLSTAR_A', season: null, seed: STATE.seed,
        version: buildVersion(), tactic: STATE.tactic,
        seasonName: 'BO' + STATE.allStar.bo + ' 全明星对决', score: result[1] + ':' + result[2],
        aName: aName, bName: bName, aTeam: STATE.allStar.aTeam, bTeam: STATE.allStar.bTeam,
        aRoster: aSlots.slice(), bRoster: bSlots.slice(), aRecords: aRecords, bRecords: bRecords,
        records: aRecords.concat(bRecords), runStats: runStats, path: [entry], tree: [], regular: {}
      };
      saveState(); saveAllStarHistory();
      SIM.session = { isDone: function () { return true; }, getChampion: function () { return result[0]; } };
      SIM.path = [];
      SIM.seasonName = STATE.lastRun.seasonName;
      var loading = $('sim-loading'); if (loading) loading.remove();
      if (shareVersionNotice) {
        appendCard({ title: '版本提示', lines: [shareVersionNotice], cls: 'reg' });
        shareVersionNotice = '';
      }
      appendEntryCard(entry, '全明星对决');
      $('sim-progress-fill').style.width = '100%';
      pumpReveal();
    }).catch(function (e) {
      $('sim-events').innerHTML = '<div class="card red">模拟失败：' + esc(e.message) + '</div>';
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
    var run = JSON.parse(JSON.stringify(STATE.lastRun));
    run.path = run.path.map(function (p) { return { round: p.round, opp: p.opp, score: p.score, win: p.win, placement: p.placement, results: p.results }; });
    var hist = loadHistory();
    hist.unshift({
      mode: 'allstar', teamName: STATE.lastRun.aName + ' vs ' + STATE.lastRun.bName,
      seasonName: STATE.lastRun.seasonName, savedAt: Date.now(),
      champ: true, banner: STATE.lastRun.score,
      rosterNames: STATE.lastRun.records.map(function (r) { return playerName(r.player_id); }),
      allStar: compactAllStarState(STATE.allStar), seed: STATE.seed, lastRun: run
    });
    saveHistory(hist);
  }

  function advance() {
    var stage = SIM.session.next();
    SIM.stageNo += 1;
    $('sim-progress-fill').style.width = Math.min(96, SIM.stageNo * 2) + '%';
    if (stage.kind === 'done') {
      finishSim(stage.champion);
      return;
    }
    if (stage.kind === 'regular_recap') {
      appendCard({ title: stage.title, lines: stage.lines, cls: 'reg' });
      // 说明卡（如"32强战罢"）也同步赛程图：内部消化的场次一次性补齐
      if (SIM.session && SIM.session.getTree) renderTreeCard(SIM.session.getTree(), stage.title);
      // 由"继续征战"触发的说明卡：滚动到新卡顶部（绝不回到页面最顶端）
      if (SIM.jump) {
        SIM.jump = false;
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
    if (SIM.session && SIM.session.getTree) renderTreeCard(SIM.session.getTree(), stage.title);
    // reveal 期间隐藏轮间按钮，避免在文字播放中误点"继续征战"
    $('sim-goon').style.display = 'none';
    $('sim-sub').style.display = 'none';
    pumpReveal();
    if (SIM.jump) {
      SIM.jump = false;
      setTimeout(scrollToLatestCard, 30);
    }
  }

  /* 滚动到最新一张比赛/说明卡的顶部（继续征战后的目标位置） */
  function scrollToLatestCard() {
    var cards = $('sim-events').querySelectorAll('.story-event');
    if (cards.length) {
      var el = cards[cards.length - 1];
      var top = el.getBoundingClientRect().top + window.pageYOffset - 8;
      window.scrollTo({ top: top, behavior: 'smooth' });
    }
  }

  function seriesContext(stageTitle) {
    var lines = ['经理指令：' + tacticName(STATE.tactic) + '。' +
      ({ stable: '先稳住阵型与资源交换，把胜负交给纸面实力。', balanced: '按标准节奏寻找机会，临场应变优先。', gamble: '主动提速争抢前期窗口，接受更高的赛果波动。' }[STATE.tactic] || '')];
    var title = String(stageTitle || '');
    if (title.indexOf('总决赛') >= 0 || title === '决赛') lines.push('所有悬念都收敛到这一场，下一座水晶决定奖杯归属。');
    else if (title.indexOf('败者组') >= 0) lines.push('败者组没有回头路，任何一次失误都可能让整个赛季停在这里。');
    else if (title.indexOf('半决赛') >= 0 || title.indexOf('淘汰') >= 0) lines.push('比赛进入淘汰区间，阵容上限之外，更考验谁先顶住压力。');
    var streak = 0;
    for (var i = SIM.path.length - 1; i >= 0 && SIM.path[i].win; i--) streak++;
    if (streak >= 2) lines.push('此前已经连胜' + streak + '轮，气势正在成为第六名队员。');
    if (SIM.rosterChanged) {
      lines.push('阵容刚刚完成调整，新五人组能否立刻形成默契，是这一轮最大的变量。');
      SIM.rosterChanged = false;
    }
    return lines.join('<br>');
  }

  function appendEntryCard(entry, stageTitle) {
    var context = seriesContext(stageTitle);
    SIM.path.push(entry);
    var el = document.createElement('div');
    el.className = 'story-event';
    el.innerHTML = '<div class="se-title">' + stageIcon(stageTitle) + ' ' + esc(stageTitle) + ' · vs ' + esc(entry.opp) +
      ' <span class="score-pill ' + (entry.win ? 'win' : 'lose') + '">' + esc(entry.score) + ' ' + (entry.win ? '胜' : '负') + '</span></div>' +
      '<div class="se-context">' + context + '</div>';
    $('sim-events').appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    entry.games.forEach(function (g, gi) {
      var fn = function () {
        var gd = document.createElement('div');
        gd.className = 'se-game';
        var activeSlots = STATE.mode === 'allstar'
          ? STATE.allStar.aRoster.concat(STATE.allStar.bRoster)
          : STATE.roster;
        gd.innerHTML = gameHtml(g, activeSlots.map(function (s) { return playerName(s.pid); }));
        el.appendChild(gd);
      };
      if (gi === 0) fn();
      else SIM.queue.push(fn);
    });
  }

  /* ---------- 赛程图：谁干掉了谁、主队走到哪 ---------- */
  function renderOpeningTree() {
    var battle = DATA.seasonCache[STATE.season];
    if (!battle) return;
    // 找第一个有官方对阵的轮次（小组赛/首轮/32强等）做开局图
    var firstRound = null;
    (battle.rounds || []).forEach(function (r) {
      if (!firstRound && r.matches && r.matches.length) firstRound = r;
    });
    var title = firstRound ? (firstRound.name || '首轮对阵') : '参赛队伍';
    var html = '<div class="card tree-card" id="sim-tree-card">' +
      '<div class="tc-head">🗺️ ' + esc(battle.name || STATE.season) + ' · ' + esc(title) + '</div>';
    if (firstRound) {
      html += '<div class="tc-round">揭幕对阵</div>';
      var shown = 0;
      (firstRound.matches || []).forEach(function (m) {
        if (!m.a_id || !m.b_id) return;
        var selfA = m.a_id === STATE.team, selfB = m.b_id === STATE.team;
        if (!selfA && !selfB && shown >= 16) return; // 非主队对阵最多展示 16 场
        shown++;
        var aCls = selfA ? ' tc-self' : '';
        var bCls = selfB ? ' tc-self' : '';
        html += '<div class="tc-match"><span class="tc-team' + aCls + '">' + esc(teamName(m.a_id)) + '</span>' +
          '<span class="tc-score">vs</span>' +
          '<span class="tc-team' + bCls + '">' + esc(teamName(m.b_id)) + '</span></div>';
      });
      if (firstRound.matches.length > shown) html += '<div class="tc-more">… 其余对阵开赛后揭晓</div>';
    } else {
      var seenTeams = {};
      (DATA.seasonCache[STATE.season].rosters || []).forEach(function (r) {
        if (r.team_franchise) seenTeams[r.team_franchise] = true;
      });
      var uniq = Object.keys(seenTeams);
      html += '<div class="tc-teams">' + uniq.map(function (fid) {
        return '<span class="tc-team-chip' + (fid === STATE.team ? ' sel' : '') + '">' + esc(teamName(fid)) + '</span>';
      }).join('') + '</div>';
    }
    html += '<div class="tc-tip">你的战队已就位，赛程图将随每一战更新</div></div>';
    var old = $('sim-tree-card');
    if (old) old.remove();
    var el = document.createElement('div');
    el.innerHTML = html;
    $('sim-events').appendChild(el.firstChild);
  }

  function renderTreeCard(tree, title) {
    var old = $('sim-tree-card');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'card tree-card';
    el.id = 'sim-tree-card';
    el.innerHTML = treeCardHtml(tree, title, false, true);
    $('sim-events').appendChild(el);
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
    var ko = groups.filter(function (g) { return BRACKET_EXPECT[g.round]; });
    var first = ko.length ? ko[0] : null;
    var chain = first ? MAIN_CHAINS[first.round] : null;
    var main, loser;
    if (chain) {
      main = chain.map(function (r) {
        return ko.find(function (g) { return g.round === r; }) || { round: r, matches: [] };
      });
      var lc = LOSER_CHAINS[first.round];
      loser = lc ? lc.map(function (r) {
        return ko.find(function (g) { return g.round === r; }) || { round: r, matches: [] };
      }) : ko.filter(function (g) { return /败者组/.test(g.round); });
    } else {
      main = ko.filter(function (g) { return !/败者组/.test(g.round); });
      loser = ko.filter(function (g) { return /败者组/.test(g.round); });
    }
    var html = showHead
      ? '<div class="tc-head">🗺️ 赛程图' + (title ? ' · ' + esc(title) : '') + '</div>'
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
      html += '<div class="tc-round">' + esc(g.round) + '</div>';
      html += '<div class="tc-grid">';
      g.matches.forEach(function (m) {
        var na = teamName(m.a), nb = teamName(m.b);
        var winnerIsA = m.w === m.a;
        var trackIn = m.a === STATE.team || m.b === STATE.team;
        var trackWon = m.w === STATE.team;
        var cls = trackIn ? (trackWon ? ' tc-track tc-win' : ' tc-track tc-loss') : '';
        var aCls = (m.a === STATE.team ? ' tc-self' : (winnerIsA ? ' tc-win' : ''));
        var bCls = (m.b === STATE.team ? ' tc-self' : (!winnerIsA ? ' tc-win' : ''));
        html += '<div class="tc-match' + cls + '"><span class="tc-team' + aCls + '">' +
          teamAvaHtml(m.a, abbrOf(m.a)) + '<span class="tc-tn">' + esc(na) + '</span></span>' +
          '<span class="tc-score">' + m.sa + ' : ' + m.sb + '</span>' +
          '<span class="tc-team' + bCls + '">' +
          teamAvaHtml(m.b, abbrOf(m.b)) + '<span class="tc-tn">' + esc(nb) + '</span></span></div>';
      });
      html += '</div>';
    });
    return html;
  }

  /* 各淘汰赛轮次的期望框数（用于补"待定"空位，凑出完整树） */
  var BRACKET_EXPECT = {
    '32强': 16, '16强': 8, '8强': 4, '4强': 2, '半决赛': 2, '总决赛': 1,
    '胜者组第1轮': 4, '胜者组第2轮': 2, '胜者组半决赛': 2, '胜者组决赛': 1,
    '败者组第1轮': 2, '败者组第2轮': 2, '败者组第3轮': 1, '败者组第4轮': 1,
    '败者组第5轮': 1, '败者组半决赛': 1, '败者组决赛': 1,
    '败者组第一轮': 2, '败者组第二轮': 2, '败者组第三轮': 2,
    '败者组第四轮': 1, '败者组第五轮': 1
  };

  /* 各赛制的主链/败者组链（按首轮名匹配，用于补全未打轮次的空框） */
  var MAIN_CHAINS = {
    '32强': ['32强', '16强', '胜者组第1轮', '胜者组第2轮', '胜者组决赛', '总决赛'],
    '16强': ['16强', '胜者组第1轮', '胜者组第2轮', '胜者组决赛', '总决赛'],
    '胜者组第1轮': ['胜者组第1轮', '胜者组第2轮', '胜者组决赛', '总决赛'],
    '胜者组半决赛': ['胜者组半决赛', '胜者组决赛', '总决赛'],
    '8强': ['8强', '半决赛', '总决赛'],
    '半决赛': ['半决赛', '总决赛'],
    '胜者组决赛': ['胜者组决赛', '总决赛']
  };
  var LOSER_CHAINS = {
    '32强': ['败者组第1轮', '败者组第2轮', '败者组第3轮', '败者组决赛'],
    '16强': ['败者组第1轮', '败者组第2轮', '败者组第3轮', '败者组决赛'],
    '胜者组第1轮': ['败者组第1轮', '败者组第2轮', '败者组第3轮', '败者组决赛'],
    '胜者组半决赛': ['败者组第一轮', '败者组第二轮', '败者组第三轮', '败者组半决赛', '败者组决赛']
  };

  /* 画一列组的标准淘汰树（首列在最左，胜者向右衍生；连线 floor(i/2)） */
  function bracketColumns(cols, cls, compact) {
    var COL_W = compact ? 150 : 176;
    var GAP = compact ? 18 : 34;
    var BOX_H = compact ? 46 : 50;
    var ROW_H = compact ? 50 : 55;
    var firstN = cols.length ? Math.max(cols[0].matches.length, BRACKET_EXPECT[cols[0].round] || cols[0].matches.length) : 1;
    var H = Math.max(200, firstN * ROW_H);
    var totalW = cols.length * (COL_W + GAP) + 10;
    var lines = [];
    var boxes = '';
    cols.forEach(function (g, c) {
      var n = Math.max(g.matches.length, BRACKET_EXPECT[g.round] || g.matches.length);
      var x = c * (COL_W + GAP); // 首列在最左，胜者向右衍生
      boxes += '<div class="bk-round-label" style="left:' + x + 'px;top:-20px">' + esc(g.round) + '</div>';
      for (var i = 0; i < n; i++) {
        var m = g.matches[i];
        var y = (i + 0.5) * (H / n) - BOX_H / 2;
        var clsB = 'bk-match';
        var inner, isSelf = false, won = false, lost = false;
        if (m) {
          var na = teamName(m.a), nb = teamName(m.b);
          var ab = abbrOf(m.a), bb = abbrOf(m.b);
          var winnerIsA = m.w === m.a;
          var score = m.sa + ':' + m.sb;
          // 左侧两队（带对标，上下排列），右侧比分：胜者绿加粗、败者灰，主队所在框金色
          inner = '<div class="bk-teams">' +
            '<div class="bk-row' + (winnerIsA ? ' bk-win' : '') + '" title="' + esc(na) + '">' +
              teamAvaHtml(m.a, ab) + '<span class="bk-tname">' + esc(ab) + '</span></div>' +
            '<div class="bk-row' + (!winnerIsA ? ' bk-win' : '') + '" title="' + esc(nb) + '">' +
              teamAvaHtml(m.b, bb) + '<span class="bk-tname">' + esc(bb) + '</span></div>' +
            '</div><div class="bk-score">' + esc(score) + '</div>';
          isSelf = m.w === STATE.team;
          lost = !isSelf && (m.a === STATE.team || m.b === STATE.team);
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
          var nextN = Math.max(cols[c + 1].matches.length, BRACKET_EXPECT[cols[c + 1].round] || cols[c + 1].matches.length);
          var j = Math.min(Math.floor(i / 2), nextN - 1);
          var x1 = x + COL_W;
          var y1 = y + BOX_H / 2;
          var x2 = x + COL_W + GAP;
          var y2 = (j + 0.5) * (H / nextN);
          var midX = x + COL_W + GAP / 2;
          lines.push('<path d="M ' + x1 + ' ' + y1 + ' H ' + midX + ' V ' + y2 + ' H ' + x2 + '" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.4"/>');
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
      if (mm.a === STATE.team || mm.b === STATE.team) { lastTrack = mm; break; }
    }
    if (!lastTrack) return '';
    return lastTrack.w === STATE.team
      ? '<div class="tc-status ok">✅ ' + esc(teamName(STATE.team)) + ' 晋级下一轮</div>'
      : '<div class="tc-status bad">❌ ' + esc(teamName(STATE.team)) + ' 止步' + esc(lastTrack.round) + '</div>';
  }

  function appendCard(ev) {
    var cls = ev.cls === 'reg' ? ' reg' : (ev.cls === 'final' ? ' final' : '');
    var lines = (ev.lines || []).map(function (l) {
      return '<div class="se-line">' + esc(l).replace(/\n/g, '<br>') + '</div>';
    }).join('');
    var el = document.createElement('div');
    el.className = 'story-event' + cls;
    el.innerHTML = '<div class="se-title">' + esc(ev.title) + '</div>' + lines;
    $('sim-events').appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
  }

  function pumpReveal() {
    if (SIM.timer) return;
    SIM.timer = setInterval(function () {
      if (!SIM.queue.length) {
        clearInterval(SIM.timer);
        SIM.timer = null;
        if (SIM.session && SIM.session.isDone && SIM.session.isDone()) {
          // 整个赛季的最后一把打完：滚动到最后一场文字，显示"结束征战"，由玩家点击进入战绩卡
          var cards = $('sim-events').querySelectorAll('.story-event');
          if (cards.length) {
            var el = cards[cards.length - 1];
            var top = el.getBoundingClientRect().top + window.pageYOffset - 8;
            window.scrollTo({ top: top, behavior: 'smooth' });
          }
          $('sim-skip').style.display = 'none';
          $('sim-sub').style.display = 'none';
          $('sim-goon').style.display = 'none';
          $('sim-next').style.display = '';
          return;
        }
        showStageButtons();
        return;
      }
      SIM.queue.shift()();
    }, 700);
  }

  function scrollBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
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
    var lines = esc(g).split('\n');
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
    $('sim-skip').style.display = '';
    $('sim-sub').style.display = '';
    $('sim-goon').style.display = '';
  }

  function skipAll() {
    if (SIM.timer) { clearInterval(SIM.timer); SIM.timer = null; }
    while (SIM.queue.length) SIM.queue.shift()();
    if (STATE.mode === 'allstar') { go('#/result'); return; }
    SIM.jump = false;
    var guard = 0;
    while (guard++ < 500) {
      var stage = SIM.session.next();
      SIM.stageNo += 1;
      if (stage.kind === 'done') {
        finishSim(stage.champion);
        go('#/result');
        return;
      }
      if (stage.kind === 'regular_recap') continue;
      (stage.entries || []).forEach(function (entry) { SIM.path.push(entry); });
    }
    go('#/result');
  }

  var confirmCb = null;
  function openConfirm(title, body, onOk, okText) {
    $('cf-title').textContent = title;
    $('cf-body').textContent = body;
    $('cf-ok').textContent = okText || '确定';
    confirmCb = onOk || null;
    $('confirm-mask').classList.add('show');
    $('confirm-box').classList.add('show');
  }
  function closeConfirm() {
    confirmCb = null;
    $('confirm-mask').classList.remove('show');
    $('confirm-box').classList.remove('show');
  }

  function finishSim(championId) {
    var championName = championId ? teamName(championId) : null;
    var isChamp = championName === teamName(STATE.team);
    // 本次征战选手数据：由逐场统计汇总（场次/击杀/死亡/助攻/MVP/参团/胜率）
    var runStats = {};
    var trackPids = {};
    STATE.roster.forEach(function (slot) {
      trackPids[slot.pid] = true;
      runStats[slot.pid] = { games: 0, k: 0, d: 0, a: 0, mvp: 0 };
    });
    var teamKills = 0, runWins = 0, runMatches = SIM.path.length;
    SIM.path.forEach(function (p) {
      if (p.win) runWins++;
      var st = p.stats || {};
      Object.keys(st).forEach(function (pid) {
        if (!trackPids[pid]) return;
        var s = runStats[pid], t = st[pid];
        s.games += t.games; s.k += t.k; s.d += t.d; s.a += t.a; s.mvp += t.mvp;
      });
    });
    Object.keys(runStats).forEach(function (pid) { teamKills += runStats[pid].k; });
    Object.keys(runStats).forEach(function (pid) {
      var s = runStats[pid];
      s.kda = s.d ? (s.k + s.a) / s.d : (s.k + s.a);
      s.avgK = s.games ? s.k / s.games : 0;
      s.avgD = s.games ? s.d / s.games : 0;
      s.avgA = s.games ? s.a / s.games : 0;
      s.participation = teamKills ? (s.k + s.a) / teamKills : 0;
      s.winRate = runMatches ? runWins / runMatches : 0;
    });
    // MVP 保底：胜利场次足够时，全程 0 MVP 的选手按胜场规模补 1-3 次，
    // 避免"打得不错但一次 MVP 都没有"；胜场太少不补
    if (runWins >= 3) {
      var bonus = runWins >= 12 ? 3 : (runWins >= 8 ? 2 : 1);
      Object.keys(runStats).forEach(function (pid) {
        var s = runStats[pid];
        if (s.mvp === 0 && s.games >= Math.max(3, Math.round(runMatches * 0.4))) {
          s.mvp = Math.min(bonus, Math.max(1, Math.round(runWins / 3)));
        }
      });
    }
    STATE.lastRun = {
      champion: championId, team: STATE.team, season: STATE.season, seed: STATE.seed,
      version: buildVersion(), tactic: STATE.tactic,
      path: SIM.path, regular: SIM.session ? SIM.session.getRegular() : {},
      tree: SIM.session && SIM.session.getTree ? SIM.session.getTree() : [],
      rosterNames: STATE.roster.map(function (s) { return playerName(s.pid); }),
      records: recordsForRoster(STATE.roster), seasonName: SIM.seasonName,
      runStats: runStats
    };
    saveState();
    // 写入首页历史战绩（精简 path 体积，只保留战绩卡需要的字段）
    var runForHistory = JSON.parse(JSON.stringify(STATE.lastRun));
    runForHistory.path = (runForHistory.path || []).map(function (p) {
      return { round: p.round, opp: p.opp, score: p.score, win: p.win, placement: p.placement, results: p.results };
    });
    var hBanner = isChamp ? '🏆 冠军'
      : (SIM.path.length && String(SIM.path[SIM.path.length - 1].round).indexOf('决赛') >= 0 ? '亚军'
        : '止步·' + runPlacement({ path: SIM.path }));
    var hist = loadHistory();
    hist.unshift({
      team: STATE.team, teamName: teamName(STATE.team), season: STATE.season, seasonName: SIM.seasonName,
      seed: STATE.seed, savedAt: Date.now(), champ: isChamp, banner: hBanner,
      roster: STATE.roster.slice(),
      rosterNames: STATE.roster.map(function (s) { return playerName(s.pid); }),
      lastRun: runForHistory
    });
    saveHistory(hist);
    $('sim-skip').style.display = 'none';
    $('sim-sub').style.display = 'none';
    $('sim-goon').style.display = 'none';
    $('sim-next').style.display = '';
    $('sim-done-tip').style.display = '';
    if (isChamp) {
      var sl = teamSlogan(championName || '');
      $('sim-done-tip').textContent = sl ? ('🏆 捧杯时刻：' + sl + '！') : '🏆 捧杯时刻！';
      $('sim-done-tip').classList.add('champ');
      BGM.play('champion', championName);
    } else {
      $('sim-done-tip').textContent = '赛季落幕';
      $('sim-done-tip').classList.remove('champ');
    }
    $('sim-progress-fill').style.width = '100%';
  }

  /* ================= 结算 ================= */
  function placeText(roundName) {
    var n = String(roundName || '');
    if (n.indexOf('32强') >= 0) return '32强';
    if (n.indexOf('16强') >= 0) return '16强';
    if (n.indexOf('8强') >= 0) return '8强';
    if (n.indexOf('双败') >= 0 || n.indexOf('淘汰') >= 0) return '8强';
    // 胜者组/败者组是 engine 生成的双败轮次名，联赛不一定是 8 强阶段，不再硬猜强次
    if (n.indexOf('胜者组') >= 0 || n.indexOf('败者组') >= 0) return '季后赛';
    if (n.indexOf('半决赛') >= 0) return '4强';
    if (n.indexOf('决赛') >= 0 || n.indexOf('总决赛') >= 0) return '2强';
    return '淘汰赛';
  }

  function runPlacement(run) {
    var last = run && run.path && run.path.length ? run.path[run.path.length - 1] : null;
    return (last && last.placement) || placeText(last ? last.round : '');
  }

  function scoreParts(score) {
    var parts = String(score || '').split(':').map(Number);
    return parts.length === 2 && parts.every(function (n) { return Number.isFinite(n); }) ? parts : [0, 0];
  }

  function comebackTag(results, winnerToken) {
    var a = 0, b = 0, maxDeficit = 0;
    (results || []).forEach(function (token) {
      if (token === 'A') a++; else b++;
      maxDeficit = Math.max(maxDeficit, winnerToken === 'A' ? b - a : a - b);
    });
    var winnerScore = winnerToken === 'A' ? a : b;
    var loserScore = winnerToken === 'A' ? b : a;
    if (winnerScore === 3 && loserScore === 2 && maxDeficit >= 2) return '让二追三';
    if (winnerScore === 4 && loserScore === 3 && maxDeficit >= 3) return '让三追四';
    return maxDeficit >= 2 ? '逆风翻盘' : '';
  }

  function achievementTags(run) {
    var tags = [], path = run.path || [], isAllStar = run.mode === 'allstar';
    function add(tag) { if (tag && tags.indexOf(tag) < 0) tags.push(tag); }
    path.forEach(function (entry) {
      var score = scoreParts(entry.score);
      var winnerToken = isAllStar
        ? (run.champion === 'ALLSTAR_A' ? 'A' : 'B')
        : (entry.win ? 'A' : 'B');
      if ((isAllStar && Math.min(score[0], score[1]) === 0) || (!isAllStar && entry.win && score[1] === 0)) {
        add(isAllStar ? '零封胜出' : '零封晋级');
      }
      if (Math.abs(score[0] - score[1]) === 1 && Math.min(score[0], score[1]) >= 1) add('决胜局绝杀');
      add(comebackTag(entry.results, winnerToken));
    });
    if (!isAllStar && run.champion && teamName(run.champion) === teamName(run.team)) {
      if (path.length && path.every(function (entry) { return entry.win; })) add('全胜夺冠');
      var loserWins = path.filter(function (entry) { return entry.win && String(entry.round).indexOf('败者组') >= 0; }).length;
      if (loserWins >= 2) add('败者组一穿' + loserWins);
    }
    return tags.slice(0, 4);
  }

  function renderAchievements(run) {
    $('result-achievements').innerHTML = achievementTags(run).map(function (tag) {
      return '<span class="achievement-tag">' + esc(tag) + '</span>';
    }).join('');
  }

  function showResult() {
    showPage('result');
    var run = STATE.lastRun;
    if (!run) {
      loadState();
      run = STATE.lastRun;
    }
    if (!run) { go('#/'); return; }
    if (run.mode === 'allstar') { showAllStarResult(run); return; }
    $('result-roster-title').textContent = '阵容';
    $('result-path-title').textContent = '赛程';
    $('result-stats-title').textContent = '选手数据';
    $('result-tree-card').style.display = '';
    $('result-share').style.display = '';
    $('share-tip').textContent = '长按页面可保存战绩图 · 分享链接可还原本场平行时空';
    if (run.champion && teamName(run.champion) === teamName(run.team)) {
      BGM.play('champion', teamName(run.team));
    }
    var team = teamName(run.team);
    var banner, cls;
    if (run.champion && teamName(run.champion) === team) {
      banner = '🏆 冠军'; cls = 'champ';
    } else if (run.path.length && String(run.path[run.path.length - 1].round).indexOf('决赛') >= 0) {
      banner = '亚军'; cls = 'runner';
    } else {
      banner = '赛季止步 · ' + runPlacement(run);
      cls = 'elim';
    }
    $('result-banner').className = 'res-banner ' + cls;
    $('result-banner').textContent = banner;
    renderAchievements(run);
    $('result-sub').textContent = run.seasonName + ' · ' + team + ' · ' + tacticName(run.tactic) + ' · 种子 ' + run.seed;
    if (run.champion && teamName(run.champion) === team) {
      var slogan = teamSlogan(team);
      $('result-slogan').style.display = slogan ? '' : 'none';
      $('result-slogan').textContent = slogan ? (slogan + '！') : '';
    } else {
      $('result-slogan').style.display = 'none';
    }

    // 旧历史数据可能存在同一选手重复记录（转分路/转会），按 pid 去重兜底
    var recs = [];
    var seenPid = {};
    (run.records || []).forEach(function (r) {
      if (r && r.player_id && !seenPid[r.player_id]) { seenPid[r.player_id] = true; recs.push(r); }
    });
    $('result-roster').innerHTML = recs.map(function (r) {
      var name = playerName(r.player_id);
      var icon = playerIcon(r.player_id);
      var rs = (run.runStats || {})[r.player_id];
      var ava = icon
        ? '<img class="pava" src="' + esc(icon) + '" onerror="this.outerHTML=&#39;<div class=&quot;pava&quot;>' + esc(name[0]) + '</div>&#39;">'
        : '<div class="pava">' + esc(name[0]) + '</div>';
      var kda = rs ? f1(rs.kda) : f1(r.avg_kda);
      var avgK = rs ? f1(rs.avgK) : f1(r.avg_kill_num);
      var part = rs ? pct(rs.participation) : pct(r.avg_participation_rate);
      var games = rs ? rs.games : (r.games || 0);
      var mvp = rs ? rs.mvp : (r.mvp_count || 0);
      return '<div class="result-pc">' + ava +
        '<div><div class="pnm">' + esc(name) + '<span class="ppos">' + esc(r.position) + '</span></div>' +
        '<div class="pstat">KDA ' + kda + ' · 场均击杀 ' + avgK + ' · 参团 ' + part + ' · ' + games + ' 场' + (mvp ? ' · MVP ' + mvp : '') + '</div></div></div>';
    }).join('');

    $('result-path').innerHTML = run.path.map(function (p) {
      return '<tr class="' + (p.win ? 'w' : 'l') + '"><td>' + esc(p.round) + '</td><td>' + esc(p.opp) + '</td>' +
        '<td>' + esc(p.score) + '</td><td class="tag">' + (p.win ? '胜' : '负') + '</td></tr>';
    }).join('');

    // 缩小版淘汰树（战绩卡）
    $('result-tree').innerHTML = (run.tree && run.tree.length)
      ? treeCardHtml(run.tree, '', true, false)
      : '<div class="tc-tip">本场征战无淘汰赛数据</div>';

    $('result-stats').innerHTML = recs.map(function (r) {
      var rs = (run.runStats || {})[r.player_id];
      var kda = rs ? f1(rs.kda) : f1(r.avg_kda);
      var avgK = rs ? f1(rs.avgK) : f1(r.avg_kill_num);
      var avgD = rs ? f1(rs.avgD) : f1(r.avg_death_num);
      var avgA = rs ? f1(rs.avgA) : f1(r.avg_assist_num);
      var part = rs ? pct(rs.participation) : pct(r.avg_participation_rate);
      var winRate = rs ? pct(rs.winRate) : pct(r.win_rate);
      var games = rs ? rs.games : (r.games || 0);
      var mvp = rs ? rs.mvp : (r.mvp_count || 0);
      return '<tr><td><b>' + esc(playerName(r.player_id)) + '</b><br><span class="mut">' + esc(r.position) + '</span></td>' +
        '<td>' + kda + '</td>' +
        '<td>' + avgK + ' / ' + avgD + ' / ' + avgA + '</td>' +
        '<td>' + part + '</td>' +
        '<td>' + pct(r.avg_hurt_to_hero_total_rate) + '</td>' +
        '<td>' + pct(r.avg_be_hurt_by_hero_total_rate) + '</td>' +
        '<td>' + Math.round(r.avg_gpm || 0) + '</td>' +
        '<td>' + f1(r.avg_damage_convert_rate) + '</td>' +
        '<td>' + f1(r.avg_push_tower_num) + '</td>' +
        '<td>' + winRate + '</td>' +
        '<td>' + games + '</td>' +
        '<td>' + (mvp || '-') + '</td></tr>';
    }).join('');
    requestAnimationFrame(function () { window.scrollTo({ top: 0 }); });
  }

  function showAllStarResult(run) {
    var winnerName = run.champion === 'ALLSTAR_A' ? run.aName : run.bName;
    BGM.play('champion', winnerName);
    $('result-banner').className = 'res-banner champ';
    $('result-banner').textContent = '🏆 ' + winnerName + ' 获胜 · ' + run.score;
    renderAchievements(run);
    $('result-sub').textContent = run.seasonName + ' · ' + tacticName(run.tactic) + ' · 种子 ' + run.seed;
    $('result-slogan').style.display = 'none';
    $('result-roster-title').textContent = '双方阵容';
    $('result-path-title').textContent = '对局';
    $('result-stats-title').textContent = '双方选手数据';
    $('result-tree-card').style.display = 'none';
    $('result-share').style.display = '';
    $('share-tip').textContent = allStarHasCustom(run)
      ? '可生成并下载战绩图 · 自定义选手仅保存在当前设备，无法生成还原链接'
      : '可下载战绩图 · 分享链接可还原双方阵容与本场种子';

    function rosterHtml(title, records) {
      return '<div class="allstar-result-side"><h3>' + esc(title) + '</h3>' + records.map(function (r) {
        var name = playerName(r.player_id), icon = playerIcon(r.player_id), rs = (run.runStats || {})[r.player_id];
        var ava = icon ? '<img class="pava" src="' + esc(icon) + '" onerror="this.outerHTML=&#39;<div class=&quot;pava&quot;>' + esc(name[0]) + '</div>&#39;">' : '<div class="pava">' + esc(name[0]) + '</div>';
        return '<div class="result-pc">' + ava + '<div><div class="pnm">' + esc(name) + '<span class="ppos">' + esc(r.position) + '</span></div>' +
          '<div class="pstat">KDA ' + f1(rs && rs.kda) + ' · 场均击杀 ' + f1(rs && rs.avgK) + ' · 参团 ' + pct(rs && rs.participation) + ' · ' + ((rs && rs.games) || 0) + ' 场' + ((rs && rs.mvp) ? ' · MVP ' + rs.mvp : '') + '</div></div></div>';
      }).join('') + '</div>';
    }
    $('result-roster').innerHTML = rosterHtml(run.aName, run.aRecords || []) + rosterHtml(run.bName, run.bRecords || []);
    $('result-path').innerHTML = '<tr class="w"><td>全明星对决</td><td>' + esc(run.aName + ' vs ' + run.bName) + '</td><td>' + esc(run.score) + '</td><td class="tag">' + esc(winnerName) + '</td></tr>';
    $('result-stats').innerHTML = (run.records || []).map(function (r) {
      var rs = (run.runStats || {})[r.player_id] || {};
      return '<tr><td><b>' + esc(playerName(r.player_id)) + '</b><br><span class="mut">' + esc(r.position) + '</span></td>' +
        '<td>' + f1(rs.kda) + '</td><td>' + f1(rs.avgK) + ' / ' + f1(rs.avgD) + ' / ' + f1(rs.avgA) + '</td>' +
        '<td>' + pct(rs.participation) + '</td><td>' + pct(r.avg_hurt_to_hero_total_rate) + '</td><td>' + pct(r.avg_be_hurt_by_hero_total_rate) + '</td>' +
        '<td>' + Math.round(r.avg_gpm || 0) + '</td><td>' + f1(r.avg_damage_convert_rate) + '</td><td>' + f1(r.avg_push_tower_num) + '</td>' +
        '<td>' + pct(rs.winRate) + '</td><td>' + (rs.games || 0) + '</td><td>' + (rs.mvp || '-') + '</td></tr>';
    }).join('');
    requestAnimationFrame(function () { window.scrollTo({ top: 0 }); });
  }

  function allStarHasCustom(run) {
    return ((run.aRoster || []).concat(run.bRoster || [])).some(function (slot) {
      return !!(slot && (slot.templatePid || String(slot.pid || '').indexOf('custom_') === 0));
    });
  }

  function packAllStarSlots(slots) {
    return (slots || []).map(function (slot) {
      return [slot.pid, slot.sid, slot.teamFid || ''].map(encodeURIComponent).join('@');
    }).join(',');
  }

  function shareLink() {
    var run = STATE.lastRun || {};
    if (run.mode === 'allstar') {
      if (allStarHasCustom(run)) return '';
      return location.href.split('#')[0] + '#/a?' +
        'at=' + encodeURIComponent(run.aTeam) + '&bt=' + encodeURIComponent(run.bTeam) +
        '&bo=' + encodeURIComponent(STATE.allStar.bo || 5) +
        '&ar=' + packAllStarSlots(run.aRoster) + '&br=' + packAllStarSlots(run.bRoster) +
        '&seed=' + encodeURIComponent(run.seed) + '&tc=' + encodeURIComponent(run.tactic || STATE.tactic) + '&v=' + encodeURIComponent(buildVersion());
    }
    var rosterStr = STATE.roster.map(function (s) { return s.pid + '@' + s.sid; }).join(',');
    var url = location.href.split('#')[0] + '#/s?' +
      't=' + encodeURIComponent(STATE.team) +
      '&s=' + encodeURIComponent(STATE.season) +
      '&r=' + encodeURIComponent(rosterStr) +
      '&seed=' + STATE.seed + '&tc=' + encodeURIComponent(run.tactic || STATE.tactic) +
      '&v=' + encodeURIComponent(buildVersion());
    return url;
  }

  function copyShare() {
    var url = shareLink();
    function done() {
      $('share-tip').textContent = '链接已复制，发给好友即可还原这场平行时空';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(function () { fallbackCopy(url, done); });
    } else {
      fallbackCopy(url, done);
    }
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    done();
  }

  /* ---------------- 战绩分享图（Canvas 手绘） ---------------- */
  function roundRectPath(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
  }

  function renderShareImage() {
    var run = STATE.lastRun;
    if (!run) return;
    var W = 1080, P = 64;
    var rows = Math.min(run.path.length, 8);
    var H = 400 + run.records.length * 108 + 90 + rows * 86 + 120;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var x = cv.getContext('2d');

    var g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1a2e'); g.addColorStop(1, '#123052');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#f0b90b'; x.lineWidth = 6;
    x.strokeRect(26, 26, W - 52, H - 52);

    var isAllStar = run.mode === 'allstar';
    var team = isAllStar ? (run.aName + ' vs ' + run.bName) : teamName(run.team);
    x.textAlign = 'center';
    x.fillStyle = '#f0b90b';
    x.font = '900 58px sans-serif';
    x.fillText('KPL 2K · 战绩卡', W / 2, 122);
    x.fillStyle = '#8fa8cc';
    x.font = '30px sans-serif';
    x.fillText(run.seasonName + ' · ' + team + ' · ' + tacticName(run.tactic) + ' · 种子 ' + run.seed, W / 2, 178);

    var banner, color, bg;
    if (isAllStar) {
      var allStarWinner = run.champion === 'ALLSTAR_A' ? run.aName : run.bName;
      banner = '🏆 ' + allStarWinner + '获胜 · ' + run.score; color = '#3fb950'; bg = 'rgba(63,185,80,.16)';
    } else if (run.champion && teamName(run.champion) === team) {
      banner = '🏆 冠军'; color = '#3fb950'; bg = 'rgba(63,185,80,.16)';
    } else if (run.path.length && String(run.path[run.path.length - 1].round).indexOf('决赛') >= 0) {
      banner = '亚军'; color = '#8fa8cc'; bg = 'rgba(143,168,204,.16)';
    } else {
      banner = '赛季止步 · ' + runPlacement(run);
      color = '#f85149'; bg = 'rgba(248,81,73,.16)';
    }
    roundRectPath(x, W / 2 - 270, 216, 540, 96, 18);
    x.fillStyle = bg; x.fill();
    x.strokeStyle = color; x.lineWidth = 3; x.stroke();
    x.fillStyle = color; x.font = '700 42px sans-serif';
    x.fillText(banner, W / 2, 278);

    var achievementText = achievementTags(run).join(' · ');
    if (achievementText) {
      x.fillStyle = '#ffe08a'; x.font = '700 25px sans-serif';
      x.fillText(achievementText, W / 2, 352);
    }

    var y = 400;
    x.textAlign = 'left';
    x.fillStyle = '#f0b90b'; x.font = '800 34px sans-serif';
    x.fillText(isAllStar ? '双方阵容' : '阵容', P, y); y += 18;
    run.records.forEach(function (r) {
      y += 90;
      x.fillStyle = '#e9f1fb'; x.font = '700 36px sans-serif';
      x.fillText(playerName(r.player_id), P, y);
      x.fillStyle = '#8fa8cc'; x.font = '28px sans-serif';
      var sideLabel = isAllStar ? (r.team_franchise === 'ALLSTAR_A' ? run.aName : run.bName) + ' · ' : '';
      x.fillText(sideLabel + r.position, P + 330, y);
      var rs = (run.runStats || {})[r.player_id];
      var kda = rs ? f1(rs.kda) : f1(r.avg_kda);
      var part = rs ? pct(rs.participation) : pct(r.avg_participation_rate);
      var mvp = rs ? rs.mvp : (r.mvp_count || 0);
      x.textAlign = 'right';
      x.fillStyle = '#f0b90b'; x.font = '600 28px sans-serif';
      x.fillText('KDA ' + kda + ' · 参团 ' + part + ' · MVP ' + mvp, W - P, y);
      x.textAlign = 'left';
    });

    y += 46;
    x.fillStyle = '#f0b90b'; x.font = '800 34px sans-serif';
    x.fillText('赛程', P, y); y += 16;
    run.path.slice(-rows).forEach(function (p) {
      y += 78;
      x.fillStyle = '#8fa8cc'; x.font = '28px sans-serif';
      x.fillText(p.round + ' vs ' + p.opp, P, y);
      x.textAlign = 'right';
      x.fillStyle = p.win ? '#3fb950' : '#f85149'; x.font = '700 28px sans-serif';
      x.fillText(p.score + ' ' + (p.win ? '胜' : '负'), W - P, y);
      x.textAlign = 'left';
    });

    x.textAlign = 'center';
    x.fillStyle = '#8fa8cc'; x.font = '28px sans-serif';
    x.fillText('民间算法 · 平行时空 · KPL 2K', W / 2, H - 66);

    $('share-img').src = cv.toDataURL('image/png');
    var canCopy = !!shareLink();
    $('share-copy').style.display = canCopy ? '' : 'none';
    $('share-copy').textContent = '复制链接';
    $('share-modal').querySelector('.sm-head').textContent = canCopy
      ? '长按图片保存，或下载后发到社群'
      : '自定义选手仅保存在当前设备，可下载本场战绩图';
    $('share-modal').classList.add('show');
    $('share-mask').classList.add('show');
  }

  function closeShareModal() {
    $('share-modal').classList.remove('show');
    $('share-mask').classList.remove('show');
  }

  function downloadShare() {
    var a = document.createElement('a');
    a.href = $('share-img').src;
    a.download = 'kpl2k-战绩卡.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ---------------- 入口 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initDisclaimer();
    initBGM();
    loadState();
    D.loadBase().then(function () {
      window.addEventListener('hashchange', router);
      // 绑定固定按钮
      $('btn-classic').addEventListener('click', function () {
        BGM.unlock();
        BGM.play('intro');
        STATE.mode = 'classic';
        go('#/team');
      });
      $('btn-quick').addEventListener('click', function () {
        BGM.unlock(); BGM.play('intro'); startQuickMatch();
      });
      $('btn-allstar').addEventListener('click', function () {
        BGM.unlock(); BGM.play('intro'); STATE.mode = 'allstar'; saveState(); go('#/allstar');
      });
      $('allstar-a-team').addEventListener('change', function () { changeAllStarTeam('a', this.value); });
      $('allstar-b-team').addEventListener('change', function () { changeAllStarTeam('b', this.value); });
      $('allstar-bo').querySelectorAll('button').forEach(function (el) {
        el.addEventListener('click', function () {
          STATE.allStar.bo = parseInt(el.getAttribute('data-bo'), 10); saveState(); renderAllStar();
        });
      });
      document.querySelectorAll('.tactic-picker button').forEach(function (el) {
        el.addEventListener('click', function () {
          STATE.tactic = el.getAttribute('data-tactic');
          saveState(); renderTacticPickers();
        });
      });
      $('allstar-start').addEventListener('click', function () {
        if (this.disabled) return;
        STATE.mode = 'allstar'; STATE.seed = Math.floor(Math.random() * 100000); saveState(); go('#/sim');
      });
      $('history-entry').addEventListener('click', function () { go('#/history'); });
      $('btn-confirm-team').addEventListener('click', function () { go('#/season'); });
      $('season-go').addEventListener('click', function () { go('#/sim'); });
      $('sim-skip').addEventListener('click', function () {
        openConfirm('一键跳转', '是否直接查看比赛结果？将跳过剩余赛程的文字，直接生成最终战绩。', skipAll, '直接查看');
      });
      $('sim-back').addEventListener('click', function () {
        openConfirm('返回首页', '当前模拟将中断，本次征战记录不会被保存。确定返回首页吗？', function () {
          if (SIM.timer) { clearInterval(SIM.timer); SIM.timer = null; }
          SIM.queue = [];
          go('#/');
        }, '直接返回');
      });
      $('cf-ok').addEventListener('click', function () {
        var cb = confirmCb;
        closeConfirm();
        if (cb) cb();
      });
      $('cf-cancel').addEventListener('click', closeConfirm);
      $('confirm-mask').addEventListener('click', closeConfirm);
      $('sim-sub').addEventListener('click', showPosPicker);
      $('sim-goon').addEventListener('click', function () {
        SIM.jump = true;
        // 延迟到下一帧再跑模拟+渲染，避免点击瞬间主线程阻塞造成音频卡顿
        setTimeout(function () { advance(); }, 30);
      });
      $('sim-next').addEventListener('click', function () {
        if (STATE.mode === 'allstar') { go('#/result'); return; }
        var champ = SIM.session && SIM.session.getChampion ? SIM.session.getChampion() : null;
        finishSim(champ);
        go('#/result');
      });
      $('result-again').addEventListener('click', function () {
        STATE.seed = Math.floor(Math.random() * 100000);
        saveState();
        go('#/sim');
      });
      $('result-reteam').addEventListener('click', function () {
        if (STATE.mode === 'allstar') { go('#/allstar'); return; }
        STATE.roster = [];
        saveState();
        go('#/team');
      });
      $('result-share').addEventListener('click', renderShareImage);
      $('share-close').addEventListener('click', closeShareModal);
      $('share-mask').addEventListener('click', closeShareModal);
      $('share-download').addEventListener('click', downloadShare);
      $('share-copy').addEventListener('click', function () {
        fallbackCopy(shareLink(), function () {
          $('share-copy').textContent = '已复制 ✓';
        });
      });
      $('drawer-mask').addEventListener('click', closePicker);
      $('picker-confirm').addEventListener('click', confirmPicker);
      $('picker-back').addEventListener('click', function () {
        if (picker.mode === 'allstar') renderAllStarPool(POS_ORDER[picker.slot], '');
        else renderPool(POS_ORDER[picker.slot]);
      });
      // BGM 控制
      $('bgm-toggle').addEventListener('click', toggleBgm);
      var homeToggle = $('bgm-toggle-home');
      if (homeToggle) homeToggle.addEventListener('click', function () {
        toggleBgm();
        var hint = $('music-hint');
        if (hint) hint.style.display = 'none';
      });
      $('sim-prev').addEventListener('click', function () {
        BGM.prevTrack();
        $('sim-track-btn').textContent = '🎵 ' + (BGM.getTrackName() || '');
      });
      $('sim-next-track').addEventListener('click', function () {
        BGM.nextTrack();
        $('sim-track-btn').textContent = '🎵 ' + (BGM.getTrackName() || '');
      });
      $('sim-track-btn').addEventListener('click', showTrackPicker);
      $('sim-bgm-toggle').addEventListener('click', toggleBgm);
      router();
    });
  });
})(window);
