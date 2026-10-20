/* KPL 2K SPA 主逻辑：路由 / 组队 / 战场 / 模拟 / 结算 / 分享 */
(function (global) {
  'use strict';
  // One coordinator owns mutable session state. Features receive explicit lazy callbacks.
  var uiContext={
    get $(){return $;},set $(value){$=value;},
    get ACHIEVEMENT_KEY(){return ACHIEVEMENT_KEY;},set ACHIEVEMENT_KEY(value){ACHIEVEMENT_KEY=value;},
    get BRACKET_EXPECT(){return BRACKET_EXPECT;},set BRACKET_EXPECT(value){BRACKET_EXPECT=value;},
    get BUDGET_PLAYER_BOOST(){return BUDGET_PLAYER_BOOST;},set BUDGET_PLAYER_BOOST(value){BUDGET_PLAYER_BOOST=value;},
    get D(){return D;},set D(value){D=value;},
    get DATA(){return DATA;},set DATA(value){DATA=value;},
    get E(){return E;},set E(value){E=value;},
    get HISTORY_KEY(){return HISTORY_KEY;},set HISTORY_KEY(value){HISTORY_KEY=value;},
    get LOSER_CHAINS(){return LOSER_CHAINS;},set LOSER_CHAINS(value){LOSER_CHAINS=value;},
    get MAIN_CHAINS(){return MAIN_CHAINS;},set MAIN_CHAINS(value){MAIN_CHAINS=value;},
    get POS_ORDER(){return POS_ORDER;},set POS_ORDER(value){POS_ORDER=value;},
    get PRESET_SEASONS(){return PRESET_SEASONS;},set PRESET_SEASONS(value){PRESET_SEASONS=value;},
    get SIM(){return SIM;},set SIM(value){SIM=value;},
    get STATE(){return STATE;},set STATE(value){STATE=value;},
    get STATE_KEY(){return STATE_KEY;},set STATE_KEY(value){STATE_KEY=value;},
    get abbrOf(){return abbrOf;},set abbrOf(value){abbrOf=value;},
    get achievementTags(){return achievementTags;},set achievementTags(value){achievementTags=value;},
    get achievementToastTimer(){return achievementToastTimer;},set achievementToastTimer(value){achievementToastTimer=value;},
    get activeDynasty(){return activeDynasty;},set activeDynasty(value){activeDynasty=value;},
    get activePage(){return activePage;},set activePage(value){activePage=value;},
    get allStarHasCustom(){return allStarHasCustom;},set allStarHasCustom(value){allStarHasCustom=value;},
    get allStarRecords(){return allStarRecords;},set allStarRecords(value){allStarRecords=value;},
    get buildVersion(){return buildVersion;},set buildVersion(value){buildVersion=value;},
    get closePicker(){return closePicker;},set closePicker(value){closePicker=value;},
    get closeShareModal(){return closeShareModal;},set closeShareModal(value){closeShareModal=value;},
    get compactAllStarState(){return compactAllStarState;},set compactAllStarState(value){compactAllStarState=value;},
    get confirmCb(){return confirmCb;},set confirmCb(value){confirmCb=value;},
    get currentTeamData(){return currentTeamData;},set currentTeamData(value){currentTeamData=value;},
    get dynastyStoryLine(){return dynastyStoryLine;},set dynastyStoryLine(value){dynastyStoryLine=value;},
    get esc(){return esc;},set esc(value){esc=value;},
    get f1(){return f1;},set f1(value){f1=value;},
    get finishSim(){return finishSim;},set finishSim(value){finishSim=value;},
    get go(){return go;},set go(value){go=value;},
    get loadHistory(){return loadHistory;},set loadHistory(value){loadHistory=value;},
    get openConfirm(){return openConfirm;},set openConfirm(value){openConfirm=value;},
    get pct(){return pct;},set pct(value){pct=value;},
    get picker(){return picker;},set picker(value){picker=value;},
    get playerAvatarHtml(){return playerAvatarHtml;},set playerAvatarHtml(value){playerAvatarHtml=value;},
    get playerIcon(){return playerIcon;},set playerIcon(value){playerIcon=value;},
    get playerName(){return playerName;},set playerName(value){playerName=value;},
    get recordAchievementEvent(){return recordAchievementEvent;},set recordAchievementEvent(value){recordAchievementEvent=value;},
    get recordAchievementRun(){return recordAchievementRun;},set recordAchievementRun(value){recordAchievementRun=value;},
    get recordsForRoster(){return recordsForRoster;},set recordsForRoster(value){recordsForRoster=value;},
    get renderTacticPickers(){return renderTacticPickers;},set renderTacticPickers(value){renderTacticPickers=value;},
    get runPlacement(){return runPlacement;},set runPlacement(value){runPlacement=value;},
    get saveHistory(){return saveHistory;},set saveHistory(value){saveHistory=value;},
    get saveState(){return saveState;},set saveState(value){saveState=value;},
    get scoreParts(){return scoreParts;},set scoreParts(value){scoreParts=value;},
    get scrollBehavior(){return scrollBehavior;},set scrollBehavior(value){scrollBehavior=value;},
    get shareImagePending(){return shareImagePending;},set shareImagePending(value){shareImagePending=value;},
    get shareVersionNotice(){return shareVersionNotice;},set shareVersionNotice(value){shareVersionNotice=value;},
    get showAchievements(){return showAchievements;},set showAchievements(value){showAchievements=value;},
    get showAllStar(){return showAllStar;},set showAllStar(value){showAllStar=value;},
    get showBudget(){return showBudget;},set showBudget(value){showBudget=value;},
    get showHistory(){return showHistory;},set showHistory(value){showHistory=value;},
    get showHome(){return showHome;},set showHome(value){showHome=value;},
    get showPage(){return showPage;},set showPage(value){showPage=value;},
    get showResult(){return showResult;},set showResult(value){showResult=value;},
    get showSeason(){return showSeason;},set showSeason(value){showSeason=value;},
    get showSim(){return showSim;},set showSim(value){showSim=value;},
    get showStorageWarning(){return showStorageWarning;},set showStorageWarning(value){showStorageWarning=value;},
    get showTeam(){return showTeam;},set showTeam(value){showTeam=value;},
    get storageWarningTimer(){return storageWarningTimer;},set storageWarningTimer(value){storageWarningTimer=value;},
    get strengthForRoster(){return strengthForRoster;},set strengthForRoster(value){strengthForRoster=value;},
    get strengthOf(){return strengthOf;},set strengthOf(value){strengthOf=value;},
    get tacticName(){return tacticName;},set tacticName(value){tacticName=value;},
    get teamAvaHtml(){return teamAvaHtml;},set teamAvaHtml(value){teamAvaHtml=value;},
    get teamBadgeHtml(){return teamBadgeHtml;},set teamBadgeHtml(value){teamBadgeHtml=value;},
    get teamName(){return teamName;},set teamName(value){teamName=value;},
    get teamViewRequest(){return teamViewRequest;},set teamViewRequest(value){teamViewRequest=value;}
  };


  var E = KPL_ENGINE, N = KPL_NARRATIVE, D = KPL_DATA, DATA = D.DATA;
  var STATE_KEY = 'kpl2k_state_v1';
  var DISCLAIMER_KEY = 'kpl2k_disclaimer_v1';
  var HISTORY_KEY = 'kpl2k_history_v1';
  var ACHIEVEMENT_KEY = 'kpl2k_achievements_v1';
  var POS_ORDER = ['对抗路', '打野', '中路', '发育路', '游走'];
  var PRESET_SEASONS = ['KPL2026S2', 'KPL2026S1']; // 2026 现役首发优先取最新
  // 金币模式把部分固定加成转为可通过历史搭档触发的阵容奖励。
  var BUDGET_PLAYER_BOOST = 5.0;

  var STATE = {
    mode: 'classic',
    budgetTotal: null,
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
  var achievementToastTimer = null;
  var shareVersionNotice = '';

  /* ---------------- 状态持久化 ---------------- */

  var storageModule=global.KPL_UI_MODULES.storage(uiContext);
  var showStorageWarning=storageModule.showStorageWarning,
      mergeCustomPlayers=storageModule.mergeCustomPlayers,
      compactAllStarState=storageModule.compactAllStarState,
      normalizeAllStarState=storageModule.normalizeAllStarState,
      saveState=storageModule.saveState,
      loadState=storageModule.loadState,
      loadHistory=storageModule.loadHistory,
      saveHistory=storageModule.saveHistory,
      fmtTime=storageModule.fmtTime,
      renderHomeHistory=storageModule.renderHomeHistory,
      teamSlogan=storageModule.teamSlogan,
      showHistory=storageModule.showHistory,
      restoreHistory=storageModule.restoreHistory;
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
  function scrollBehavior() {
    return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }
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
      mask.classList.add('show');
    });
    $('dc-agree').addEventListener('click', function () {
      try { localStorage.setItem(DISCLAIMER_KEY, '1'); } catch (e) { /* ignore */ }
      $('dc-hint').style.display = 'none';
      mask.classList.remove('show');
    });
    $('dc-refuse').addEventListener('click', function () {
      $('dc-hint').style.display = 'block';
    });
    var agreed = false;
    try { agreed = localStorage.getItem(DISCLAIMER_KEY) === '1'; } catch (e) { /* ignore */ }
    mask.classList.toggle('show', !agreed);
  }

  /* ---------------- 历史战绩（首页） ---------------- */

  var achievementsModule=global.KPL_UI_MODULES.achievements(uiContext);
  var emptyAchievementProgress=achievementsModule.emptyAchievementProgress,
      normalizeAchievementProgress=achievementsModule.normalizeAchievementProgress,
      achievementDefinitions=achievementsModule.achievementDefinitions,
      achievementRunKey=achievementsModule.achievementRunKey,
      applyAchievementRun=achievementsModule.applyAchievementRun,
      saveAchievementProgress=achievementsModule.saveAchievementProgress,
      reconcileAchievementHistory=achievementsModule.reconcileAchievementHistory,
      loadAchievementProgress=achievementsModule.loadAchievementProgress,
      showAchievementToast=achievementsModule.showAchievementToast,
      recordAchievementRun=achievementsModule.recordAchievementRun,
      recordAchievementEvent=achievementsModule.recordAchievementEvent,
      renderHomeAchievements=achievementsModule.renderHomeAchievements,
      showAchievements=achievementsModule.showAchievements;
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
  function playerAvatarHtml(icon, name, className) {
    var cls = className || 'ava';
    var fallback = esc(String(name || '?').slice(0, 1));
    return '<div class="' + cls + '">' + fallback + (icon
      ? '<img src="' + esc(icon) + '" alt="" loading="lazy" onerror="this.remove()">'
      : '') + '</div>';
  }

  /* 把 roster 槽位映射为 record（从已加载赛季分片找） */
  function recordsForRoster(roster) {
    var out = [];
    roster.forEach(function (slot) {
      if (!slot) return;
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

  function strengthForRoster(roster) {
    var recs = recordsForRoster(roster);
    var sids = roster.filter(Boolean).map(function (s) { return s.sid; });
    var chem = D.buildChemFor(sids);
    return E.lineupStrength(recs, chem, E.COMPRESS);
  }
  function strengthOf() { return strengthForRoster(STATE.roster); }

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
  var activePage = null;
  var routerModule=global.KPL_UI_MODULES.router(uiContext);
  var router=routerModule.router,
      applyShare=routerModule.applyShare,
      unpackAllStarSlots=routerModule.unpackAllStarSlots,
      applyAllStarShare=routerModule.applyAllStarShare,
      shouldAnimatePage=routerModule.shouldAnimatePage,
      showPage=routerModule.showPage;
  /* ================= 首页 ================= */
  function showHome() {
    showPage('home');
    BGM.play('intro');
    var quick = $('btn-quick');
    if (quick) {
      quick.disabled = false;
      renderDailyChallenge();
    }
    if (DATA.manifest) {
      $('stat-line').innerHTML = '<b>' + DATA.manifest.teams2026.length + '</b> 支战队 · <b>' +
        DATA.manifest.seasons.length + '</b> 个赛季 · <b>' + Object.keys(DATA.players).length + '</b> 名选手';
    }
    renderHomeHistory();
    renderHomeAchievements();
  }

  function localDayNumber(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }

  function dailyChallenge(date) {
    var presets = DATA.dynasties || [];
    if (!presets.length) return null;
    return presets[localDayNumber(date || new Date()) % presets.length];
  }

  function activeDynasty() {
    if (!STATE.dynasty) return null;
    return (DATA.dynasties || []).find(function (item) { return item.id === STATE.dynasty; }) || null;
  }

  function dynastyStoryLine(bucket, salt) {
    var dynasty = activeDynasty();
    var lines = dynasty && dynasty.story && dynasty.story[bucket];
    if (!lines || !lines.length) return '';
    return lines[Math.abs((STATE.seed || 0) + (salt || 0)) % lines.length];
  }

  function renderDailyChallenge() {
    var challenge = dailyChallenge(new Date());
    if (!challenge) return;
    var season = DATA.manifest.seasons.find(function (s) { return s.season_id === challenge.era_season; });
    var now = new Date();
    $('daily-kicker').textContent = '每日挑战 · ' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
    $('daily-title').textContent = '今日主题：' + (challenge.theme || challenge.label);
    $('daily-desc').textContent = challenge.label + ' · ' + (season ? season.name : challenge.era_season) + ' · ' + challenge.desc;
  }

  function startDailyChallenge() {
    var button = $('btn-quick');
    var now = new Date();
    var challenge = dailyChallenge(now);
    if (!challenge) {
      showStorageWarning('每日挑战暂不可用，请进入经典模式开赛。');
      return;
    }
    var seasonIds = [challenge.era_season].concat(challenge.players.map(function (p) { return p.season_id; }));
    button.disabled = true;
    $('daily-title').textContent = '正在载入今日主题…';
    Promise.all([D.loadTeam(challenge.team_fid)].concat(D.loadSeasons(seasonIds))).then(function (res) {
      currentTeamData = res[0];
      STATE.mode = 'classic';
      STATE.team = challenge.team_fid;
      STATE.season = challenge.era_season;
      STATE.dynasty = challenge.id;
      STATE.tactic = 'balanced';
      STATE.roster = challenge.players.map(function (p) { return { pid: p.player_id, sid: p.season_id }; });
      STATE.seed = (localDayNumber(now) * 101 + DATA.dynasties.indexOf(challenge)) % 100000;
      saveState();
      if (STATE.roster.length === 5) go('#/sim');
      else go('#/team');
    }).catch(function () {
      showStorageWarning('每日挑战载入失败，请检查网络后重试。');
      button.disabled = false;
      renderDailyChallenge();
    });
  }

  /* ================= 组队 ================= */
  var currentTeamData = null;

  var teamViewRequest = 0;
  var rosterModule=global.KPL_UI_MODULES.roster(uiContext);
  var showTeam=rosterModule.showTeam,
      renderDynastyStrip=rosterModule.renderDynastyStrip,
      loadDynasty=rosterModule.loadDynasty,
      renderTeamStrip=rosterModule.renderTeamStrip,
      loadTeamView=rosterModule.loadTeamView,
      presetRoster=rosterModule.presetRoster,
      slotInfo=rosterModule.slotInfo,
      renderSlots=rosterModule.renderSlots,
      renderStrength=rosterModule.renderStrength,
      openPicker=rosterModule.openPicker,
      renderPool=rosterModule.renderPool,
      maxRatingFor=rosterModule.maxRatingFor,
      bestVersionFor=rosterModule.bestVersionFor,
      pickPlayer=rosterModule.pickPlayer,
      signedDelta=rosterModule.signedDelta,
      renderPickerComparison=rosterModule.renderPickerComparison,
      confirmPicker=rosterModule.confirmPicker,
      closePicker=rosterModule.closePicker,
      showBudget=rosterModule.showBudget,
      showAllStar=rosterModule.showAllStar,
      renderAllStarTeamSelects=rosterModule.renderAllStarTeamSelects,
      presetRosterFromData=rosterModule.presetRosterFromData,
      allStarVersion=rosterModule.allStarVersion,
      allStarRecord=rosterModule.allStarRecord,
      allStarRecords=rosterModule.allStarRecords,
      renderAllStar=rosterModule.renderAllStar,
      changeAllStarTeam=rosterModule.changeAllStarTeam,
      openAllStarPicker=rosterModule.openAllStarPicker,
      renderAllStarPool=rosterModule.renderAllStarPool,
      pickAllStarPlayer=rosterModule.pickAllStarPlayer,
      renderCustomPlayerForm=rosterModule.renderCustomPlayerForm,
      readImageFile=rosterModule.readImageFile,
      setupAvatarEditor=rosterModule.setupAvatarEditor,
      applyAllStarSlot=rosterModule.applyAllStarSlot,
      confirmAllStarPicker=rosterModule.confirmAllStarPicker,
      showTrackPicker=rosterModule.showTrackPicker,
      showPosPicker=rosterModule.showPosPicker,
      showSeason=rosterModule.showSeason,
      renderSeasonList=rosterModule.renderSeasonList;
  var SIM = { session: null, stageNo: 0, path: [], queue: [], timer: null, seasonName: '', jump: false, tree: [], rosterChanged: false, paused: false, speed: 1 };
  var BRACKET_EXPECT = {
    '32强': 16, '16强': 8, '8强': 4, '4强': 2, '半决赛': 2, '总决赛': 1,
    '胜者组第1轮': 4, '胜者组第2轮': 2, '胜者组半决赛': 2, '胜者组决赛': 1,
    '败者组第1轮': 2, '败者组第2轮': 2, '败者组第3轮': 1, '败者组第4轮': 1,
    '败者组第5轮': 1, '败者组半决赛': 1, '败者组决赛': 1,
    '败者组第一轮': 2, '败者组第二轮': 2, '败者组第三轮': 2,
    '败者组第四轮': 1, '败者组第五轮': 1
  };
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
  var simulationModule=global.KPL_UI_MODULES.simulation(uiContext);
  var showSim=simulationModule.showSim,
      startSimulation=simulationModule.startSimulation,
      startAllStarSimulation=simulationModule.startAllStarSimulation,
      allStarRunStats=simulationModule.allStarRunStats,
      saveAllStarHistory=simulationModule.saveAllStarHistory,
      advance=simulationModule.advance,
      scrollToLatestCard=simulationModule.scrollToLatestCard,
      seriesContext=simulationModule.seriesContext,
      appendEntryCard=simulationModule.appendEntryCard,
      renderOpeningTree=simulationModule.renderOpeningTree,
      renderTreeCard=simulationModule.renderTreeCard,
      treeCardHtml=simulationModule.treeCardHtml,
      regularListHtml=simulationModule.regularListHtml,
      bracketColumns=simulationModule.bracketColumns,
      treeStatusLine=simulationModule.treeStatusLine,
      appendCard=simulationModule.appendCard,
      updateRevealControls=simulationModule.updateRevealControls,
      finishReveal=simulationModule.finishReveal,
      pumpReveal=simulationModule.pumpReveal,
      toggleRevealPause=simulationModule.toggleRevealPause,
      toggleRevealSpeed=simulationModule.toggleRevealSpeed,
      skipCurrentReveal=simulationModule.skipCurrentReveal,
      scrollBottom=simulationModule.scrollBottom,
      hlText=simulationModule.hlText,
      gameHtml=simulationModule.gameHtml,
      stageIcon=simulationModule.stageIcon,
      showStageButtons=simulationModule.showStageButtons,
      skipAll=simulationModule.skipAll;
  var confirmCb = null;
  var dialogsModule=global.KPL_UI_MODULES.dialogs(uiContext);
  var openConfirm=dialogsModule.openConfirm,
      closeConfirm=dialogsModule.closeConfirm,
      setupOverlayInteraction=dialogsModule.setupOverlayInteraction;
  function finishSim(championId) {
    if (window.KPLAnalytics) window.KPLAnalytics.trackEvent('kpl2k-complete');
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
      s.kda = (s.k + s.a) / Math.max(s.d, s.games, 1);
      s.avgK = s.games ? s.k / s.games : 0;
      s.avgD = s.games ? s.d / s.games : 0;
      s.avgA = s.games ? s.a / s.games : 0;
      s.participation = teamKills ? (s.k + s.a) / teamKills : 0;
      s.winRate = runMatches ? runWins / runMatches : 0;
    });
    // 每局仍只有一位 MVP；把过度集中的次数转给足量参赛且尚未获奖的队友。
    var eligible = Object.keys(runStats).filter(function (pid) {
      return runStats[pid].games >= Math.max(3, Math.round(Math.max.apply(null, Object.keys(runStats).map(function (id) { return runStats[id].games; })) * 0.6));
    });
    var totalMvp = Object.keys(runStats).reduce(function (sum, pid) { return sum + runStats[pid].mvp; }, 0);
    if (runWins >= 3 && totalMvp >= eligible.length) {
      eligible.forEach(function (pid) {
        if (runStats[pid].mvp) return;
        var donor = eligible.slice().sort(function (a, b) { return runStats[b].mvp - runStats[a].mvp; })[0];
        if (donor && runStats[donor].mvp > 1) { runStats[donor].mvp--; runStats[pid].mvp++; }
      });
      var cap = Math.max(1, Math.ceil(totalMvp * 0.4));
      for (var move = 0; move < totalMvp; move++) {
        var ranked = eligible.slice().sort(function (a, b) { return runStats[b].mvp - runStats[a].mvp; });
        var high = ranked[0], low = ranked[ranked.length - 1];
        if (!high || !low || runStats[high].mvp <= cap || runStats[high].mvp - runStats[low].mvp <= 1) break;
        runStats[high].mvp--; runStats[low].mvp++;
      }
    }
    STATE.lastRun = {
      mode: STATE.mode, budgetTotal: STATE.mode === 'budget' ? STATE.budgetTotal : null,
      champion: championId, team: STATE.team, season: STATE.season, seed: STATE.seed,
      completedAt: Date.now(), champ: isChamp,
      version: buildVersion(), tactic: STATE.tactic,
      path: SIM.path, regular: SIM.session ? SIM.session.getRegular() : {},
      tree: SIM.session && SIM.session.getTree ? SIM.session.getTree() : [],
      rosterNames: STATE.roster.map(function (s) { return playerName(s.pid); }),
      records: recordsForRoster(STATE.roster), seasonName: SIM.seasonName,
      duoDetail: STATE.mode === 'budget' ? E.budgetDuoBonus(recordsForRoster(STATE.roster), DATA.budgetPairs) : null,
      runStats: runStats, strengthBreakdown: strengthOf()[1]
    };
    var dynasty = activeDynasty();
    if (dynasty && dynasty.story) {
      var lastRound = SIM.path.length ? String(SIM.path[SIM.path.length - 1].round || '') : '';
      var endingBucket = isChamp ? 'champion' : (lastRound.indexOf('决赛') >= 0 ? 'runnerup' : 'eliminated');
      var endingLines = dynasty.story[endingBucket] || [];
      if (endingLines.length) {
        STATE.lastRun.dynasty = dynasty.id;
        STATE.lastRun.storyOutcome = { theme: dynasty.theme, label: dynasty.label, lines: endingLines.slice() };
        appendCard({ title: '📜 专属终章 · ' + dynasty.theme, lines: endingLines, cls: 'final' });
      }
    }
    recordAchievementRun(STATE.lastRun);
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
      mode: STATE.mode,
      team: STATE.team, teamName: teamName(STATE.team), season: STATE.season, seasonName: SIM.seasonName,
      seed: STATE.seed, savedAt: STATE.lastRun.completedAt, champ: isChamp, banner: hBanner,
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

  function renderResultFactors(run) {
    var factors = [];
    var path = run.path || [];
    var wins = path.filter(function (entry) { return entry.win; }).length;
    var deciders = path.filter(function (entry) {
      var score = scoreParts(entry.score);
      return Math.abs(score[0] - score[1]) === 1 && Math.min(score[0], score[1]) >= 1;
    }).length;
    var scoreText = run.mode === 'allstar'
      ? ('最终比分 ' + esc(run.score || ((path[0] || {}).score || '-')))
      : (wins + ' 胜 ' + (path.length - wins) + ' 负');
    if (deciders) scoreText += '，其中 ' + deciders + ' 场打到决胜局';
    factors.push(['系列赛', scoreText + '。']);
    var tacticText = {
      stable: '稳健运营降低了赛果波动，更强调资源控制与失误管理。',
      balanced: '均衡应对采用标准波动，临场决策与关键团处理共同影响赛果。',
      gamble: '放手一搏提高了赛果波动，爆冷与翻车都更容易出现。'
    }[run.tactic || 'balanced'];
    factors.push(['赛前策略', tacticText]);
    if (run.mode === 'budget' && run.duoDetail) {
      var duos = run.duoDetail.pairs || [];
      factors.push(['同队搭档', duos.length
        ? duos.map(function (p) { return esc(playerName(p.a)) + ' + ' + esc(playerName(p.b)); }).join('、') +
          '，战力 +' + f1(run.duoDetail.bonus) + '。'
        : '本阵容未触发历史同队搭档加成。']);
    }
    var bestPid = null;
    Object.keys(run.runStats || {}).forEach(function (pid) {
      var stat = run.runStats[pid] || {};
      var best = bestPid ? (run.runStats[bestPid] || {}) : {};
      if (!bestPid || (stat.mvp || 0) > (best.mvp || 0) ||
          ((stat.mvp || 0) === (best.mvp || 0) && (stat.kda || 0) > (best.kda || 0))) bestPid = pid;
    });
    if (bestPid) {
      var bestStat = run.runStats[bestPid] || {};
      factors.push(['关键选手', esc(playerName(bestPid)) + '贡献 ' + esc(bestStat.mvp || 0) + ' 次MVP，赛季KDA ' + f1(bestStat.kda) + '。']);
    }
    $('result-factors').innerHTML = factors.map(function (factor) {
      return '<div class="factor-item"><div class="factor-label">' + factor[0] + '</div><div class="factor-text">' + factor[1] + '</div></div>';
    }).join('');
  }

  function renderResultStory(run) {
    var card = $('result-story-card');
    var story = run && run.storyOutcome;
    if (!story || !story.lines || !story.lines.length) {
      card.style.display = 'none';
      $('result-story').innerHTML = '';
      return;
    }
    card.style.display = '';
    $('result-story').innerHTML = '<div class="result-story-theme">' + esc(story.theme || story.label || '专属篇章') + '</div>' +
      story.lines.map(function (line) { return '<div class="result-story-line">' + esc(line) + '</div>'; }).join('');
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
    renderResultFactors(run);
    renderResultStory(run);
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
      var ava = playerAvatarHtml(icon, name, 'pava');
      var kda = rs ? f1(rs.kda) : f1(r.avg_kda);
      var avgK = rs ? f1(rs.avgK) : f1(r.avg_kill_num);
      var part = rs ? pct(rs.participation) : pct(r.avg_participation_rate);
      var games = rs ? rs.games : (r.games || 0);
      var mvp = rs ? rs.mvp : (r.mvp_count || 0);
      return '<div class="result-pc">' + ava +
        '<div><div class="pnm">' + esc(name) + '<span class="ppos">' + esc(r.position) + '</span></div>' +
        '<div class="pstat">KDA ' + kda + ' · 场均击杀 ' + avgK + ' · 参团 ' + part + ' · ' + esc(games) + ' 场' + (mvp ? ' · MVP ' + esc(mvp) : '') + '</div></div></div>';
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
        '<td>' + esc(games) + '</td>' +
        '<td>' + esc(mvp || '-') + '</td></tr>';
    }).join('');
    requestAnimationFrame(function () { window.scrollTo({ top: 0 }); });
  }

  function showAllStarResult(run) {
    var winnerName = run.champion === 'ALLSTAR_A' ? run.aName : run.bName;
    BGM.play('champion', winnerName);
    $('result-banner').className = 'res-banner champ';
    $('result-banner').textContent = '🏆 ' + winnerName + ' 获胜 · ' + run.score;
    renderAchievements(run);
    renderResultFactors(run);
    renderResultStory(null);
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
        var ava = playerAvatarHtml(icon, name, 'pava');
        return '<div class="result-pc">' + ava + '<div><div class="pnm">' + esc(name) + '<span class="ppos">' + esc(r.position) + '</span></div>' +
           '<div class="pstat">KDA ' + f1(rs && rs.kda) + ' · 场均击杀 ' + f1(rs && rs.avgK) + ' · 参团 ' + pct(rs && rs.participation) + ' · ' + esc((rs && rs.games) || 0) + ' 场' + ((rs && rs.mvp) ? ' · MVP ' + esc(rs.mvp) : '') + '</div></div></div>';
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
         '<td>' + pct(rs.winRate) + '</td><td>' + esc(rs.games || 0) + '</td><td>' + esc(rs.mvp || '-') + '</td></tr>';
    }).join('');
    requestAnimationFrame(function () { window.scrollTo({ top: 0 }); });
  }

  var shareImagePending = false;
  var shareModule=global.KPL_UI_MODULES.share(uiContext);
  var allStarHasCustom=shareModule.allStarHasCustom,
      packAllStarSlots=shareModule.packAllStarSlots,
      shareLink=shareModule.shareLink,
      copyShare=shareModule.copyShare,
      fallbackCopy=shareModule.fallbackCopy,
      roundRectPath=shareModule.roundRectPath,
      loadShareAvatar=shareModule.loadShareAvatar,
      drawShareAvatar=shareModule.drawShareAvatar,
      renderShareImage=shareModule.renderShareImage,
      paintShareImage=shareModule.paintShareImage,
      closeShareModal=shareModule.closeShareModal,
      downloadShare=shareModule.downloadShare;
      /* ---------------- 入口 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initDisclaimer();
    setupOverlayInteraction();
    initBGM();
    loadState();
    KPL_BOOTSTRAP.mount({ load: D.loadBase, initialize: function () {
      window.addEventListener('hashchange', router);
      // 绑定固定按钮
      $('btn-classic').addEventListener('click', function () {
        BGM.unlock();
        BGM.play('intro');
        STATE.mode = 'classic';
        go('#/team');
      });
      $('btn-quick').addEventListener('click', function () {
        BGM.unlock(); BGM.play('intro'); startDailyChallenge();
      });
      $('btn-allstar').addEventListener('click', function () {
        BGM.unlock(); BGM.play('intro'); STATE.mode = 'allstar'; saveState(); go('#/allstar');
      });
      KPL_BUDGET.init(DATA, function (choice) {
        STATE.mode = 'budget';
        STATE.budgetTotal = choice.total;
        STATE.team = choice.team;
        STATE.roster = choice.roster;
        STATE.season = null;
        STATE.seed = Math.floor(Math.random() * 100000);
        STATE.dynasty = null;
        saveState();
        go('#/season');
      });
      $('btn-budget').addEventListener('click', function () {
        BGM.unlock(); BGM.play('intro'); go('#/budget');
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
      $('achievement-entry').addEventListener('click', function () { go('#/achievements'); });
      $('btn-confirm-team').addEventListener('click', function () { go('#/season'); });
      $('season-back').addEventListener('click', function () { go(STATE.mode === 'budget' ? '#/budget' : '#/team'); });
      $('season-go').addEventListener('click', function () { go('#/sim'); });
      $('sim-skip').addEventListener('click', function () {
        openConfirm('一键跳转', '是否直接查看比赛结果？将跳过剩余赛程的文字，直接生成最终战绩。', skipAll, '直接查看');
      });
      $('sim-pause').addEventListener('click', toggleRevealPause);
      $('sim-speed').addEventListener('click', toggleRevealSpeed);
      $('sim-skip-series').addEventListener('click', skipCurrentReveal);
      $('sim-back').addEventListener('click', function () {
        openConfirm('返回首页', '当前模拟将中断，本次征战记录不会被保存。确定返回首页吗？', function () {
          if (SIM.timer) { clearTimeout(SIM.timer); SIM.timer = null; }
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
        if (STATE.mode === 'budget') { go('#/budget'); return; }
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
          recordAchievementEvent('sharedRuns');
        }, function () { $('share-copy').textContent = '复制失败'; });
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
    } });
  });
})(window);
