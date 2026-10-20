/* roster: injected coordination callbacks; no module imports or listener installation at load. */
(function(global){'use strict';
(global.KPL_UI_MODULES=global.KPL_UI_MODULES||{}).roster=function(ctx){
  function showTeam() {
    ctx.showPage('team');
    BGM.play('intro');
    if (!ctx.STATE.team && ctx.DATA.manifest.teams2026.length) {
      ctx.STATE.team = ctx.DATA.manifest.teams2026[0].id;
    }
    renderDynastyStrip();
    renderTeamStrip();
    loadTeamView(ctx.STATE.team);
  }

  /* 王朝战队预设：一键载入历史强阵（巅峰版本） */
  function renderDynastyStrip() {
    var html = ctx.DATA.dynasties.map(function (d) {
      var sel = ctx.STATE.dynasty === d.id ? ' sel' : '';
      return '<button class="dyn-chip' + sel + '" data-id="' + d.id + '">' +
        '<div class="dc-label">' + ctx.esc(d.label) + '</div>' +
        '<div class="dc-desc">' + ctx.esc(d.desc) + '</div></button>';
    }).join('');
    ctx.$('dynasty-strip').innerHTML = html;
    ctx.$('dynasty-strip').querySelectorAll('.dyn-chip').forEach(function (el) {
      el.addEventListener('click', function () { loadDynasty(el.getAttribute('data-id')); });
    });
  }

  function loadDynasty(id) {
    var d = ctx.DATA.dynasties.find(function (x) { return x.id === id; });
    if (!d) return;
    ctx.STATE.team = d.team_fid;
    ctx.STATE.roster = d.players.map(function (p) { return { pid: p.player_id, sid: p.season_id }; });
    ctx.STATE.dynasty = id;
    ctx.saveState();
    ctx.D.loadSeasons(d.players.map(function (p) { return p.season_id; })).then(function () {
      renderTeamStrip();
      renderDynastyStrip();
      renderSlots();
      renderStrength();
    }).catch(function (e) {
      ctx.$('team-slots').innerHTML = '<div class="mut">王朝阵容加载失败：' + ctx.esc(e.message) + '</div>';
    });
  }

  function renderTeamStrip() {
    var html = ctx.DATA.manifest.teams2026.map(function (t) {
      return '<button class="team-chip' + (t.id === ctx.STATE.team ? ' sel' : '') + '" data-fid="' + t.id + '">' +
        ctx.teamBadgeHtml(t.id, t.abbr || t.name) +
        '<div class="tc-name">' + ctx.esc(t.name) + '</div></button>';
    }).join('');
    ctx.$('team-strip').innerHTML = html;
    ctx.$('team-strip').querySelectorAll('.team-chip').forEach(function (el) {
      el.addEventListener('click', function () {
        var fid = el.getAttribute('data-fid');
        if (fid !== ctx.STATE.team) {
          ctx.STATE.team = fid;
          ctx.STATE.roster = [];  // 切队后重新加载该队 2026 首发
          ctx.STATE.dynasty = null;
        }
        ctx.saveState();
        renderTeamStrip();
        renderDynastyStrip();
        loadTeamView(ctx.STATE.team);
      });
    });
  }


  function loadTeamView(fid) {
    var request = ++ctx.teamViewRequest;
    ctx.$('btn-confirm-team').disabled = true;
    ctx.$('team-slots').innerHTML = '<div class="mut" style="padding:20px;text-align:center">正在加载选手数据…</div>';
    var loaders = ctx.PRESET_SEASONS.map(ctx.D.loadSeason);
    Promise.all([ctx.D.loadTeam(fid)].concat(loaders)).then(function (res) {
      if (request !== ctx.teamViewRequest || ctx.STATE.team !== fid) return;
      ctx.currentTeamData = res[0];
      if (!ctx.STATE.roster.length) {
        ctx.STATE.roster = presetRoster(fid);
        ctx.saveState();
      }
      renderSlots();
      renderStrength();
      ctx.$('btn-confirm-team').disabled = false;
    }).catch(function (e) {
      if (request !== ctx.teamViewRequest || ctx.STATE.team !== fid) return;
      ctx.$('team-slots').innerHTML = '<div class="mut">加载失败：' + ctx.esc(e.message) + '</div>';
    });
  }

  /* 2026 现役首发：优先 S2，缺失队用 S1 */
  function presetRoster(fid) {
    // 1) 优先按"2026 年版本"拼 5 位置（槽位战力与选手图鉴版本一致）
    var data = ctx.currentTeamData;
    if (data && data.players && data.players.length) {
      var byPos = {};
      ctx.POS_ORDER.forEach(function (pos) { byPos[pos] = []; });
      data.players.forEach(function (p) {
        if (data.registered_roster && !data.registered_roster.some(function (r) { return r.playerId === p.player_id; })) return;
        var best = null;
        (p.versions || []).forEach(function (v) {
          if (v.year === 2026 && (!best || v.rating > best.rating)) best = v;
        });
        if (best) byPos[best.position].push({ pid: p.player_id, sid: best.season_id, rating: best.rating });
      });
      var slots = ctx.POS_ORDER.map(function (pos) {
        var lst = byPos[pos].slice().sort(function (a, b) { return b.rating - a.rating; });
        return lst[0] ? { pid: lst[0].pid, sid: lst[0].sid } : null;
      }).filter(Boolean);
      if (slots.length === 5) return slots;
    }
    // 2) 回退：S2 / S1 赛季记录
    for (var i = 0; i < ctx.PRESET_SEASONS.length; i++) {
      var recs = ctx.D.seasonRoster(fid, ctx.PRESET_SEASONS[i]);
      if (recs.length >= 5) {
        return ctx.E.pickStarter(recs).map(function (r) { return { pid: r.player_id, sid: r.season_id }; });
      }
    }
    return [];
  }

  function slotInfo(pid, sid) {
    var season = ctx.DATA.seasonCache[sid];
    var rec = null;
    if (season) {
      rec = season.rosters.find(function (r) { return r.player_id === pid && r.season_id === sid; });
    }
    var ver = null;
    if (ctx.currentTeamData) {
      ctx.currentTeamData.players.forEach(function (p) {
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
    return { rec: rec, ver: ver, name: ctx.playerName(pid), icon: ctx.playerIcon(pid) };
  }

  function renderSlots() {
    var html = ctx.POS_ORDER.map(function (pos, i) {
      var slot = ctx.STATE.roster[i];
      var inner;
      if (slot) {
        var info = slotInfo(slot.pid, slot.sid);
        var rating = info.ver ? info.ver.rating : (info.rec ? info.rec.rating : null);
        var label = (info.ver && info.ver.label) || (slot.sid || '').replace(/^(KPL|KCC|L)/, '');
        var ava = ctx.playerAvatarHtml(info.icon, info.name);
        inner = ava +
          '<div class="info"><div class="pname">' + ctx.esc(info.name) + '</div>' +
          '<div class="pmeta">' + ctx.esc(label) + ' · ' + ctx.esc(pos) + '</div></div>' +
          '<div class="rating">' + (rating != null ? Math.round(rating) : '-') + '</div><div class="arrow">›</div>';
      } else {
        inner = '<div class="info pname mut">点击补位</div><div class="arrow">›</div>';
      }
      return '<button class="slot" data-i="' + i + '"><div class="pos p' + i + '">' + ctx.esc(pos) + '</div>' + inner + '</button>';
    }).join('');
    ctx.$('team-slots').innerHTML = html;
    ctx.$('team-slots').querySelectorAll('.slot').forEach(function (el) {
      el.addEventListener('click', function () { openPicker(parseInt(el.getAttribute('data-i'), 10)); });
    });
  }

  function renderStrength() {
    var res = ctx.strengthOf();
    var eff = res[0], brk = res[1];
    var pctFill = Math.max(6, Math.min(100, (brk.raw - 40) / 55 * 100));
    ctx.$('strength-num').textContent = brk.raw.toFixed(1);
    ctx.$('strength-fill').style.width = pctFill + '%';
    ctx.$('strength-break').innerHTML =
      '<span>基础 <b>' + brk.base + '</b></span>' +
      '<span>覆盖 <b>' + brk.coverage + '</b></span>' +
      '<span>默契 <b>' + brk.synergy + '</b></span>' +
      '<span>胜率化学 <b>' + brk.win_synergy + '</b></span>' +
      '<span>风格 <b>' + brk.style + '</b></span>';
  }

  /* -------- 换人抽屉 -------- */
  function openPicker(slotIdx) {
    ctx.picker = { open: true, slot: slotIdx, pid: null, sid: null };
    ctx.D.loadTeam(ctx.STATE.team).then(function (data) {
      ctx.currentTeamData = data;
      renderPool(ctx.POS_ORDER[slotIdx]);
      ctx.$('drawer').classList.add('show');
      ctx.$('drawer-mask').classList.add('show');
    }).catch(function () {
      closePicker();
    });
  }

  /* 选手列表（可按返回回到此视图） */
  function renderPool(pos) {
    ctx.$('picker-pool').style.display = '';
    ctx.$('picker-ver').innerHTML = '';
    ctx.$('picker-compare').innerHTML = '';
    ctx.$('picker-back').style.display = 'none';
    ctx.$('picker-confirm').style.display = '';
    ctx.$('picker-title').textContent = pos + ' · 换人';
    ctx.$('picker-sub').innerHTML = ctx.teamBadgeHtml(ctx.STATE.team) + ' <span>' + ctx.esc(ctx.teamName(ctx.STATE.team)) + ' 历届' + ctx.esc(pos) + '</span>';
    var candidates = ctx.currentTeamData.players.filter(function (p) {
      return p.versions.some(function (v) { return v.position === pos; });
    }).sort(function (a, b) {
      var ra = maxRatingFor(a, pos), rb = maxRatingFor(b, pos);
      return rb - ra;
    });
    ctx.$('picker-pool').innerHTML = candidates.map(function (p) {
      var best = bestVersionFor(p, pos);
      var inRoster = ctx.STATE.roster.some(function (s) { return s && s.pid === p.player_id; });
      var ava = ctx.playerAvatarHtml(p.icon, p.name);
      return '<button class="pool-item' + (inRoster ? ' sel' : '') + '" data-pid="' + p.player_id + '">' + ava +
        '<div><div class="pname">' + ctx.esc(p.name) + '</div>' +
        '<div class="pver">' + (inRoster ? '已在阵容 · ' : '') + ctx.esc(best.label) + ' · ' + ctx.esc(best.season_id) + '</div></div>' +
        '<div class="prate">' + Math.round(best.rating) + '</div></button>';
    }).join('');
    ctx.$('picker-pool').querySelectorAll('.pool-item').forEach(function (el) {
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
    var p = ctx.currentTeamData.players.find(function (x) { return x.player_id === pid; });
    if (!p) return;
    ctx.picker.pid = pid;
    var vers = p.versions.filter(function (v) { return v.position === pos; })
      .sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
    var best = bestVersionFor(p, pos);
    ctx.picker.sid = (best || {}).season_id || null;
    ctx.$('picker-pool').style.display = 'none';
    ctx.$('picker-back').style.display = '';
    ctx.$('picker-title').textContent = p.name + ' · 选择版本';
    ctx.$('picker-sub').textContent = '该选手在' + pos + '位的不同时期版本';
    ctx.$('picker-ver').innerHTML = vers.map(function (v) {
      var sel = v.season_id === ctx.picker.sid ? ' sel' : '';
      return '<button class="vchip' + sel + '" data-sid="' + v.season_id + '">' +
        ctx.esc(v.label) + ' · ' + Math.round(v.rating) + '</button>';
    }).join('');
    renderPickerComparison(pos);
    ctx.$('drawer').scrollTop = 0;
    ctx.$('picker-ver').querySelectorAll('.vchip').forEach(function (el) {
      el.addEventListener('click', function () {
        ctx.picker.sid = el.getAttribute('data-sid');
        ctx.$('picker-ver').querySelectorAll('.vchip').forEach(function (c) {
          c.classList.toggle('sel', c === el);
        });
        renderPickerComparison(pos);
      });
    });
  }

  function signedDelta(value) {
    var rounded = Math.round(value * 10) / 10;
    return (rounded > 0 ? '+' : '') + rounded.toFixed(1);
  }

  function renderPickerComparison(pos) {
    var box = ctx.$('picker-compare');
    if (!ctx.picker.pid || !ctx.picker.sid) { box.innerHTML = ''; return; }
    var duplicate = ctx.STATE.roster.some(function (slot, i) {
      return i !== ctx.picker.slot && slot && slot.pid === ctx.picker.pid;
    });
    if (duplicate) {
      box.innerHTML = '<div class="picker-compare"><div class="picker-compare-title">该选手已在阵容中</div><div class="mut" style="font-size:11px">同一选手不能同时出现在两个位置。</div></div>';
      return;
    }
    var before = ctx.strengthForRoster(ctx.STATE.roster)[1];
    var nextRoster = ctx.STATE.roster.slice();
    while (nextRoster.length < ctx.POS_ORDER.length) nextRoster.push(null);
    nextRoster[ctx.picker.slot] = { pid: ctx.picker.pid, sid: ctx.picker.sid };
    var after = ctx.strengthForRoster(nextRoster)[1];
    var currentSlot = ctx.STATE.roster[ctx.picker.slot];
    var currentRecord = currentSlot ? ctx.recordsForRoster([currentSlot])[0] : null;
    var nextRecord = ctx.recordsForRoster([{ pid: ctx.picker.pid, sid: ctx.picker.sid }])[0];
    var ratingBefore = currentRecord ? currentRecord.rating : null;
    var ratingAfter = nextRecord ? nextRecord.rating : null;
    var totalDelta = after.raw - before.raw;
    var chemBefore = before.synergy + before.win_synergy;
    var chemAfter = after.synergy + after.win_synergy;
    function deltaClass(value) { return value > 0 ? 'up' : (value < 0 ? 'down' : ''); }
    box.innerHTML = '<div class="picker-compare"><div class="picker-compare-title">换人影响 · ' + ctx.esc(pos) + '</div>' +
      '<div class="picker-compare-row"><span>个人战力</span><b>' + (ratingBefore == null ? '待补位' : ctx.f1(ratingBefore)) + ' → ' + ctx.f1(ratingAfter) + '</b></div>' +
      '<div class="picker-compare-row"><span>阵容总分</span><b class="' + deltaClass(totalDelta) + '">' + ctx.f1(before.raw) + ' → ' + ctx.f1(after.raw) + '（' + signedDelta(totalDelta) + '）</b></div>' +
      '<div class="picker-compare-row"><span>默契合计</span><b class="' + deltaClass(chemAfter - chemBefore) + '">' + ctx.f1(chemBefore) + ' → ' + ctx.f1(chemAfter) + '（' + signedDelta(chemAfter - chemBefore) + '）</b></div></div>';
  }

  function confirmPicker() {
    if (ctx.picker.mode === 'allstar') { confirmAllStarPicker(); return; }
    if (!ctx.picker.pid || !ctx.picker.sid) { closePicker(); return; }
    var slot = ctx.picker.slot;
    // 同一选手不能同时上场（转分路选手在不同位置也禁止重复，避免"两个无畏/两个妖刀"）
    var dupIdx = -1;
    ctx.STATE.roster.forEach(function (s, i) {
      if (i !== slot && s && s.pid === ctx.picker.pid) dupIdx = i;
    });
    if (dupIdx >= 0) {
      ctx.openConfirm('已在阵容中', '该选手已在阵容中，同一选手不能同时上场。请先更换原位置的选手。', null, '知道了');
      return;
    }
    // 换人后战绩卡按赛季记录渲染，新选手的版本赛季必须先加载，否则结果页会缺人
    var need = [ctx.picker.sid].filter(function (s) { return s && !ctx.DATA.seasonCache[s]; });
    var apply = function () {
      ctx.STATE.roster = ctx.STATE.roster.slice();
      while (ctx.STATE.roster.length < ctx.POS_ORDER.length) ctx.STATE.roster.push(null);
      ctx.STATE.roster[slot] = { pid: ctx.picker.pid, sid: ctx.picker.sid };
      ctx.STATE.dynasty = null;
      if (ctx.SIM.session) {
        ctx.SIM.session.setRoster(ctx.STATE.team, ctx.recordsForRoster(ctx.STATE.roster));
        ctx.SIM.rosterChanged = true;
      }
      ctx.saveState();
      ctx.recordAchievementEvent('rosterEdits');
      renderSlots();
      renderStrength();
      closePicker();
    };
    if (need.length) ctx.D.loadSeasons(need).then(apply).catch(apply);
    else apply();
  }
  function closePicker() {
    ctx.picker.open = false;
    ctx.$('drawer').classList.remove('show');
    ctx.$('drawer-mask').classList.remove('show');
    ctx.$('picker-confirm').style.display = '';
    ctx.$('picker-pool').style.display = '';
    ctx.$('picker-back').style.display = 'none';
  }

  /* ================= 100 金币组队 ================= */
  function showBudget() {
    ctx.showPage('budget');
    BGM.play('intro');
    KPL_BUDGET.show();
  }

  /* ================= 全明星模式 ================= */
  function showAllStar() {
    ctx.showPage('allstar');
    BGM.play('intro');
    ctx.STATE.mode = 'allstar';
    var teams = ctx.DATA.manifest.teams2026 || [];
    if (!ctx.STATE.allStar.aTeam && teams.length) ctx.STATE.allStar.aTeam = teams[0].id;
    if (!ctx.STATE.allStar.bTeam && teams.length) ctx.STATE.allStar.bTeam = (teams[1] || teams[0]).id;
    renderAllStarTeamSelects();
    ctx.renderTacticPickers();
    ctx.$('allstar-a-slots').innerHTML = ctx.$('allstar-b-slots').innerHTML = '<div class="mut" style="padding:18px;text-align:center">正在加载全明星选手库…</div>';
    Promise.all([
      ctx.D.loadAllStar(), ctx.D.loadTeam(ctx.STATE.allStar.aTeam), ctx.D.loadTeam(ctx.STATE.allStar.bTeam)
    ].concat(ctx.PRESET_SEASONS.map(ctx.D.loadSeason))).then(function (res) {
      if (!ctx.STATE.allStar.aRoster.length) ctx.STATE.allStar.aRoster = presetRosterFromData(ctx.STATE.allStar.aTeam, res[1]);
      if (!ctx.STATE.allStar.bRoster.length) ctx.STATE.allStar.bRoster = presetRosterFromData(ctx.STATE.allStar.bTeam, res[2]);
      ctx.saveState();
      renderAllStar();
    }).catch(function (e) {
      ctx.$('allstar-a-slots').innerHTML = '<div class="mut">加载失败：' + ctx.esc(e.message) + '</div>';
      ctx.$('allstar-b-slots').innerHTML = '';
    });
  }

  function renderAllStarTeamSelects() {
    var options = (ctx.DATA.manifest.teams2026 || []).map(function (t) {
      return '<option value="' + ctx.esc(t.id) + '">' + ctx.esc(t.name) + '</option>';
    }).join('');
    ['a', 'b'].forEach(function (side) {
      var el = ctx.$('allstar-' + side + '-team');
      el.innerHTML = options;
      el.value = ctx.STATE.allStar[side + 'Team'];
    });
  }

  function presetRosterFromData(fid, data) {
    if (data && data.players) {
      var byPos = {};
      ctx.POS_ORDER.forEach(function (pos) { byPos[pos] = []; });
      data.players.forEach(function (p) {
        if (data.registered_roster && !data.registered_roster.some(function (r) { return r.playerId === p.player_id; })) return;
        var best = null;
        (p.versions || []).forEach(function (v) {
          if (v.year === 2026 && (!best || v.rating > best.rating)) best = v;
        });
        if (best && byPos[best.position]) {
          byPos[best.position].push({ pid: p.player_id, sid: best.season_id, teamFid: fid, rating: best.rating });
        }
      });
      var slots = ctx.POS_ORDER.map(function (pos) {
        var item = byPos[pos].sort(function (a, b) { return b.rating - a.rating; })[0];
        return item ? { pid: item.pid, sid: item.sid, teamFid: item.teamFid } : null;
      }).filter(Boolean);
      if (slots.length === 5) return slots;
    }
    return [];
  }

  function allStarVersion(slot) {
    if (!slot || !ctx.DATA.allStar) return null;
    var pid = slot.templatePid || slot.pid;
    var p = (ctx.DATA.allStar.players || []).find(function (x) { return x.player_id === pid; });
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
    return (ctx.STATE.allStar[side + 'Roster'] || []).map(function (slot) {
      return allStarRecord(slot, sideId, keepSourceTeam);
    }).filter(Boolean);
  }

  function renderAllStar() {
    ['a', 'b'].forEach(function (side) {
      var roster = ctx.STATE.allStar[side + 'Roster'] || [];
      ctx.$('allstar-' + side + '-slots').innerHTML = ctx.POS_ORDER.map(function (pos, i) {
        var slot = roster[i], inner;
        if (slot) {
          var v = allStarVersion(slot), name = ctx.playerName(slot.pid), icon = ctx.playerIcon(slot.pid);
          var ava = ctx.playerAvatarHtml(icon, name);
          inner = ava + '<div class="info"><div class="pname">' + ctx.esc(name) + '</div>' +
            '<div class="pmeta">' + ctx.esc((v && v.label) || slot.sid) + ' · ' + ctx.esc((v && v.team_name) || '') +
            (slot.templatePid ? '<span class="custom-slot-hint">自定义选手 · 能力继承自 ' + ctx.esc(ctx.playerName(slot.templatePid)) + '</span>' : '') + '</div></div>' +
            '<div class="rating">' + (v ? Math.round(v.rating) : '-') + '</div><div class="arrow">›</div>';
        } else {
          inner = '<div class="info pname mut">点击补位</div><div class="arrow">›</div>';
        }
        return '<button class="slot" data-side="' + side + '" data-i="' + i + '"><div class="pos p' + i + '">' + ctx.esc(pos) + '</div>' + inner + '</button>';
      }).join('');
      ctx.$('allstar-' + side + '-slots').querySelectorAll('.slot').forEach(function (el) {
        el.addEventListener('click', function () { openAllStarPicker(side, parseInt(el.getAttribute('data-i'), 10)); });
      });
    });
    ctx.$('allstar-bo').querySelectorAll('button').forEach(function (el) {
      el.classList.toggle('sel', parseInt(el.getAttribute('data-bo'), 10) === ctx.STATE.allStar.bo);
    });
    var all = (ctx.STATE.allStar.aRoster || []).concat(ctx.STATE.allStar.bRoster || []).filter(Boolean);
    var ids = all.map(function (s) { return s.pid; });
    var valid = all.length === 10 && ids.filter(function (id, i) { return ids.indexOf(id) === i; }).length === 10;
    ctx.$('allstar-start').disabled = !valid;
    ctx.$('allstar-start').textContent = valid ? ('开始 ' + 'BO' + ctx.STATE.allStar.bo + ' 全明星对决') : '请补齐双方阵容并移除重复选手';
  }

  function changeAllStarTeam(side, fid) {
    ctx.STATE.allStar[side + 'Team'] = fid;
    ctx.STATE.allStar[side + 'Roster'] = [];
    ctx.D.loadTeam(fid).then(function (data) {
      ctx.STATE.allStar[side + 'Roster'] = presetRosterFromData(fid, data);
      ctx.saveState(); renderAllStar();
    });
  }

  function openAllStarPicker(side, slotIdx) {
    ctx.picker = { open: true, mode: 'allstar', side: side, slot: slotIdx, pid: null, sid: null, teamFid: null };
    renderAllStarPool(ctx.POS_ORDER[slotIdx], '');
    ctx.$('drawer').classList.add('show'); ctx.$('drawer-mask').classList.add('show');
  }

  function renderAllStarPool(pos, query) {
    var candidates = (ctx.DATA.allStar.players || []).filter(function (p) {
      return (p.versions || []).some(function (v) { return v.position === pos; }) &&
        (!query || p.name.toLowerCase().indexOf(query.toLowerCase()) >= 0);
    }).sort(function (a, b) { return maxRatingFor(a, pos) - maxRatingFor(b, pos); }).reverse();
    ctx.$('picker-title').textContent = pos + ' · 全联盟选人';
    ctx.$('picker-sub').textContent = '选择职业选手后可挑历史版本，也可把该版本设为自定义选手模板';
    ctx.$('picker-back').style.display = 'none'; ctx.$('picker-ver').innerHTML = ''; ctx.$('picker-compare').innerHTML = ''; ctx.$('picker-confirm').style.display = 'none';
    ctx.$('picker-pool').style.display = '';
    ctx.$('picker-pool').innerHTML = '<div class="picker-tools"><input id="allstar-search" placeholder="搜索选手姓名" value="' + ctx.esc(query || '') + '"></div>' + candidates.map(function (p) {
      var best = bestVersionFor(p, pos);
      var ava = ctx.playerAvatarHtml(p.icon, p.name);
      return '<button class="pool-item" data-pid="' + ctx.esc(p.player_id) + '" data-name="' + ctx.esc(p.name.toLowerCase()) + '">' + ava + '<div><div class="pname">' + ctx.esc(p.name) + '</div>' +
        '<div class="pver">' + ctx.esc(best.label) + ' · ' + ctx.esc(best.team_name || '') + '</div></div><div class="prate">' + Math.round(best.rating) + '</div></button>';
    }).join('');
    ctx.$('allstar-search').addEventListener('input', function () {
      var value = this.value.trim().toLowerCase();
      ctx.$('picker-pool').querySelectorAll('.pool-item').forEach(function (el) {
        el.style.display = !value || (el.getAttribute('data-name') || '').indexOf(value) >= 0 ? '' : 'none';
      });
    });
    ctx.$('picker-pool').querySelectorAll('.pool-item').forEach(function (el) {
      el.addEventListener('click', function () { pickAllStarPlayer(el.getAttribute('data-pid'), pos); });
    });
  }

  function pickAllStarPlayer(pid, pos) {
    var p = ctx.DATA.allStar.players.find(function (x) { return x.player_id === pid; });
    var versions = (p.versions || []).filter(function (v) { return v.position === pos; })
      .sort(function (a, b) { return (b.year || 0) - (a.year || 0) || (b.rating || 0) - (a.rating || 0); });
    ctx.picker.pid = pid; ctx.picker.sid = versions[0].season_id; ctx.picker.teamFid = versions[0].team_fid;
    ctx.$('picker-pool').style.display = 'none'; ctx.$('picker-back').style.display = '';
    ctx.$('picker-title').textContent = p.name + ' · 选择版本';
    ctx.$('picker-sub').textContent = '直接上场，或用所选版本的能力创建自定义选手';
    ctx.$('picker-ver').innerHTML = versions.map(function (v, i) {
      return '<button class="vchip' + (i === 0 ? ' sel' : '') + '" data-sid="' + ctx.esc(v.season_id) + '" data-fid="' + ctx.esc(v.team_fid) + '">' +
        ctx.esc(v.label) + ' · ' + ctx.esc(v.team_name) + ' · ' + Math.round(v.rating) + '</button>';
    }).join('') + '<button class="custom-entry" id="allstar-custom">＋ 用这个版本创建自定义选手</button>';
    ctx.$('picker-confirm').style.display = '';
    ctx.$('picker-ver').querySelectorAll('.vchip').forEach(function (el) {
      el.addEventListener('click', function () {
        ctx.picker.sid = el.getAttribute('data-sid'); ctx.picker.teamFid = el.getAttribute('data-fid');
        ctx.$('picker-ver').querySelectorAll('.vchip').forEach(function (v) { v.classList.toggle('sel', v === el); });
      });
    });
    ctx.$('allstar-custom').addEventListener('click', renderCustomPlayerForm);
  }

  function renderCustomPlayerForm() {
    var templateName = ctx.playerName(ctx.picker.pid);
    ctx.$('picker-title').textContent = '创建自定义选手'; ctx.$('picker-back').style.display = '';
    ctx.$('picker-sub').textContent = '能力模板：' + templateName + ' · ' + ctx.picker.sid;
    ctx.$('picker-ver').innerHTML = '';
    ctx.$('picker-compare').innerHTML = '';
    ctx.$('picker-pool').style.display = '';
    ctx.$('picker-confirm').style.display = 'none';
    ctx.$('picker-pool').innerHTML = '<div class="custom-form"><div class="custom-note">自定义选手只替换姓名和头像，位置、战力与比赛数据继承所选职业版本。头像仅保存在当前设备。</div>' +
      '<label>选手姓名<input id="custom-name" maxlength="12" placeholder="输入你的名字"></label>' +
      '<label>默认头像</label><div class="default-avatars"><button class="default-avatar sel" data-src="assets/custom-avatar-male.webp" aria-label="选择默认头像一"><img src="assets/custom-avatar-male.webp" alt=""></button>' +
      '<button class="default-avatar" data-src="assets/custom-avatar-female.webp" aria-label="选择默认头像二"><img src="assets/custom-avatar-female.webp" alt=""></button></div>' +
      '<label>或上传头像<input id="custom-avatar" type="file" accept="image/*"></label>' +
      '<div class="avatar-editor"><canvas class="avatar-crop" id="avatar-crop" width="384" height="384"></canvas>' +
      '<div class="zoom-control"><span>缩小</span><input id="avatar-zoom" type="range" min="1" max="3" step="0.01" value="1"><span>放大</span></div>' +
      '<span class="mut" style="font-size:11px">拖动头像调整裁剪位置</span></div>' +
      '<button class="btn gold" id="custom-create">创建并上场</button></div>';
    var editor = setupAvatarEditor('assets/custom-avatar-male.webp');
    ctx.$('picker-pool').querySelectorAll('.default-avatar').forEach(function (el) {
      el.addEventListener('click', function () {
        ctx.$('picker-pool').querySelectorAll('.default-avatar').forEach(function (b) { b.classList.toggle('sel', b === el); });
        editor.load(el.getAttribute('data-src'));
      });
    });
    ctx.$('custom-avatar').addEventListener('change', function () {
      var file = this.files && this.files[0]; if (!file) return;
      readImageFile(file).then(function (data) {
        ctx.$('picker-pool').querySelectorAll('.default-avatar').forEach(function (b) { b.classList.remove('sel'); });
        editor.load(data);
      }).catch(function () { ctx.openConfirm('头像读取失败', '请选择常见的 JPG、PNG 或 WebP 图片。', null, '知道了'); });
    });
    ctx.$('custom-create').addEventListener('click', function () {
      var name = ctx.$('custom-name').value.trim();
      var avatarData = editor.output();
      if (!name || !avatarData) { ctx.openConfirm('资料未完成', '请输入姓名并选择或上传头像。', null, '知道了'); return; }
      var id = 'custom_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 10000);
      ctx.STATE.allStar.customs.push({ id: id, name: name, icon: avatarData, templatePid: ctx.picker.pid });
      applyAllStarSlot({ pid: id, templatePid: ctx.picker.pid, sid: ctx.picker.sid, teamFid: ctx.picker.teamFid });
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
    var canvas = ctx.$('avatar-crop'), ctx = canvas.getContext('2d'), zoom = ctx.$('avatar-zoom');
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
    var all = (ctx.STATE.allStar.aRoster || []).concat(ctx.STATE.allStar.bRoster || []);
    var current = ctx.STATE.allStar[ctx.picker.side + 'Roster'][ctx.picker.slot];
    var duplicate = all.some(function (s) { return s && s.pid === slot.pid && (!current || s.pid !== current.pid); });
    if (duplicate) { ctx.openConfirm('已在阵容中', '同一选手不能在双方重复上场。', null, '知道了'); return; }
    var roster = ctx.STATE.allStar[ctx.picker.side + 'Roster'].slice();
    while (roster.length < 5) roster.push(null);
    roster[ctx.picker.slot] = slot; ctx.STATE.allStar[ctx.picker.side + 'Roster'] = roster;
    ctx.recordAchievementEvent('rosterEdits');
    ctx.D.loadSeasons([slot.sid]).then(function () { ctx.saveState(); renderAllStar(); closePicker(); })
      .catch(function () { ctx.saveState(); renderAllStar(); closePicker(); });
  }

  function confirmAllStarPicker() {
    if (!ctx.picker.pid || !ctx.picker.sid) return;
    applyAllStarSlot({ pid: ctx.picker.pid, sid: ctx.picker.sid, teamFid: ctx.picker.teamFid });
  }

  /* 模拟页：按曲名选择对局 BGM */
  function showTrackPicker() {
    ctx.$('picker-title').textContent = '选择对局音乐';
    ctx.$('picker-sub').textContent = '点击曲目立即切换';
    var names = BGM.getTrackNames() || [];
    var cur = BGM.getTrackIndex();
    ctx.$('picker-ver').innerHTML = '';
    ctx.$('picker-compare').innerHTML = '';
    ctx.$('picker-pool').innerHTML = names.map(function (n, i) {
      var playing = i === cur;
      return '<button class="pool-item' + (playing ? ' sel' : '') + '" data-i="' + i + '">' +
        '<div class="ava" style="background:linear-gradient(135deg,#f0b90b,#ff7b3d)">♪</div>' +
        '<div><div class="pname">' + ctx.esc(n) + '</div>' +
        '<div class="pver">' + (playing ? '正在播放' : '点击切换') + '</div></div>' +
        '<div class="prate">' + (playing ? '▶' : '›') + '</div></button>';
    }).join('');
    ctx.$('picker-pool').querySelectorAll('.pool-item').forEach(function (el) {
      el.addEventListener('click', function () {
        BGM.playTrack(parseInt(el.getAttribute('data-i'), 10));
        ctx.$('sim-track-btn').textContent = '🎵 ' + (BGM.getTrackName() || '');
        closePicker();
      });
    });
    ctx.$('picker-confirm').style.display = 'none';
    ctx.$('drawer').classList.add('show');
    ctx.$('drawer-mask').classList.add('show');
  }

  /* 模拟中"更换阵容"：先选要换的位置 */
  function showPosPicker() {
    ctx.$('picker-title').textContent = '更换阵容 · 选择位置';
    ctx.$('picker-sub').innerHTML = ctx.teamBadgeHtml(ctx.STATE.team) + ' <span>' + ctx.esc(ctx.teamName(ctx.STATE.team)) + '</span>';
    ctx.$('picker-ver').innerHTML = '';
    ctx.$('picker-compare').innerHTML = '';
    ctx.$('picker-pool').innerHTML = ctx.POS_ORDER.map(function (pos, i) {
      var slot = ctx.STATE.roster[i];
      var name = slot ? ctx.playerName(slot.pid) : '空位';
      var ava = slot ? ctx.esc(ctx.playerName(slot.pid)[0]) : '+';
      return '<button class="pool-item" data-i="' + i + '">' +
        '<div class="ava">' + ava + '</div>' +
        '<div><div class="pname">' + ctx.esc(pos) + '</div>' +
        '<div class="pver">当前：' + ctx.esc(name) + '</div></div>' +
        '<div class="prate">›</div></button>';
    }).join('');
    ctx.$('picker-pool').querySelectorAll('.pool-item').forEach(function (el) {
      el.addEventListener('click', function () {
        openPicker(parseInt(el.getAttribute('data-i'), 10));
      });
    });
    ctx.$('drawer').classList.add('show');
    ctx.$('drawer-mask').classList.add('show');
  }

  /* ================= 战场 ================= */
  function showSeason() {
    ctx.showPage('season');
    BGM.play('intro');
    ctx.$('season-team-name').textContent = ctx.STATE.team
      ? ((ctx.STATE.mode === 'budget' ? '接替 ' : '') + ctx.teamName(ctx.STATE.team) + ' · ' + ctx.STATE.roster.map(function (s) { return ctx.playerName(s.pid); }).join('、'))
      : '未组队';
    ctx.renderTacticPickers();
    renderSeasonList();
  }

  function renderSeasonList() {
    var byYear = {};
    ctx.DATA.manifest.seasons.forEach(function (s) {
      var y = s.year || 0;
      (byYear[y] = byYear[y] || []).push(s);
    });
    var years = Object.keys(byYear).sort(function (a, b) { return b - a; });
    var curYear = ctx.STATE.mode === 'budget' && !ctx.STATE.season ? 2026 : null;
    ctx.DATA.manifest.seasons.forEach(function (s) {
      if (s.season_id === ctx.STATE.season) curYear = s.year;
    });
    var html = years.map(function (y) {
      var items = byYear[y].map(function (s) {
        var sel = s.season_id === ctx.STATE.season ? ' sel' : '';
        var tags = [];
        tags.push(s.source === 'kpl' ? 'KPL' : (s.source === 'kcc' ? '挑战者杯' : '杯赛'));
        if (s.has_regular) tags.push('常规赛');
        if (s.playoff_type === 'double_elim') tags.push('双败');
        else if (s.playoff_type === 'single_elim') tags.push('单败');
        return '<button class="season-item' + sel + '" data-sid="' + s.season_id + '">' +
          '<div><div class="si-name">' + ctx.esc(s.name) + '</div>' +
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
    ctx.$('season-list').innerHTML = html;
    // 年份手风琴：默认只显示年份，点击展开/收起，一次只开一个
    ctx.$('season-list').querySelectorAll('.sg-year').forEach(function (el) {
      el.addEventListener('click', function () {
        var items = el.parentNode.querySelector('.sg-items');
        var wasOpen = items.style.display !== 'none';
        ctx.$('season-list').querySelectorAll('.season-group').forEach(function (g) {
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
    ctx.$('season-list').querySelectorAll('.season-item').forEach(function (el) {
      el.addEventListener('click', function () {
        ctx.STATE.season = el.getAttribute('data-sid');
        ctx.saveState();
        renderSeasonList();
      });
    });
    var canGo = !!(ctx.STATE.season && ctx.STATE.team && ctx.STATE.roster.length);
    ctx.$('season-go').disabled = !canGo;
  }

  /* ================= 模拟 ================= */
  /* 分阶段模拟：逐局 reveal，每轮后可换人 */

return {showTeam,renderDynastyStrip,loadDynasty,renderTeamStrip,loadTeamView,presetRoster,slotInfo,renderSlots,renderStrength,openPicker,renderPool,maxRatingFor,bestVersionFor,pickPlayer,signedDelta,renderPickerComparison,confirmPicker,closePicker,showBudget,showAllStar,renderAllStarTeamSelects,presetRosterFromData,allStarVersion,allStarRecord,allStarRecords,renderAllStar,changeAllStarTeam,openAllStarPicker,renderAllStarPool,pickAllStarPlayer,renderCustomPlayerForm,readImageFile,setupAvatarEditor,applyAllStarSlot,confirmAllStarPicker,showTrackPicker,showPosPicker,showSeason,renderSeasonList};
};
})(window);
