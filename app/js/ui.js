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
    team: null,
    roster: [],          // [{pid, sid}] 5 槽
    season: null,
    seed: 0,
    dynasty: null,
    lastRun: null        // {champion, path, regular, events, rosterNames, records}
  };

  var picker = { open: false, slot: 0, pid: null, sid: null };

  /* ---------------- 状态持久化 ---------------- */
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        team: STATE.team, roster: STATE.roster, season: STATE.season, seed: STATE.seed,
        dynasty: STATE.dynasty,
        lastRun: STATE.lastRun
      }));
    } catch (e) { /* ignore */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      STATE.team = s.team || null;
      STATE.roster = s.roster || [];
      STATE.season = s.season || null;
      STATE.seed = s.seed || 0;
      STATE.dynasty = s.dynasty || null;
      STATE.lastRun = s.lastRun || null;
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
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 20))); } catch (e) { /* ignore */ }
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
    STATE.team = r.team;
    STATE.roster = r.roster || [];
    STATE.season = r.season;
    STATE.seed = r.seed;
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

  function playerName(pid) { return (DATA.players[pid] && DATA.players[pid].name) || pid; }
  function playerIcon(pid) { return (DATA.players[pid] && DATA.players[pid].icon) || ''; }

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
      if (rec) out.push(rec);
    });
    return out;
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
          '苏州KSG': 'assets/audio/淬炼小孩.m4a',
          '南通Hero久竞': 'assets/audio/HERO小孩.m4a',
          '深圳DYG': 'assets/audio/DYG小孩.m4a',
          '长沙TES.A': 'assets/audio/突然的陀螺小孩.m4a'
        }
      }
    });
    syncBgmToggles();
    document.addEventListener('click', function once() {
      BGM.unlock();
      var hint = $('music-hint');
      if (hint) hint.style.display = 'none';
      document.removeEventListener('click', once);
    }, { capture: true });
  }

  function championTrack(teamName) {
    var cfg = { default: 'assets/audio/无双的王者.m4a', byTeam: {
      '成都AG超玩会': 'assets/audio/红小孩.m4a',
      '重庆狼队': 'assets/audio/狼小孩.m4a',
      '武汉eStarPro': 'assets/audio/星小孩.m4a',
      '广州TTG': 'assets/audio/TT小孩.m4a',
      '苏州KSG': 'assets/audio/淬炼小孩.m4a',
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
    if (hash.indexOf('#/team') === 0) showTeam();
    else if (hash.indexOf('#/season') === 0) showSeason();
    else if (hash.indexOf('#/sim') === 0) showSim();
    else if (hash.indexOf('#/result') === 0) showResult();
    else if (hash.indexOf('#/history') === 0) showHistory();
    else showHome();
  }

  function applyShare(qs) {
    var params = new URLSearchParams(qs);
    var t = params.get('t'), s = params.get('s'), r = params.get('r'), seed = params.get('seed');
    var roster = [];
    (r || '').split(',').forEach(function (pair) {
      var parts = pair.split('@');
      if (parts.length === 2) roster.push({ pid: parts[0], sid: parts[1] });
    });
    if (t && roster.length) {
      STATE.team = t;
      STATE.roster = roster;
      STATE.season = s || null;
      STATE.seed = parseInt(seed || '0', 10) || 0;
      saveState();
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { /* ignore */ }
      var hit = cached && cached.lastRun &&
        cached.lastRun.team === t && cached.lastRun.seed === STATE.seed && cached.lastRun.season === STATE.season;
      location.hash = hit ? '#/result' : '#/sim';
    } else {
      location.hash = '#/';
    }
  }

  /* ---------------- 视图切换 ---------------- */
  function showPage(name) {
    ['home', 'team', 'season', 'sim', 'result', 'history'].forEach(function (p) {
      $(p).classList.toggle('active', p === name);
    });
    ['team-bar', 'season-bar', 'sim-bar', 'result-bar'].forEach(function (b) {
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
    if (DATA.manifest) {
      $('stat-line').innerHTML = '<b>' + DATA.manifest.teams2026.length + '</b> 支战队 · <b>' +
        DATA.manifest.seasons.length + '</b> 个赛季 · <b>' + Object.keys(DATA.players).length + '</b> 名选手';
    }
    renderHomeHistory();
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
        '<div class="tc-abbr">' + esc(t.abbr || t.name.slice(0, 2)) + '</div>' +
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
    $('picker-sub').textContent = teamName(STATE.team) + ' 历届' + pos;
    var candidates = currentTeamData.players.filter(function (p) {
      return p.versions.some(function (v) { return v.position === pos; });
    }).sort(function (a, b) {
      var ra = maxRatingFor(a, pos), rb = maxRatingFor(b, pos);
      return rb - ra;
    });
    $('picker-pool').innerHTML = candidates.map(function (p) {
      var best = bestVersionFor(p, pos);
      var ava = p.icon
        ? '<div class="ava"><img src="' + esc(p.icon) + '" onerror="this.parentNode.textContent=&#39;' + esc(p.name[0]) + '&#39;"></div>'
        : '<div class="ava">' + esc(p.name[0]) + '</div>';
      return '<button class="pool-item" data-pid="' + p.player_id + '">' + ava +
        '<div><div class="pname">' + esc(p.name) + '</div>' +
        '<div class="pver">' + esc(best.label) + ' · ' + esc(best.season_id) + '</div></div>' +
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
    if (!picker.pid || !picker.sid) { closePicker(); return; }
    var slot = picker.slot;
    STATE.roster = STATE.roster.slice();
    while (STATE.roster.length < POS_ORDER.length) STATE.roster.push(null);
    STATE.roster[slot] = { pid: picker.pid, sid: picker.sid };
    if (SIM.session) SIM.session.setRoster(STATE.team, recordsForRoster(STATE.roster));
    saveState();
    renderSlots();
    renderStrength();
    closePicker();
  }
  function closePicker() {
    picker.open = false;
    $('drawer').classList.remove('show');
    $('drawer-mask').classList.remove('show');
    $('picker-confirm').style.display = '';
    $('picker-pool').style.display = '';
    $('picker-back').style.display = 'none';
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
    $('picker-sub').textContent = teamName(STATE.team);
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
  var SIM = { session: null, stageNo: 0, path: [], queue: [], timer: null, seasonName: '', jump: false };

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
    startSimulation();
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
        override_rosters: override, track: STATE.team, players: DATA.players
      });
      SIM.stageNo = 0;
      SIM.path = [];
      SIM.seasonName = battle.name;
      var loading = $('sim-loading');
      if (loading) loading.remove();
      advance();
    }).catch(function (e) {
      $('sim-events').innerHTML = '<div class="card red">模拟失败：' + esc(e.message) + '</div>';
    });
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
      showStageButtons();
      return;  // 保留 SIM.jump，继续征战能跳到真正的赛程
    }
    if (!stage.entries.length) { advance(); return; }  // 主队无赛事的轮次自动跳过（保留 jump）
    stage.entries.forEach(function (entry) {
      appendEntryCard(entry, stage.title);
    });
    // reveal 期间隐藏轮间按钮，避免在文字播放中误点"继续征战"
    $('sim-goon').style.display = 'none';
    $('sim-sub').style.display = 'none';
    pumpReveal();
    if (SIM.jump) {
      SIM.jump = false;
      setTimeout(function () {
        var cards = $('sim-events').querySelectorAll('.story-event');
        if (cards.length) {
          var el = cards[cards.length - 1];
          var top = el.getBoundingClientRect().top + window.pageYOffset - 8;
          window.scrollTo({ top: top, behavior: 'smooth' });
        }
      }, 30);
    }
  }

  function appendEntryCard(entry, stageTitle) {
    SIM.path.push(entry);
    var el = document.createElement('div');
    el.className = 'story-event';
    el.innerHTML = '<div class="se-title">' + stageIcon(stageTitle) + ' ' + esc(stageTitle) + ' · vs ' + esc(entry.opp) +
      ' <span class="score-pill ' + (entry.win ? 'win' : 'lose') + '">' + esc(entry.score) + ' ' + (entry.win ? '胜' : '负') + '</span></div>';
    $('sim-events').appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    entry.games.forEach(function (g, gi) {
      var fn = function () {
        var gd = document.createElement('div');
        gd.className = 'se-game';
        gd.innerHTML = gameHtml(g, STATE.roster.map(function (s) { return playerName(s.pid); }));
        el.appendChild(gd);
      };
      if (gi === 0) fn();
      else SIM.queue.push(fn);
    });
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
      ['BP', '开局', '中期', '结束'].forEach(function (t) {
        if (tag === null && line.indexOf(t + '：') === 0) tag = t;
      });
      if (tag) {
        var txt = line.slice(tag.length + 1);
        var segs = txt.split('；').filter(function (s) { return s.trim(); });
        var cls = tag === 'BP' ? 'bp' : (tag === '开局' ? 'open' : (tag === '中期' ? 'mid' : 'end'));
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
    STATE.lastRun = {
      champion: championId, team: STATE.team, season: STATE.season, seed: STATE.seed,
      path: SIM.path, regular: SIM.session ? SIM.session.getRegular() : {},
      rosterNames: STATE.roster.map(function (s) { return playerName(s.pid); }),
      records: recordsForRoster(STATE.roster), seasonName: SIM.seasonName,
      runStats: runStats
    };
    saveState();
    // 写入首页历史战绩（精简 path 体积，只保留战绩卡需要的字段）
    var runForHistory = JSON.parse(JSON.stringify(STATE.lastRun));
    runForHistory.path = (runForHistory.path || []).map(function (p) {
      return { round: p.round, opp: p.opp, score: p.score, win: p.win, results: p.results };
    });
    var hBanner = isChamp ? '🏆 冠军'
      : (SIM.path.length && String(SIM.path[SIM.path.length - 1].round).indexOf('决赛') >= 0 ? '亚军'
        : '止步·' + placeText(SIM.path.length ? SIM.path[SIM.path.length - 1].round : ''));
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

  function showResult() {
    showPage('result');
    var run = STATE.lastRun;
    if (!run) {
      loadState();
      run = STATE.lastRun;
    }
    if (!run) { go('#/'); return; }
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
      banner = '赛季止步 · ' + placeText(run.path.length ? run.path[run.path.length - 1].round : '');
      cls = 'elim';
    }
    $('result-banner').className = 'res-banner ' + cls;
    $('result-banner').textContent = banner;
    $('result-sub').textContent = run.seasonName + ' · ' + team + ' · 种子 ' + run.seed;
    if (run.champion && teamName(run.champion) === team) {
      var slogan = teamSlogan(team);
      $('result-slogan').style.display = slogan ? '' : 'none';
      $('result-slogan').textContent = slogan ? (slogan + '！') : '';
    } else {
      $('result-slogan').style.display = 'none';
    }

    $('result-roster').innerHTML = run.records.map(function (r) {
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

    $('result-stats').innerHTML = run.records.map(function (r) {
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

  function shareLink() {
    var rosterStr = STATE.roster.map(function (s) { return s.pid + '@' + s.sid; }).join(',');
    var url = location.href.split('#')[0] + '#/s?' +
      't=' + encodeURIComponent(STATE.team) +
      '&s=' + encodeURIComponent(STATE.season) +
      '&r=' + encodeURIComponent(rosterStr) +
      '&seed=' + STATE.seed;
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

    var team = teamName(run.team);
    x.textAlign = 'center';
    x.fillStyle = '#f0b90b';
    x.font = '900 58px sans-serif';
    x.fillText('KPL 2K · 战绩卡', W / 2, 122);
    x.fillStyle = '#8fa8cc';
    x.font = '30px sans-serif';
    x.fillText(run.seasonName + ' · ' + team + ' · 种子 ' + run.seed, W / 2, 178);

    var banner, color, bg;
    if (run.champion && teamName(run.champion) === team) {
      banner = '🏆 冠军'; color = '#3fb950'; bg = 'rgba(63,185,80,.16)';
    } else if (run.path.length && String(run.path[run.path.length - 1].round).indexOf('决赛') >= 0) {
      banner = '亚军'; color = '#8fa8cc'; bg = 'rgba(143,168,204,.16)';
    } else {
      banner = '赛季止步 · ' + placeText(run.path.length ? run.path[run.path.length - 1].round : '');
      color = '#f85149'; bg = 'rgba(248,81,73,.16)';
    }
    roundRectPath(x, W / 2 - 270, 216, 540, 96, 18);
    x.fillStyle = bg; x.fill();
    x.strokeStyle = color; x.lineWidth = 3; x.stroke();
    x.fillStyle = color; x.font = '700 42px sans-serif';
    x.fillText(banner, W / 2, 278);

    var y = 400;
    x.textAlign = 'left';
    x.fillStyle = '#f0b90b'; x.font = '800 34px sans-serif';
    x.fillText('阵容', P, y); y += 18;
    run.records.forEach(function (r) {
      y += 90;
      x.fillStyle = '#e9f1fb'; x.font = '700 36px sans-serif';
      x.fillText(playerName(r.player_id), P, y);
      x.fillStyle = '#8fa8cc'; x.font = '28px sans-serif';
      x.fillText(r.position, P + 330, y);
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
        go('#/team');
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
        renderPool(POS_ORDER[picker.slot]);
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
