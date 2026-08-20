/**
 * KPL 2K BGM manager v2
 *
 * 重写依据（社区/浏览器最佳实践）：
 *  1. 全局只保留一个 <audio> 单例；SPA 内部导航（首页→选手→战场）只换视图，
 *     绝不重建、绝不重播。同场景重复 play() 一律 no-op。
 *  2. 切歌 = pause() → 改 src → load() → play()；play() 返回的 Promise 必须
 *     catch（快速连切时旧请求会被 AbortError 打断，忽略即可，不能影响后续）。
 *  3. 用单调递增的 seq 标记“最新请求”：过期请求的 then / 淡入定时器全部作废，
 *     防止旧歌回调清掉当前歌曲的淡入导致“切一次后无声”。
 *  4. 静音 ≠ 暂停：用 volume=0 继续播放，取消静音立即有声，永不卡在 pending。
 *
 * 用法（与 ui.js 保持一致）：
 *   BGM.init({ intro, battle, battleDefault, champion })
 *   BGM.play('intro' | 'battle' | 'champion', team?)
 *   BGM.nextTrack() / BGM.prevTrack() / BGM.playTrack(i)
 *   BGM.setMuted(bool) / BGM.setVolume(0..1) / BGM.unlock()
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'kpl2k_bgm_muted';
  var TRACK_KEY = 'kpl2k_bgm_track';
  var VOLUME_KEY = 'kpl2k_bgm_volume';
  var DEFAULT_VOLUME = 0.6;
  var FADE_MS = 300;

  var scenes = {
    intro: { src: [], loop: true },
    battle: { tracks: [], loop: true }, // [{ name, src }]
    champion: { src: [], teamTracks: {}, loop: false }
  };

  var audio = null;      // 唯一共享 audio 元素（单例）
  var current = null;    // 当前场景 key
  var activeTeam = null; // champion 场景对应的战队
  var pending = null;    // 解锁前挂起的请求 { key, team }
  var trackIndex = 0;    // 当前对局曲目下标
  var muted = false;
  var volume = DEFAULT_VOLUME;
  var unlocked = false;
  var seq = 0;           // 请求序号：每次切歌 +1，旧回调一律作废
  var fadeTimer = null;  // 当前淡入定时器（全局只有一个）
  var startCount = 0;    // 调试：真正重建/切换音源的次数

  function baseName(p) {
    return String(p).split('/').pop().replace(/\.[^.]+$/, '');
  }

  function normalizeTracks(list) {
    return (list || []).map(function (t) {
      if (t && typeof t === 'object') {
        return { name: String(t.name || baseName(t.src)), src: t.src };
      }
      return { name: baseName(t), src: t };
    });
  }

  function candidates(sceneKey) {
    var cfg = scenes[sceneKey];
    if (!cfg) return [];
    if (sceneKey === 'battle') {
      if (!cfg.tracks.length) return ['assets/audio/battle1.m4a'];
      var i = ((trackIndex % cfg.tracks.length) + cfg.tracks.length) % cfg.tracks.length;
      return [cfg.tracks[i].src];
    }
    if (sceneKey === 'champion') {
      var teamSrcs = activeTeam && cfg.teamTracks[activeTeam];
      var out = teamSrcs ? [].concat(teamSrcs) : [].concat(cfg.src);
      if (!out.length) out.push('assets/audio/champion.m4a');
      return out;
    }
    var list = (cfg.src || []).slice();
    if (!list.length) list.push('assets/audio/' + sceneKey + '.m4a');
    return list;
  }

  function makeAudio() {
    var el = new Audio();
    el.preload = 'auto';
    return el;
  }

  function stopFade() {
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  }

  /**
   * 切歌统一入口（同步生效，不依赖异步淡出链）：
   * pause → 改 src → load → play；play 挂起时被 pause 打断会以 AbortError
   * reject，这是正常的，catch 忽略即可。
   */
  function switchTo(sceneKey, team) {
    seq += 1;               // 作废所有旧请求的异步回调
    var my = seq;
    startCount += 1;
    activeTeam = (sceneKey === 'champion') ? (team || null) : null;
    stopFade();

    var srcList = candidates(sceneKey);
    if (!srcList.length) { current = sceneKey; return; }

    if (!audio) audio = makeAudio();
    var el = audio;
    el.pause();
    var idx = 0;
    el.onerror = function () {
      if (my !== seq) return; // 旧请求的加载结果作废
      idx += 1;
      if (idx >= srcList.length) return;
      el.src = srcList[idx];
      el.load();
      if (unlocked) startPlayback(el, my);
    };
    el.loop = !!scenes[sceneKey].loop;
    el.src = srcList[0];
    el.load();
    current = sceneKey;

    if (!unlocked) {
      pending = { key: sceneKey, team: team };
      return;
    }
    startPlayback(el, my);
  }

  /** 真正触发 play()；必须 catch，否则快速连切会抛未捕获的 AbortError。 */
  function startPlayback(el, my) {
    if (my !== seq || audio !== el) return; // 已被更新的请求覆盖
    var p = el.play();
    if (p && typeof p.then === 'function') {
      p.then(function () { fadeIn(el, my); });
      p.catch(function () {
        // AbortError：play() 被 pause()/换源打断，属正常；忽略即可
        // NotAllowedError：浏览器自动播放限制，等用户手势后由 unlock 重试
      });
    } else {
      fadeIn(el, my);
    }
  }

  /** 淡入到目标音量；seq 变了说明已切歌，立即停表。 */
  function fadeIn(el, my) {
    if (my !== seq || audio !== el) return;
    if (muted) { el.volume = 0; return; } // 静音时保持无声播放
    stopFade();
    el.volume = 0;
    var step = volume / (FADE_MS / 30);
    fadeTimer = setInterval(function () {
      if (my !== seq || audio !== el) { stopFade(); return; }
      if (el.volume + step >= volume) {
        stopFade();
        el.volume = volume;
      } else {
        el.volume += step;
      }
    }, 30);
  }

  var BGM = {
    /**
     * @param {Object} opts {
     *   intro: path|array,
     *   battle: [{name,src}...],
     *   battleDefault: number,
     *   champion: { default, byTeam }
     * }
     */
    init: function (opts) {
      opts = opts || {};
      if (opts.intro) scenes.intro.src = [].concat(opts.intro);
      if (opts.battle) scenes.battle.tracks = normalizeTracks([].concat(opts.battle));
      if (opts.champion) {
        if (typeof opts.champion === 'string' || Array.isArray(opts.champion)) {
          scenes.champion.src = [].concat(opts.champion);
          scenes.champion.teamTracks = {};
        } else if (opts.champion && typeof opts.champion === 'object') {
          scenes.champion.src = [].concat(opts.champion.default || []);
          scenes.champion.teamTracks = opts.champion.byTeam || {};
        }
      }
      try {
        muted = localStorage.getItem(STORAGE_KEY) === '1';
        var savedVol = parseFloat(localStorage.getItem(VOLUME_KEY));
        if (!isNaN(savedVol) && savedVol >= 0 && savedVol <= 1) volume = savedVol;
        var saved = parseInt(localStorage.getItem(TRACK_KEY), 10);
        if (!isNaN(saved) && saved >= 0) trackIndex = saved;
        else if (typeof opts.battleDefault === 'number' && opts.battleDefault >= 0) trackIndex = opts.battleDefault;
      } catch (e) { /* localStorage 不可用时用默认值 */ }
    },

    /**
     * 切到某个场景。同一场景重复调用完全 no-op（SPA 导航不重播不中断）；
     * 仅当音频异常暂停时静默续播（不从头播）。
     */
    play: function (sceneKey, team) {
      if (!scenes[sceneKey]) return;
      team = team || null;
      var sameScene = current === sceneKey && audio &&
        (sceneKey !== 'champion' || activeTeam === team);
      if (sameScene) {
        pending = null;
        if (unlocked && !muted && audio.paused) startPlayback(audio, seq);
        return;
      }
      if (unlocked) {
        switchTo(sceneKey, team);
      } else {
        pending = { key: sceneKey, team: team }; // 首次用户手势后恢复
      }
    },

    /** 首个用户手势调用；只解锁一次，之后任意点击都不得再触碰音频。 */
    unlock: function () {
      if (unlocked) return;
      unlocked = true;
      if (pending) {
        var key = pending.key;
        var team = pending.team;
        pending = null;
        switchTo(key, team);
      } else if (current && audio && audio.paused && !muted) {
        startPlayback(audio, seq);
      }
    },

    stop: function () {
      pending = null;
      stopFade();
      if (audio) { audio.pause(); audio.currentTime = 0; }
      current = null;
      activeTeam = null;
    },

    setMuted: function (m) {
      muted = !!m;
      try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (audio) audio.volume = muted ? 0 : volume;
    },

    isMuted: function () { return muted; },

    setVolume: function (v) {
      volume = Math.min(1, Math.max(0, v));
      try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch (e) { /* ignore */ }
      if (audio && !muted) audio.volume = volume;
    },

    getVolume: function () { return volume; },
    getScene: function () { return current; },
    getTeam: function () { return activeTeam; },

    nextTrack: function () { return switchTrack(1); },
    prevTrack: function () { return switchTrack(-1); },

    getTrackIndex: function () {
      var n = scenes.battle.tracks.length;
      return n ? ((trackIndex % n) + n) % n : -1;
    },

    getTrackCount: function () {
      return scenes.battle.tracks.length;
    },

    getTrackName: function () {
      var i = this.getTrackIndex();
      if (i < 0) return null;
      return scenes.battle.tracks[i].name;
    },

    getTrackNames: function () {
      return scenes.battle.tracks.map(function (t) { return t.name; });
    },

    /** 切到指定对局曲目（0 起）；在任意时刻都可切，每次都会真正生效。 */
    playTrack: function (i) {
      var n = scenes.battle.tracks.length;
      if (!n) return -1;
      i = ((i % n) + n) % n;
      trackIndex = i;
      try { localStorage.setItem(TRACK_KEY, String(trackIndex)); } catch (e) { /* ignore */ }
      if (unlocked) switchTo('battle');
      else pending = { key: 'battle', team: null };
      return trackIndex;
    },

    /** 只读调试状态（生产无害）。 */
    _debug: function () {
      return {
        current: current,
        startCount: startCount,
        audioPaused: audio ? audio.paused : null,
        trackIndex: trackIndex,
        unlocked: unlocked
      };
    }
  };

  function switchTrack(delta) {
    var n = scenes.battle.tracks.length;
    if (!n) return -1;
    trackIndex = ((trackIndex + delta) % n + n) % n;
    try { localStorage.setItem(TRACK_KEY, String(trackIndex)); } catch (e) { /* ignore */ }
    if (unlocked) switchTo('battle');
    else pending = { key: 'battle', team: null };
    return trackIndex;
  }

  global.BGM = BGM;
})(window);
