/* KPL 2K 数据层：分片加载 + 索引 */
(function (global) {
  'use strict';

  var DATA = {
    manifest: null,
    base: null,
    players: {},      // pid -> {name, positions, icon}
    franchises: [],   // franchise 精简列表
    names: {},        // fid -> 最新队名
    tpl: {},
    flavor: {},
    teamFlavor: {},
    rivalries: [],
    dynasties: [],
    teamIcons: {},    // fid -> 队标 URL
    allStar: null,    // merged global player/version index
    teamsCache: {},   // fid -> teams/{fid}.json
    seasonCache: {}   // sid -> seasons/{sid}.json
  };

  function fetchJson(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error('load failed: ' + path);
      return r.json();
    });
  }

  function loadBase() {
    return Promise.all([
      fetchJson('data/manifest.json'),
      fetchJson('data/base.json'),
      fetchJson('data/team_icons.json')
    ]).then(function (res) {
      DATA.manifest = res[0];
      DATA.base = res[1];
      DATA.teamIcons = (res[2] && res[2].icons) || {};
      DATA.players = res[1].players;
      DATA.franchises = res[1].franchises;
      DATA.tpl = res[1].narrative.templates;
      DATA.tpl.heroes_pool = res[1].narrative.heroes_pool || DATA.tpl.heroes_pool || {};
      DATA.flavor = (res[1].narrative.player_flavor || {}).flavors || {};
      DATA.teamFlavor = (res[1].narrative.team_flavor || {}).teams || {};
      DATA.teamSlogans = (res[1].narrative.team_flavor || {}).slogans || {};
      DATA.rivalries = (res[1].narrative.rivalries || {}).rivalries || [];
      DATA.names = KPL_ENGINE.franchiseNames(res[1].franchises);
      return fetchJson('data/dynasties.json').then(function (d) {
        DATA.dynasties = d.dynasties || [];
        return DATA;
      });
    });
  }

  function loadTeam(fid) {
    if (DATA.teamsCache[fid]) return Promise.resolve(DATA.teamsCache[fid]);
    return fetchJson('data/teams/' + fid + '.json').then(function (d) {
      DATA.teamsCache[fid] = d;
      return d;
    });
  }

  function loadAllStar() {
    if (DATA.allStar) return Promise.resolve(DATA.allStar);
    return fetchJson('data/all_star.json').then(function (d) {
      DATA.allStar = d;
      return d;
    });
  }

  function loadSeason(sid) {
    if (DATA.seasonCache[sid]) return Promise.resolve(DATA.seasonCache[sid]);
    return fetchJson('data/seasons/' + sid + '.json').then(function (d) {
      DATA.seasonCache[sid] = d;
      return d;
    });
  }

  function loadSeasons(sids) {
    var seen = {};
    return Promise.all(sids.filter(function (s) { return s && !seen[s] ? (seen[s] = true) : false; }).map(loadSeason));
  }

  /* 某队某赛季的首发记录（>=5 场，评分降序），供 pickStarter */
  function seasonRoster(fid, sid) {
    var season = DATA.seasonCache[sid];
    if (!season) return [];
    return season.rosters
      .filter(function (r) { return r.team_franchise === fid && (r.games || 0) >= 5; })
      .sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
  }

  function seasonNames(sid) {
    var season = DATA.seasonCache[sid];
    var out = {};
    (season ? season.rosters : []).forEach(function (r) {
      out[r.team_franchise] = out[r.team_franchise] || DATA.names[r.team_franchise] || r.team_franchise;
    });
    return out;
  }

  /* 从已加载赛季分片构建化学：合并 rosters + pair_win */
  function buildChemFor(sids) {
    var allRecords = [];
    var pairWin = {};
    sids.forEach(function (sid) {
      var s = DATA.seasonCache[sid];
      if (!s) return;
      allRecords = allRecords.concat(s.rosters);
      pairWin[sid] = s.pair_win || {};
    });
    return KPL_ENGINE.buildChem(allRecords, pairWin, DATA.players);
  }

  function franchise(fid) {
    for (var i = 0; i < DATA.franchises.length; i++) {
      if (DATA.franchises[i].id === fid) return DATA.franchises[i];
    }
    return null;
  }

  global.KPL_DATA = {
    DATA: DATA,
    loadBase: loadBase,
    loadTeam: loadTeam,
    loadAllStar: loadAllStar,
    loadSeason: loadSeason,
    loadSeasons: loadSeasons,
    seasonRoster: seasonRoster,
    seasonNames: seasonNames,
    buildChemFor: buildChemFor,
    franchise: franchise
  };
})(window);
