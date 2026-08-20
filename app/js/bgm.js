/**
 * KPL 2K BGM manager v1
 *
 * Scene -> audio file mapping (audio files are user-provided; missing files
 * are skipped silently so the game never breaks):
 *   intro    -> 巅峰对决 (home page, single track)
 *   battle   -> 王者大厅 BGM (season simulation / match reports)
 *               multiple tracks with names; player can pick by name
 *   champion -> 战歌 (championship celebration; per-team tracks supported)
 *
 * Usage:
 *   BGM.init({
 *     intro: 'assets/audio/intro.m4a',
 *     battle: [{ name: '云梦谣', src: 'assets/audio/云梦谣.m4a' }, ...],
 *     champion: { default: 'assets/audio/champion.m4a', byTeam: { '成都AG超玩会': 'assets/audio/champion_ag.m4a' } }
 *   });
 *   BGM.play('intro');      // switch to a scene, stops the previous one
 *   BGM.play('champion', '成都AG超玩会');  // per-team champion anthem
 *   BGM.nextTrack();         // battle scene only: switch to next BGM
 *   BGM.playTrack(i);        // battle scene only: play a specific track by index
 *   BGM.getTrackIndex();
 *   BGM.getTrackName();
 *   BGM.stop();
 *   BGM.setMuted(true);     // persist via localStorage
 *
 * Mobile autoplay: browsers block audio until a user gesture. Call BGM.unlock()
 * from the first tap/click handler; any pending play() is resumed there.
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
    battle: { tracks: [], loop: true },  // [{ name, src }]
    champion: { src: [], teamTracks: {}, loop: false }
  };

  var audio = null;        // single shared <audio>, one scene at a time
  var current = null;      // active scene key
  var activeTeam = null;   // team key for the active champion track
  var pending = null;      // { key, team } requested before user gesture
  var lastRequested = null; // most recent scene request, for unlock fallback
  var trackIndex = 0;      // active battle BGM index
  var muted = false;
  var volume = DEFAULT_VOLUME;
  var unlocked = false;
  var fading = false;
  var fadeInTimer = null;
  var switchSeq = 0;       // monotonically increasing switch id; stale fades abort
  var startCount = 0;      // debug: 音频重建次数（同场景重复 play 不应增加）

  function makeAudio() {
    var el = new Audio();
    el.preload = 'auto';
    el.volume = muted ? 0 : volume;
    return el;
  }

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
      var t = ((trackIndex % cfg.tracks.length) + cfg.tracks.length) % cfg.tracks.length;
      return [cfg.tracks[t].src];
    }
    if (sceneKey === 'champion') {
      var teamSrcs = activeTeam && cfg.teamTracks[activeTeam];
      var out = teamSrcs ? [].concat(teamSrcs) : [].concat(cfg.src);
      if (!out.length) out.push('assets/audio/champion.m4a');
      return out;
    }
    var out = (cfg.src || []).slice();
    // Fall back to a well-known default path if the scene was configured
    // without explicit src.
    if (!out.length) out.push('assets/audio/' + sceneKey + '.m4a');
    return out;
  }

  function fadeOut(cb) {
    var mySeq = ++switchSeq;
    var done = function () {
      if (mySeq !== switchSeq) return; // a newer switch won
      cb();
    };
    if (!audio || audio.paused) { done(); return; }
    if (fading) { done(); return; }
    fading = true;
    if (fadeInTimer) { clearInterval(fadeInTimer); fadeInTimer = null; }
    var a = audio;
    var step = a.volume / (FADE_MS / 30);
    var timer = setInterval(function () {
      if (a.volume - step <= 0) {
        clearInterval(timer);
        a.pause();
        a.currentTime = 0;
        fading = false;
        done();
      } else {
        a.volume = Math.max(0, a.volume - step);
      }
    }, 30);
  }

  function safePlay(a) {
    var p = a.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function () { /* autoplay blocked */ });
    }
  }

  function fadeIn(a) {
    a.volume = 0;
    var p = a.play();
    var onStarted = function () {
      if (fading || muted) return;
      if (fadeInTimer) clearInterval(fadeInTimer);
      var step = volume / (FADE_MS / 30);
      fadeInTimer = setInterval(function () {
        if (a.volume + step >= volume) {
          clearInterval(fadeInTimer);
          fadeInTimer = null;
          a.volume = volume;
        } else {
          a.volume += step;
        }
      }, 30);
    };
    if (p && typeof p.then === 'function') {
      p.then(onStarted).catch(function () { /* autoplay blocked: wait for unlock */ });
    } else {
      onStarted();
    }
  }

  function startScene(sceneKey, team) {
    // 注意：切歌（switchTrack/playTrack）也需要走这里重建音源，因此不能在此处挡同场景。
    // 同场景防重播由 play() 的 sameScene 分支保证。
    startCount += 1;
    switchSeq += 1;
    activeTeam = (sceneKey === 'champion') ? (team || null) : null;
    if (fadeInTimer) { clearInterval(fadeInTimer); fadeInTimer = null; }
    var srcList = candidates(sceneKey);
    if (!srcList.length) return;
    if (audio) { audio.pause(); audio.src = ''; }
    audio = makeAudio();
    audio.loop = !!scenes[sceneKey].loop;

    // Try candidates in order; first one that can load wins.
    var idx = 0;
    audio.addEventListener('error', function () {
      idx += 1;
      // 候选全失败时保持场景标记，避免下次 play() 把"同场景"误判为切换而重建音频
      if (idx >= srcList.length) { return; }
      audio.src = srcList[idx];
      audio.load();
    });
    audio.src = srcList[0];
    audio.load();
    current = sceneKey;

    if (unlocked) {
      if (muted) {
        // 静音时也保持"无声播放"，取消静音后立即有声（不依赖 pending，避免永久卡静音）
        audio.volume = 0;
        safePlay(audio);
      } else {
        fadeIn(audio);
      }
    } else {
      pending = { key: sceneKey, team: team };
    }
  }

  var BGM = {
    /**
     * Configure scene -> audio mapping.
     * @param {Object} opts {
     *   intro: 'path',
     *   battle: ['path1', 'path2'],
     *   battleDefault: 3,  // optional: default battle track index (0-based)
     *   champion: 'path' | { default: 'path', byTeam: { '成都AG超玩会': 'path' } }
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
        if (!isNaN(saved) && saved >= 0) {
          trackIndex = saved;
        } else if (typeof opts.battleDefault === 'number' && opts.battleDefault >= 0) {
          trackIndex = opts.battleDefault;
        }
      } catch (e) { /* localStorage unavailable */ }
    },

    /**
     * Play (or switch to) a scene. Stops the previous scene first.
     * For the champion scene, pass the winning team key to pick its anthem.
     */
    play: function (sceneKey, team) {
      if (!scenes[sceneKey]) return;
      lastRequested = { key: sceneKey, team: team || null };
      // 同一场景重复请求不重建音频（避免"继续征战"等操作把音乐重头播放）：
      // 仅在暂停时尝试恢复，不切换音源。
      var sameScene = current === sceneKey && audio && (sceneKey !== 'champion' || activeTeam === team);
      if (sameScene) {
        pending = null;
        // 同场景重复请求不重建；仅当音频意外暂停时静默恢复（不会重播）
        if (unlocked && !muted && audio.paused) safePlay(audio);
        return;
      }
      var doPlay = function () {
        fadeOut(function () { startScene(sceneKey, team); });
      };
      if (unlocked) doPlay();
      else pending = { key: sceneKey, team: team }; // resume on first user gesture
    },

    /**
     * Stop everything.
     */
    stop: function () {
      pending = null;
      if (audio) { audio.pause(); audio.currentTime = 0; }
      current = null;
      activeTeam = null;
    },

    /**
     * Call from the first user gesture (tap/click) to satisfy mobile
     * autoplay policies. Resumes any pending scene.
     */
    unlock: function () {
      // 只解锁一次：之后任何点击都不得再触碰音频（否则会反复 play() 导致重播/卡顿）
      if (unlocked) return;
      unlocked = true;
      if (muted) return;
      if (pending) {
        var key = pending.key;
        var team = pending.team;
        pending = null;
        startScene(key, team);
      } else if (current && audio && audio.paused) {
        safePlay(audio);
      }
    },

    setMuted: function (m) {
      muted = !!m;
      try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch (e) {}
      if (!audio) return;
      if (muted) {
        audio.volume = 0;   // 不暂停，仅静音；取消后立即恢复
      } else {
        audio.volume = volume;
        if (unlocked && audio.paused) safePlay(audio);
      }
    },

    isMuted: function () { return muted; },

    setVolume: function (v) {
      volume = Math.min(1, Math.max(0, v));
      try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch (e) {}
      if (audio && !muted) audio.volume = volume;
    },

    getVolume: function () { return volume; },

    getScene: function () { return current; },

    getTeam: function () { return activeTeam; },

    /**
     * Battle scene only: switch to the next BGM track. If battle music is
     * currently playing, restarts playback with the new track.
     */
    nextTrack: function () {
      return switchTrack(1);
    },

    /**
     * Battle scene only: switch to the previous BGM track.
     */
    prevTrack: function () {
      return switchTrack(-1);
    },

    getTrackIndex: function () {
      var n = scenes.battle.tracks.length;
      return n ? ((trackIndex % n) + n) % n : -1;
    },

    getTrackCount: function () {
      return scenes.battle.tracks.length;
    },

    /**
     * Battle scene only: current track name (for UI display).
     */
    getTrackName: function () {
      var t = this.getTrackIndex();
      if (t < 0) return null;
      return scenes.battle.tracks[t].name;
    },

    /**
     * Battle scene only: all track names, in play order.
     */
    getTrackNames: function () {
      return scenes.battle.tracks.map(function (t) { return t.name; });
    },

    /** 只读调试状态（生产无害） */
    _debug: function () {
      return {
        current: current,
        startCount: startCount,
        audioPaused: audio ? audio.paused : null,
        trackIndex: trackIndex,
        unlocked: unlocked
      };
    },

    /**
     * Battle scene only: play a specific track by index (0-based).
     */
    playTrack: function (i) {
      var n = scenes.battle.tracks.length;
      if (!n) return -1;
      i = ((i % n) + n) % n;
      trackIndex = i;
      try { localStorage.setItem(TRACK_KEY, String(trackIndex)); } catch (e) {}
      if (unlocked) {
        fadeOut(function () { startScene('battle'); });
      }
      return trackIndex;
    }
  };

  function switchTrack(delta) {
    var n = scenes.battle.tracks.length;
    if (!n) return -1;
    trackIndex = ((trackIndex + delta) % n + n) % n;
    try { localStorage.setItem(TRACK_KEY, String(trackIndex)); } catch (e) {}
    if (current === 'battle' && unlocked) {
      fadeOut(function () { startScene('battle'); });
    }
    return trackIndex;
  }

  global.BGM = BGM;
})(window);
