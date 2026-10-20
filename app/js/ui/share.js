/* share: injected coordination callbacks; no module imports or listener installation at load. */
(function(global){'use strict';
(global.KPL_UI_MODULES=global.KPL_UI_MODULES||{}).share=function(ctx){
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
    var run = ctx.STATE.lastRun || {};
    if (run.mode === 'allstar') {
      if (allStarHasCustom(run)) return '';
      return location.href.split('#')[0] + '#/a?' +
        'at=' + encodeURIComponent(run.aTeam) + '&bt=' + encodeURIComponent(run.bTeam) +
        '&bo=' + encodeURIComponent(ctx.STATE.allStar.bo || 5) +
        '&ar=' + packAllStarSlots(run.aRoster) + '&br=' + packAllStarSlots(run.bRoster) +
        '&seed=' + encodeURIComponent(run.seed) + '&tc=' + encodeURIComponent(run.tactic || ctx.STATE.tactic) + '&v=' + encodeURIComponent(ctx.buildVersion());
    }
    var rosterStr = ctx.STATE.roster.map(function (s) { return s.pid + '@' + s.sid; }).join(',');
    var url = location.href.split('#')[0] + '#/s?' +
      't=' + encodeURIComponent(ctx.STATE.team) +
      '&s=' + encodeURIComponent(ctx.STATE.season) +
      '&r=' + encodeURIComponent(rosterStr) +
      '&seed=' + ctx.STATE.seed + '&tc=' + encodeURIComponent(run.tactic || ctx.STATE.tactic) +
      '&v=' + encodeURIComponent(ctx.buildVersion());
    return url;
  }

  function copyShare() {
    var url = shareLink();
    function done() {
      ctx.$('share-tip').textContent = '链接已复制，发给好友即可还原这场平行时空';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(function () {
        fallbackCopy(url, done, function () { ctx.$('share-tip').textContent = '复制失败，请手动复制浏览器地址'; });
      });
    } else {
      fallbackCopy(url, done, function () { ctx.$('share-tip').textContent = '复制失败，请手动复制浏览器地址'; });
    }
  }
  function fallbackCopy(text, done, fail) {
    if (!text) { if (fail) fail(); return; }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var copied = false;
    try { copied = document.execCommand('copy') === true; } catch (e) { copied = false; }
    document.body.removeChild(ta);
    if (copied) done();
    else if (fail) fail();
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

  function loadShareAvatar(icon) {
    if (!icon) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var image = new Image();
      var timer = setTimeout(function () { finish(null); }, 8000);
      function finish(value) {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        resolve(value);
      }
      // 同源缓存和自定义 data URL 均可导出；外链必须通过 CORS，避免污染整张画布。
      image.crossOrigin = 'anonymous';
      image.referrerPolicy = 'no-referrer';
      image.onload = function () { finish(image.naturalWidth && image.naturalHeight ? image : null); };
      image.onerror = function () { finish(null); };
      image.src = icon;
    });
  }

  function drawShareAvatar(x, image, name, px, py, size) {
    x.save();
    x.beginPath();
    x.arc(px + size / 2, py + size / 2, size / 2, 0, Math.PI * 2);
    x.clip();
    x.fillStyle = '#203d5d';
    x.fillRect(px, py, size, size);
    if (image) {
      // 按 object-fit: cover 居中裁切，保留头像比例。
      var scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      var w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      x.drawImage(image, px + (size - w) / 2, py + (size - h) / 2, w, h);
    } else {
      x.fillStyle = '#e9f1fb'; x.font = '700 36px sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(name || '?').slice(0, 1), px + size / 2, py + size / 2);
    }
    x.restore();
  }


  async function renderShareImage() {
    var run = ctx.STATE.lastRun;
    if (!run || ctx.shareImagePending) return;
    var button = ctx.$('result-share'), buttonText = button.textContent;
    ctx.shareImagePending = true;
    button.disabled = true;
    button.textContent = '正在生成战绩卡…';
    try {
      var avatars = await Promise.all(run.records.map(function (r) {
        return loadShareAvatar(ctx.playerIcon(r.player_id));
      }));
      if (ctx.STATE.lastRun !== run || !ctx.$('result').classList.contains('active')) return;
      paintShareImage(run, avatars);
    } catch (error) {
      ctx.showStorageWarning('战绩卡生成失败，请重试。');
    } finally {
      ctx.shareImagePending = false;
      button.disabled = false;
      button.textContent = buttonText;
    }
  }

  function paintShareImage(run, avatars) {
    var W = 1080, P = 64;
    var rows = Math.min(run.path.length, 8);
    var H = 400 + run.records.length * 124 + 90 + rows * 86 + 120;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var x = cv.getContext('2d');

    var g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1a2e'); g.addColorStop(1, '#123052');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#f0b90b'; x.lineWidth = 6;
    x.strokeRect(26, 26, W - 52, H - 52);

    var isAllStar = run.mode === 'allstar';
    var team = isAllStar ? (run.aName + ' vs ' + run.bName) : ctx.teamName(run.team);
    x.textAlign = 'center';
    x.fillStyle = '#f0b90b';
    x.font = '900 58px sans-serif';
    x.fillText('KPL 2K · 战绩卡', W / 2, 122);
    x.fillStyle = '#8fa8cc';
    x.font = '30px sans-serif';
    x.fillText(run.seasonName + ' · ' + team + ' · ' + ctx.tacticName(run.tactic) + ' · 种子 ' + run.seed, W / 2, 178);

    var banner, color, bg;
    if (isAllStar) {
      var allStarWinner = run.champion === 'ALLSTAR_A' ? run.aName : run.bName;
      banner = '🏆 ' + allStarWinner + '获胜 · ' + run.score; color = '#3fb950'; bg = 'rgba(63,185,80,.16)';
    } else if (run.champion && ctx.teamName(run.champion) === team) {
      banner = '🏆 冠军'; color = '#3fb950'; bg = 'rgba(63,185,80,.16)';
    } else if (run.path.length && String(run.path[run.path.length - 1].round).indexOf('决赛') >= 0) {
      banner = '亚军'; color = '#8fa8cc'; bg = 'rgba(143,168,204,.16)';
    } else {
      banner = '赛季止步 · ' + ctx.runPlacement(run);
      color = '#f85149'; bg = 'rgba(248,81,73,.16)';
    }
    roundRectPath(x, W / 2 - 270, 216, 540, 96, 18);
    x.fillStyle = bg; x.fill();
    x.strokeStyle = color; x.lineWidth = 3; x.stroke();
    x.fillStyle = color; x.font = '700 42px sans-serif';
    x.fillText(banner, W / 2, 278);

    var achievementText = ctx.achievementTags(run).join(' · ');
    if (achievementText) {
      x.fillStyle = '#ffe08a'; x.font = '700 25px sans-serif';
      x.fillText(achievementText, W / 2, 352);
    }

    var y = 400;
    x.textAlign = 'left';
    x.fillStyle = '#f0b90b'; x.font = '800 34px sans-serif';
    x.fillText(isAllStar ? '双方阵容' : '阵容', P, y); y += 18;
    run.records.forEach(function (r, index) {
      y += 124;
      var name = ctx.playerName(r.player_id), textX = P + 104;
      drawShareAvatar(x, avatars[index], name, P, y - 72, 80);
      x.fillStyle = '#e9f1fb'; x.font = '700 36px sans-serif';
      x.fillText(name, textX, y - 32, 340);
      x.fillStyle = '#8fa8cc'; x.font = '28px sans-serif';
      var sideLabel = isAllStar ? (r.team_franchise === 'ALLSTAR_A' ? run.aName : run.bName) + ' · ' : '';
      x.textAlign = 'right';
      x.fillText(sideLabel + r.position, W - P, y - 32, 470);
      var rs = (run.runStats || {})[r.player_id];
      var kda = rs ? ctx.f1(rs.kda) : ctx.f1(r.avg_kda);
      var part = rs ? ctx.pct(rs.participation) : ctx.pct(r.avg_participation_rate);
      var mvp = rs ? rs.mvp : (r.mvp_count || 0);
      x.textAlign = 'left';
      x.fillStyle = '#f0b90b'; x.font = '600 28px sans-serif';
      x.fillText('KDA ' + kda + ' · 参团 ' + part + ' · MVP ' + mvp, textX, y + 10);
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

    ctx.$('share-img').src = cv.toDataURL('image/png');
    var canCopy = !!shareLink();
    ctx.$('share-copy').style.display = canCopy ? '' : 'none';
    ctx.$('share-copy').textContent = '复制链接';
    ctx.$('share-modal').querySelector('.sm-head').textContent = canCopy
      ? '长按图片保存，或下载后发到社群'
      : '自定义选手仅保存在当前设备，可下载本场战绩图';
    var missingAvatars = avatars.filter(function (avatar) { return !avatar; }).length;
    if (missingAvatars) {
      ctx.$('share-modal').querySelector('.sm-head').textContent += ' · ' + missingAvatars + ' 位选手头像未加载，已用姓名代替，可关闭后重试';
    }
    ctx.$('share-modal').classList.add('show');
    ctx.$('share-mask').classList.add('show');
  }

  function closeShareModal() {
    ctx.$('share-modal').classList.remove('show');
    ctx.$('share-mask').classList.remove('show');
  }


  function downloadShare() {
    var a = document.createElement('a');
    a.href = ctx.$('share-img').src;
    a.download = 'kpl2k-战绩卡.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    ctx.recordAchievementEvent('savedCards');
  }


return {allStarHasCustom,packAllStarSlots,shareLink,copyShare,fallbackCopy,roundRectPath,loadShareAvatar,drawShareAvatar,renderShareImage,paintShareImage,closeShareModal,downloadShare};
};
})(window);
