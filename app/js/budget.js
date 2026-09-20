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
    (data.allStar.players || []).forEach(function (player) {
      var versions = (player.versions || []).filter(function (v) {
        return v.year === 2026 && v.position === position && v.season_id === 'KPL2026S2' && (v.games || 0) >= 5;
      });
      if (!versions.length) return;
      versions.sort(function (a, b) { return b.rating - a.rating; });
      byId[player.player_id] = { pid: player.player_id, name: player.name, icon: player.icon,
        sid: versions[0].season_id, teamFid: versions[0].team_fid, rating: versions[0].rating };
    });
    var ranked = Object.keys(byId).map(function (id) { return byId[id]; })
      .sort(function (a, b) { return b.rating - a.rating; });
    if (ranked.length < 5) throw new Error(position + '可用选手不足 5 人');
    // 五档各抽一人，保证每局有高低价选择，而不把价格说成现实身价。
    var selectedFive = [];
    for (var tier = 0; tier < 5; tier++) {
      var start = Math.floor(ranked.length * tier / 5);
      var end = Math.max(start + 1, Math.floor(ranked.length * (tier + 1) / 5));
      var player = ranked[start + randomInt(end - start)];
      player = Object.assign({}, player, { price: 30 - tier * 4 });
      selectedFive.push(player);
    }
    return shuffle(selectedFive);
  }
  function status(message) { el('budget-status').textContent = message; }
  function total() {
    return POSITIONS.reduce(function (sum, position) { return sum + (lineup[position] ? lineup[position].price : 0); }, 0);
  }
  function avatar(player) {
    return player.icon ? '<img src="' + escapeHtml(player.icon) + '" alt="" loading="lazy" onerror="this.remove()">'
      : '<span aria-hidden="true">' + escapeHtml(player.name.slice(0, 1)) + '</span>';
  }
  function render() {
    el('budget-machine').innerHTML = POSITIONS.map(function (position) {
      var players = pool[position] || [];
      return '<section class="budget-reel"><h3>' + position + '</h3><div class="budget-candidates">' + players.map(function (p, i) {
        var chosen = lineup[position] && lineup[position].pid === p.pid;
        return '<button type="button" class="budget-player' + (chosen ? ' chosen' : '') + '" data-position="' + position + '" data-index="' + i + '" aria-label="' + escapeHtml(position + ' ' + p.name + ' ' + p.price + ' 金币' + (chosen ? ' 已入队' : '')) + '">' +
          '<span class="budget-avatar">' + avatar(p) + '</span><span class="budget-player-text"><b>' + escapeHtml(p.name) + '</b><small>' + escapeHtml(p.teamFid && data.names[p.teamFid] || '2026 夏季赛') + '</small></span><strong>' + p.price + ' <small>金币</small></strong></button>';
      }).join('') + '</div></section>';
    }).join('');
    el('budget-slots').innerHTML = POSITIONS.map(function (position) {
      var p = lineup[position];
      return '<button type="button" class="budget-slot' + (p ? ' filled' : '') + '" data-slot="' + position + '" aria-label="' + escapeHtml(position + (p ? ' ' + p.name + '，点击移除' : '，等待选手')) + '"><span class="budget-slot-avatar">' + (p ? avatar(p) : '+') + '</span><span class="budget-slot-text"><small>' + position + '</small><b>' + (p ? escapeHtml(p.name) : '拖入或点击选手') + '</b></span><strong>' + (p ? p.price + ' 金币' : '空位') + '</strong></button>';
    }).join('');
    el('budget-total').textContent = '已用 ' + total() + ' / 100 金币';
    el('budget-remaining').textContent = 100 - total();
    var complete = POSITIONS.every(function (position) { return !!lineup[position]; });
    el('budget-continue').disabled = !complete || !el('budget-team').value;
    el('budget-continue').textContent = complete ? '参加 2026 KPL 夏季赛 →' : '选满五人后参赛';
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
    if (spinning || !data.allStar) return;
    spinning = true;
    el('budget-spin').disabled = true;
    el('budget-machine').classList.add('spinning');
    status('选手头像翻动中…');
    // 候选池先确定，翻动仅是揭晓动画，不影响抽取规则。
    var nextPool = {};
    try { POSITIONS.forEach(function (position) { nextPool[position] = candidatesFor(position); }); }
    catch (error) { spinning = false; el('budget-spin').disabled = false; status(error.message); return; }
    lineup = {};
    var finish = function () {
      pool = nextPool; lineup = {}; selected = null; spinning = false;
      el('budget-spin').disabled = false;
      el('budget-machine').classList.remove('spinning');
      status('候选已揭晓。拖动头像到首发位置，或点击选手直接签入。再次抽取会清空当前阵容。');
      render();
    };
    if (global.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else {
      var frames = 0;
      var ticker = setInterval(function () {
        POSITIONS.forEach(function (position) { pool[position] = candidatesFor(position); });
        render(); frames++;
        if (frames >= 6) { clearInterval(ticker); finish(); }
      }, 135);
    }
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
    el('budget-team').innerHTML = '<option value="">正在加载参赛战队…</option>';
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
    if (!data.allStar) {
      status('正在加载选手库…'); el('budget-spin').disabled = true;
      Promise.all([global.KPL_DATA.loadAllStar(), global.KPL_DATA.loadSeason('KPL2026S2')]).then(function (loaded) {
        var participants = {};
        (loaded[1].rounds || []).forEach(function (round) { (round.matches || []).forEach(function (match) {
          participants[match.a_id] = true; participants[match.b_id] = true;
        }); });
        el('budget-team').innerHTML = (data.manifest.teams2026 || []).filter(function (team) { return participants[team.id]; }).map(function (team) {
          return '<option value="' + escapeHtml(team.id) + '">' + escapeHtml(team.name) + '</option>';
        }).join('');
        el('budget-spin').disabled = false; status('拉动手柄，抽取五路候选。'); render();
      }).catch(function (error) { status('选手库加载失败：' + error.message); });
    }
    render();
  }
  global.KPL_BUDGET = { init: init, show: show };
})(window);
