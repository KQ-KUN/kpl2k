/* KPL 2K SPA 主逻辑：路由 / 组队 / 战场 / 模拟 / 结算 / 分享 */
(function (global) {
  'use strict';

  var E = KPL_ENGINE, N = KPL_NARRATIVE, D = KPL_DATA, DATA = D.DATA;
  var STATE_KEY = 'kpl2k_state_v1';
  var POS_ORDER = ['对抗路', '打野', '中路', '发育路', '游走'];
  var PRESET_SEASONS = ['KPL2026S2', 'KPL2026S1']; // 2026 现役首发优先取最新

  var STATE = {
    team: null,
    roster: [],          // [{pid, sid}] 5 槽
    season: null,
    seed: 0,
    lastRun: null        // {champion, path, regular, events, rosterNames, records}
  };

  var picker = { open: false, slot: 0, pid: null, sid: null };

  /* ---------------- 状态持久化 ---------------- */
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        team: STATE.team, roster: STATE.roster, season: STATE.season, seed: STATE.seed,
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
  function pct(v) { return (v == null || isNaN(v)) ? '-' : (Math.round(v * 1000) / 10) + '%'; }
  function go(hash) { location.hash = hash; }

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
          '苏州KSG': 'assets/audio/KSG小孩.m4a',
          '南通Hero久竞': 'assets/audio/HERO小孩.m4a',
          '深圳DYG': 'assets/audio/DYG小孩.m4a',
          '长沙TES.A': 'assets/audio/突然的陀螺小孩.m4a'
        }
      }
    });
    document.addEventListener('click', function once() {
      BGM.unlock();
      document.removeEventListener('click', once);
    }, { capture: true });
  }

  function championTrack(teamName) {
    var cfg = { default: 'assets/audio/无双的王者.m4a', byTeam: {
      '成都AG超玩会': 'assets/audio/红小孩.m4a',
      '重庆狼队': 'assets/audio/狼小孩.m4a',
      '武汉eStarPro': 'assets/audio/星小孩.m4a',
      '广州TTG': 'assets/audio/TT小孩.m4a',
      '苏州KSG': 'assets/audio/KSG小孩.m4a',
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
    ['home', 'team', 'season', 'sim', 'result'].forEach(function (p) {
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
  }

  /* ================= 组队 ================= */
  var currentTeamData = null;

  function showTeam() {
    showPage('team');
    BGM.play('intro');
    if (!STATE.team && DATA.manifest.teams2026.length) {
      STATE.team = DATA.manifest.teams2026[0].id;
    }
    renderTeamStrip();
    loadTeamView(STATE.team);
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
        }
        saveState();
        renderTeamStrip();
        loadTeamView(STATE.team);
      });
    });
  }

  function loadTeamView(fid) {
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
        p.versions.forEach(function (v) { if (v.season_id === sid) ver = v; });
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
        var rating = info.rec ? info.rec.rating : (info.ver ? info.ver.rating : null);
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
    var pctFill = Math.max(6, Math.min(100, (eff - 40) / 40 * 100));
    $('strength-num').textContent = eff.toFixed(1);
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
    var pos = POS_ORDER[slotIdx];
    $('picker-title').textContent = pos + ' · 换人';
    D.loadTeam(STATE.team).then(function (data) {
      currentTeamData = data;
      $('picker-sub').textContent = teamName(STATE.team) + ' 历届' + pos;
      var candidates = currentTeamData.players.filter(function (p) {
        return p.versions.some(function (v) { return v.position === pos; });
      }).sort(function (a, b) {
        var ra = maxRatingFor(a, pos), rb = maxRatingFor(b, pos);
        return rb - ra;
      });
      $('picker-ver').innerHTML = '';
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
      $('drawer').classList.add('show');
      $('drawer-mask').classList.add('show');
    }).catch(function () {
      closePicker();
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
    $('picker-ver').innerHTML = vers.map(function (v) {
      var sel = v.season_id === picker.sid ? ' sel' : '';
      return '<button class="vchip' + sel + '" data-sid="' + v.season_id + '">' +
        esc(v.label) + ' · ' + Math.round(v.rating) + '</button>';
    }).join('');
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
    var byYear = {};
    DATA.manifest.seasons.forEach(function (s) {
      var y = s.year || 0;
      (byYear[y] = byYear[y] || []).push(s);
    });
    var years = Object.keys(byYear).sort(function (a, b) { return b - a; });
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
      return '<div class="season-group"><div class="sg-year">' + y + ' 年</div>' + items + '</div>';
    }).join('');
    $('season-list').innerHTML = html;
    $('season-list').querySelectorAll('.season-item').forEach(function (el) {
      el.addEventListener('click', function () {
        STATE.season = el.getAttribute('data-sid');
        saveState();
        showSeason();
      });
    });
    var canGo = !!(STATE.season && STATE.team && STATE.roster.length);
    $('season-go').disabled = !canGo;
  }

  /* ================= 模拟 ================= */
  /* 分阶段模拟：逐局 reveal，每轮后可换人 */
  var SIM = { session: null, stageNo: 0, path: [], queue: [], timer: null, seasonName: '' };

  function showSim() {
    showPage('sim');
    BGM.play('battle');
    $('sim-track').textContent = BGM.getTrackName() || '';
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
      return;
    }
    if (!stage.entries.length) { advance(); return; }  // 主队无赛事的轮次自动跳过
    stage.entries.forEach(function (entry) {
      appendEntryCard(entry, stage.title);
    });
    pumpReveal();
  }

  function appendEntryCard(entry, stageTitle) {
    SIM.path.push(entry);
    var el = document.createElement('div');
    el.className = 'story-event';
    el.innerHTML = '<div class="se-title">' + stageIcon(stageTitle) + ' ' + esc(stageTitle) + ' · vs ' + esc(entry.opp) +
      ' <span class="score-pill ' + (entry.win ? 'win' : 'lose') + '">' + esc(entry.score) + ' ' + (entry.win ? '胜' : '负') + '</span></div>';
    $('sim-events').appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); scrollBottom(); });
    entry.games.forEach(function (g, gi) {
      var fn = function () {
        var gd = document.createElement('div');
        gd.className = 'se-game';
        gd.innerHTML = gameHtml(g, STATE.roster.map(function (s) { return playerName(s.pid); }));
        el.appendChild(gd);
        scrollBottom();
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
    requestAnimationFrame(function () { el.classList.add('show'); scrollBottom(); });
  }

  function pumpReveal() {
    if (SIM.timer) return;
    SIM.timer = setInterval(function () {
      if (!SIM.queue.length) {
        clearInterval(SIM.timer);
        SIM.timer = null;
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

  function skipStage() {
    if (SIM.timer) { clearInterval(SIM.timer); SIM.timer = null; }
    while (SIM.queue.length) SIM.queue.shift()();
    showStageButtons();
  }

  function finishSim(championId) {
    var championName = championId ? teamName(championId) : null;
    var isChamp = championName === teamName(STATE.team);
    STATE.lastRun = {
      champion: championId, team: STATE.team, season: STATE.season, seed: STATE.seed,
      path: SIM.path, regular: SIM.session ? SIM.session.getRegular() : {},
      rosterNames: STATE.roster.map(function (s) { return playerName(s.pid); }),
      records: recordsForRoster(STATE.roster), seasonName: SIM.seasonName
    };
    saveState();
    $('sim-skip').style.display = 'none';
    $('sim-sub').style.display = 'none';
    $('sim-goon').style.display = 'none';
    $('sim-next').style.display = '';
    $('sim-done-tip').style.display = '';
    if (isChamp) {
      $('sim-done-tip').textContent = '🏆 捧杯时刻！';
      BGM.play('champion', championName);
    } else {
      $('sim-done-tip').textContent = '赛季落幕';
    }
    $('sim-progress-fill').style.width = '100%';
  }

  /* ================= 结算 ================= */
  function placeText(roundName) {
    var n = String(roundName || '');
    if (n.indexOf('32强') >= 0) return '32强';
    if (n.indexOf('16强') >= 0) return '16强';
    if (n.indexOf('8强') >= 0) return '8强';
    if (n.indexOf('双败') >= 0 || n.indexOf('淘汰') >= 0 || n.indexOf('胜者组') >= 0 || n.indexOf('败者组') >= 0) return '8强';
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

    $('result-roster').innerHTML = run.records.map(function (r) {
      var name = playerName(r.player_id);
      var icon = playerIcon(r.player_id);
      var ava = icon
        ? '<img class="pava" src="' + esc(icon) + '" onerror="this.outerHTML=&#39;<div class=&quot;pava&quot;>' + esc(name[0]) + '</div>&#39;">'
        : '<div class="pava">' + esc(name[0]) + '</div>';
      var mvp = r.mvp_count ? ' · MVP ' + r.mvp_count : '';
      return '<div class="pc">' + ava +
        '<div><div class="pnm">' + esc(name) + '<span class="ppos">' + esc(r.position) + '</span></div>' +
        '<div class="pstat">KDA ' + f1(r.avg_kda) + ' · 场均击杀 ' + f1(r.avg_kill_num) + ' · 参团 ' + pct(r.avg_participation_rate) + ' · ' + (r.games || 0) + ' 场' + mvp + '</div></div></div>';
    }).join('');

    $('result-path').innerHTML = run.path.map(function (p) {
      return '<tr class="' + (p.win ? 'w' : 'l') + '"><td>' + esc(p.round) + '</td><td>' + esc(p.opp) + '</td>' +
        '<td>' + esc(p.score) + '</td><td class="tag">' + (p.win ? '胜' : '负') + '</td></tr>';
    }).join('');

    $('result-stats').innerHTML = run.records.map(function (r) {
      return '<tr><td>' + esc(playerName(r.player_id)) + '</td><td>' + f1(r.avg_kda) + '</td>' +
        '<td>' + f1(r.avg_kill_num) + '/' + f1(r.avg_death_num) + '/' + f1(r.avg_assist_num) + '</td>' +
        '<td>' + pct(r.avg_participation_rate) + '</td>' +
        '<td>' + pct(r.avg_hurt_to_hero_total_rate) + ' / ' + pct(r.avg_be_hurt_by_hero_total_rate) + '</td>' +
        '<td>' + (r.mvp_count || '-') + '</td></tr>';
    }).join('');
  }

  function shareLink() {
    var rosterStr = STATE.roster.map(function (s) { return s.pid + '@' + s.sid; }).join(',');
    var url = location.origin + location.pathname + '#/s?' +
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

  /* ---------------- 入口 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initBGM();
    loadState();
    D.loadBase().then(function () {
      window.addEventListener('hashchange', router);
      // 绑定固定按钮
      $('btn-classic').addEventListener('click', function () { go('#/team'); });
      $('btn-confirm-team').addEventListener('click', function () { go('#/season'); });
      $('season-go').addEventListener('click', function () { go('#/sim'); });
      $('sim-skip').addEventListener('click', skipStage);
      $('sim-sub').addEventListener('click', showPosPicker);
      $('sim-goon').addEventListener('click', advance);
      $('sim-next').addEventListener('click', function () { go('#/result'); });
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
      $('result-share').addEventListener('click', copyShare);
      $('drawer-mask').addEventListener('click', closePicker);
      $('picker-confirm').addEventListener('click', confirmPicker);
      // BGM 控制
      $('bgm-toggle').addEventListener('click', function () {
        BGM.setMuted(!BGM.isMuted());
        $('bgm-toggle').textContent = BGM.isMuted() ? '🔇' : '🔊';
      });
      $('sim-prev').addEventListener('click', function () {
        BGM.prevTrack();
        $('sim-track').textContent = BGM.getTrackName() || '';
      });
      $('sim-next-track').addEventListener('click', function () {
        BGM.nextTrack();
        $('sim-track').textContent = BGM.getTrackName() || '';
      });
      router();
    });
  });
})(window);
