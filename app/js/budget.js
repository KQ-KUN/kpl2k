/* 100 金币组队：独立选人界面，阵容交给经典模式的赛事模拟。 */
(function (global) {
  'use strict';
  var POSITIONS = ['对抗路', '打野', '中路', '发育路', '游走'];
  var pool = {}, lineup = {}, selected = null, spinning = false, drag = null, suppressClick = false;
  var data, onContinue;
  function el(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function randomInt(max) { return Math.floor(Math.random() * max); }
  function shuffle(items) {
    var out = items.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = randomInt(i + 1), temp = out[i]; out[i] = out[j]; out[j] = temp;
    }
    return out;
  }
  function candidatesFor(position) {
    var byId = {};
    ((data.seasonCache.KPL2026S2 || {}).rosters || []).forEach(function (record) {
      if (record.position !== position || (record.games || 0) < 5) return;
      var player = data.players[record.player_id] || {};
      var candidate = { pid: record.player_id, name: player.name || record.player_id,
        icon: player.icon, sid: record.season_id, teamFid: record.team_franchise, rating: record.rating };
      if (!byId[record.player_id] || candidate.rating > byId[record.player_id].rating) byId[record.player_id] = candidate;
    });
    var ranked = Object.keys(byId).map(function (id) { return byId[id]; })
      .sort(function (a, b) { return b.rating - a.rating; });
    if (ranked.length < 5) throw new Error(position + '可用选手不足 5 人');
    // 五档各抽一人；价带彼此重叠，让明星偶尔成为价值签，整池均价仍约 20 金币。
    var selectedFive = [];
    var priceBands = [[22, 32], [18, 25], [16, 23], [13, 20], [10, 17]];
    for (var tier = 0; tier < 5; tier++) {
      var start = Math.floor(ranked.length * tier / 5);
      var end = Math.max(start + 1, Math.floor(ranked.length * (tier + 1) / 5));
      var player = ranked[start + randomInt(end - start)];
      var band = priceBands[tier];
      player = Object.assign({}, player, { price: band[0] + randomInt(band[1] - band[0] + 1) });
      selectedFive.push(player);
    }
    return shuffle(selectedFive);
  }
  function status(message) { el('budget-status').textContent = message; }
  function total() {
    return POSITIONS.reduce(function (sum, position) { return sum + (lineup[position] ? lineup[position].price : 0); }, 0);
  }
  function renderDuos() {
    var starters = POSITIONS.map(function (position) { return lineup[position]; }).filter(Boolean);
    var detail = KPL_ENGINE.budgetDuoBonus(starters, data.budgetPairs);
    var names = {};
    starters.forEach(function (p) { names[p.pid] = p.name; });
    el('budget-duos').textContent = detail.pairs.length
      ? '同队搭档：' + detail.pairs.map(function (p) { return names[p.a] + ' + ' + names[p.b]; }).join('、') +
        ' · 战力 +' + detail.bonus + '（最多 +5）'
      : '同季同队各出场至少 20 局：战力 +1.5；每多合作一季再 +0.25，全队最多 +5。';
  }
  function avatar(player) {
    return player.icon ? '<img src="' + escapeHtml(player.icon) + '" alt="" loading="lazy" onerror="this.remove()">'
      : '<span aria-hidden="true">' + escapeHtml(player.name.slice(0, 1)) + '</span>';
  }
  function render() {
    el('budget-machine').innerHTML = POSITIONS.map(function (position) {
      var players = pool[position] || [];
      var cards = players.length ? players.map(function (p, i) {
        var chosen = lineup[position] && lineup[position].pid === p.pid;
        return '<button type="button" class="budget-player' + (chosen ? ' chosen' : '') + '" data-position="' + position + '" data-index="' + i + '" aria-label="' + escapeHtml(position + ' ' + p.name + ' ' + p.price + ' 金币' + (chosen ? ' 已入队' : '')) + '">' +
          '<span class="budget-avatar">' + avatar(p) + '</span><span class="budget-player-text"><b>' + escapeHtml(p.name) + '</b><small>' + p.price + '金币</small></span></button>';
      }).join('') : Array.from({ length: 5 }, function () {
        return '<div class="budget-player placeholder" aria-hidden="true"><span class="budget-avatar">?</span><span class="budget-player-text"><b>待抽取</b></span></div>';
      }).join('');
      return '<section class="budget-reel"><h3>' + position + '</h3><div class="budget-candidates">' + cards + '</div></section>';
    }).join('');
    el('budget-slots').innerHTML = POSITIONS.map(function (position) {
      var p = lineup[position];
      return '<button type="button" class="budget-slot' + (p ? ' filled' : '') + '" data-slot="' + position + '" aria-label="' + escapeHtml(position + (p ? ' ' + p.name + '，点击移除' : '，等待选手')) + '"><span class="budget-slot-avatar">' + (p ? avatar(p) : '+') + '</span><span class="budget-slot-text"><small>' + position + '</small><b>' + (p ? escapeHtml(p.name) : '拖入或点击选手') + '</b></span><strong>' + (p ? p.price + ' 金币' : '空位') + '</strong></button>';
    }).join('');
    el('budget-total').textContent = '已用 ' + total() + ' / 100 金币';
    el('budget-remaining').textContent = 100 - total();
    renderDuos();
    var complete = POSITIONS.every(function (position) { return !!lineup[position]; });
    el('budget-continue').disabled = !complete || !el('budget-team').value;
    el('budget-continue').textContent = complete ? '确认阵容 · 选择战场 →' : '选满五人后选择战场';
  }
  function choose(position, index) {
    var player = (pool[position] || [])[index];
    if (!player) return;
    var duplicated = POSITIONS.some(function (pos) { return pos !== position && lineup[pos] && lineup[pos].pid === player.pid; });
    if (duplicated) { status(player.name + '已在其他位置，不能重复上场。'); return; }
    var nextTotal = total() - (lineup[position] ? lineup[position].price : 0) + player.price;
    if (nextTotal > 100) { status('金币不足：还需要 ' + (nextTotal - 100) + ' 金币。请更换一名选手。'); return; }
    lineup[position] = player;
    selected = null;
    status('已签下' + position + ' · ' + player.name + '，剩余 ' + (100 - nextTotal) + ' 金币。');
    render();
  }
  function spin() {
    if (spinning || !data.seasonCache.KPL2026S2 || !data.budgetPairs) return;
    spinning = true;
    el('budget-spin').disabled = true;
    el('budget-spin').classList.add('pulling');
    status('正在拉下手柄…');
    // 候选池先确定，翻动仅是揭晓动画，不影响抽取规则。
    var nextPool = {};
    try { POSITIONS.forEach(function (position) { nextPool[position] = candidatesFor(position); }); }
    catch (error) { spinning = false; el('budget-spin').disabled = false; el('budget-spin').classList.remove('pulling'); status(error.message); return; }
    lineup = {};
    var finish = function () {
      pool = nextPool; lineup = {}; selected = null; spinning = false;
      el('budget-spin').disabled = false;
      el('budget-spin').classList.remove('pulling');
      el('budget-machine').classList.remove('spinning');
      status('候选已揭晓。拖动头像到首发位置，或点击选手直接签入。再次抽取会清空当前阵容。');
      render();
    };
    var reducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(function () {
      if (reducedMotion) { finish(); return; }
      status('选手头像翻动中…');
      el('budget-machine').classList.add('spinning');
      var frames = 0;
      var ticker = setInterval(function () {
        POSITIONS.forEach(function (position) { pool[position] = candidatesFor(position); });
        render(); frames++;
        if (frames >= 6) { clearInterval(ticker); finish(); }
      }, 135);
    }, reducedMotion ? 650 : 900);
  }
  function pointerDown(event) {
    var button = event.target.closest('.budget-player');
    if (!button || event.button !== 0) return;
    selected = { position: button.dataset.position, index: Number(button.dataset.index) };
    drag = { x: event.clientX, y: event.clientY, moved: false, pointerId: event.pointerId };
    button.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId || !selected) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
    drag.moved = true;
    var p = pool[selected.position][selected.index];
    var ghost = el('budget-drag-ghost');
    if (!ghost) {
      ghost = document.createElement('div'); ghost.id = 'budget-drag-ghost'; ghost.className = 'budget-drag-ghost';
      ghost.innerHTML = '<span class="budget-avatar">' + avatar(p) + '</span><b>' + escapeHtml(p.name) + '</b>';
      document.body.appendChild(ghost);
    }
    ghost.style.left = event.clientX + 'px'; ghost.style.top = event.clientY + 'px';
  }
  function pointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId || !selected) return;
    var wasMoved = drag.moved;
    var hit = document.elementFromPoint(event.clientX, event.clientY);
    var slot = hit && hit.closest('.budget-slot');
    var current = selected;
    drag = null;
    var ghost = el('budget-drag-ghost'); if (ghost) ghost.remove();
    if (wasMoved) {
      event.preventDefault();
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
      if (slot && slot.dataset.slot === current.position) choose(current.position, current.index);
      else status('请把头像拖到对应位置：' + current.position + '。');
    }
  }
  function init(baseData, callback) {
    data = baseData; onContinue = callback;
    el('budget-team').innerHTML = (data.manifest.teams2026 || []).map(function (team) {
      return '<option value="' + escapeHtml(team.id) + '">' + escapeHtml(team.name) + '</option>';
    }).join('');
    el('budget-spin').addEventListener('click', spin);
    el('budget-team').addEventListener('change', render);
    el('budget-machine').addEventListener('pointerdown', pointerDown);
    el('budget-machine').addEventListener('pointermove', pointerMove);
    el('budget-machine').addEventListener('pointerup', pointerUp);
    el('budget-machine').addEventListener('pointercancel', function () { drag = null; var ghost = el('budget-drag-ghost'); if (ghost) ghost.remove(); });
    el('budget-machine').addEventListener('click', function (event) {
      var button = event.target.closest('.budget-player');
      if (button && !event.defaultPrevented && !suppressClick && !spinning) choose(button.dataset.position, Number(button.dataset.index));
    });
    el('budget-slots').addEventListener('click', function (event) {
      var button = event.target.closest('.budget-slot');
      if (!button) return;
      var position = button.dataset.slot;
      if (lineup[position]) { delete lineup[position]; status('已移除' + position + '选手。'); render(); }
    });
    el('budget-continue').addEventListener('click', function () {
      if (this.disabled || !POSITIONS.every(function (position) { return !!lineup[position]; })) return;
      onContinue({ team: el('budget-team').value, roster: POSITIONS.map(function (position) {
        return { pid: lineup[position].pid, sid: lineup[position].sid };
      }), total: total() });
    });
    render();
  }
  function show() {
    if (!data.seasonCache.KPL2026S2 || !data.budgetPairs) {
      status('正在加载选手库…'); el('budget-spin').disabled = true;
      Promise.all([global.KPL_DATA.loadSeason('KPL2026S2'), global.KPL_DATA.loadBudgetPairs()]).then(function () {
        el('budget-spin').disabled = false; status('拉动手柄，抽取五路候选。'); render();
      }).catch(function (error) { status('选手库加载失败：' + error.message); });
    }
    render();
  }
  global.KPL_BUDGET = { init: init, show: show };
})(window);
