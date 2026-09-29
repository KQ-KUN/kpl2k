'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/js/ui.js'), 'utf8');
const start = source.indexOf('  function roundRectPath(');
const end = source.indexOf('  function closeShareModal(', start);
assert.ok(start >= 0 && end > start);

function fixture(run, options = {}) {
  const requests = [], draws = [], texts = [], timers = new Map(), warnings = [];
  let timerId = 0, exports = 0;
  const elements = {};
  function element(id) {
    if (!elements[id]) {
      const classes = new Set();
      elements[id] = {
        style: {}, textContent: id === 'result-share' ? '保存战绩卡' : '', src: '',
        disabled: false, classList: {
          add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value)
        },
        querySelector: () => element(id + '-head')
      };
    }
    return elements[id];
  }
  class TestImage {
    set src(value) { this.url = value; requests.push(this); }
  }
  const canvasContext = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'drawImage') return (...args) => draws.push(args);
      if (key === 'fillText') return (...args) => texts.push(args);
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => {};
    }
  });
  const context = {
    STATE: { lastRun: run }, Image: TestImage,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    $: element, playerIcon: pid => options.icons?.[pid] ?? 'assets/' + pid + '.webp',
    playerName: pid => options.names?.[pid] || pid,
    teamName: id => id, tacticName: () => '均衡应对', achievementTags: () => [],
    runPlacement: () => '季后赛', shareLink: () => run.mode === 'allstar' ? '' : '#/s',
    f1: value => Number(value || 0).toFixed(1), pct: value => Math.round((value || 0) * 100) + '%',
    showStorageWarning: value => warnings.push(value),
    document: { createElement() {
      if (options.canvasApi) return options.canvasApi.createCanvas(1080, 1000);
      return { getContext: () => canvasContext, toDataURL() {
        exports++;
        if (options.failExport) throw new Error('export failed');
        return 'data:image/png;base64,fixture';
      } };
    } }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  element('result').classList.add('active');
  return { context, requests, draws, texts, timers, warnings, element, exports: () => exports };
}

function runFixture(count = 5, mode = 'classic') {
  return {
    mode, team: 'AG', champion: mode === 'allstar' ? 'ALLSTAR_A' : 'AG',
    seasonName: '2026 夏季赛', seed: 12345, tactic: 'balanced',
    aName: '红方', bName: '蓝方', score: '3:2',
    records: Array.from({ length: count }, (_, i) => ({
      player_id: 'p' + i, position: ['对抗路', '打野', '中路', '发育路', '游走'][i % 5],
      team_franchise: i < 5 ? 'ALLSTAR_A' : 'ALLSTAR_B',
      avg_kda: 4, avg_participation_rate: .7, mvp_count: 1
    })),
    path: [{ round: '总决赛', opp: '广州TTG', score: '4:3', win: true }]
  };
}

function loaded(request, width = 120, height = 108) {
  request.naturalWidth = width; request.naturalHeight = height; request.onload();
}

async function regressions() {
  const f = fixture(runFixture());
  const pending = f.context.renderShareImage();
  assert.equal(f.element('result-share').disabled, true);
  await f.context.renderShareImage();
  assert.equal(f.requests.length, 5, 'Repeated clicks must not start a second export');
  assert.equal(f.exports(), 0, 'Export must wait for every avatar');
  f.requests.slice(1).reverse().forEach(request => loaded(request));
  assert.equal(f.exports(), 0, 'One pending avatar still blocks export');
  loaded(f.requests[0]); await pending;
  assert.equal(f.draws.length, 5);
  assert.deepEqual(f.draws.map(draw => draw[0].url), f.requests.map(request => request.url));
  assert.equal(f.exports(), 1);
  assert.equal(f.element('result-share').disabled, false);
  assert.equal(f.element('result-share').textContent, '保存战绩卡');
  assert.ok(f.element('share-modal').classList.contains('show'));
  assert.equal(f.timers.size, 0);
  f.requests.forEach(request => {
    assert.equal(request.crossOrigin, 'anonymous');
    assert.equal(request.referrerPolicy, 'no-referrer');
  });
  f.draws.forEach(draw => assert.equal(draw[3] / draw[4], 120 / 108, 'Portrait proportions must stay intact'));

  const allstar = fixture(runFixture(10, 'allstar'), { icons: { p0: 'data:image/jpeg;base64,custom' } });
  const allstarPending = allstar.context.renderShareImage();
  allstar.requests.forEach(request => loaded(request, 384, 384)); await allstarPending;
  assert.equal(allstar.draws.length, 10);
  assert.equal(allstar.draws[0][0].url, 'data:image/jpeg;base64,custom');
  assert.equal(allstar.element('share-copy').style.display, 'none');

  const missing = fixture(runFixture(3), { icons: { p0: '' } });
  const missingPending = missing.context.renderShareImage();
  missing.requests[0].onerror();
  [...missing.timers.values()].forEach(timeout => timeout());
  await missingPending;
  assert.equal(missing.exports(), 1, 'Missing or slow avatars must not strand the export');
  assert.equal(missing.draws.length, 0);
  assert.match(missing.element('share-modal-head').textContent, /3 位选手头像未加载/);
  assert.equal(missing.element('result-share').disabled, false);

  const failed = fixture(runFixture(1), { failExport: true });
  const failedPending = failed.context.renderShareImage();
  loaded(failed.requests[0]); await failedPending;
  assert.equal(failed.element('result-share').disabled, false);
  assert.equal(failed.warnings.length, 1);
  assert.equal(failed.element('share-modal').classList.contains('show'), false);

  const stale = fixture(runFixture(1));
  const stalePending = stale.context.renderShareImage();
  stale.context.STATE.lastRun = runFixture();
  loaded(stale.requests[0]); await stalePending;
  assert.equal(stale.exports(), 0, 'Do not show a card for a replaced match');
  assert.equal(stale.element('result-share').disabled, false);

  const navigated = fixture(runFixture(1));
  const navigatedPending = navigated.context.renderShareImage();
  navigated.element('result').classList.remove('active');
  loaded(navigated.requests[0]); await navigatedPending;
  assert.equal(navigated.exports(), 0, 'Do not reopen a preview after leaving the result page');
  assert.equal(navigated.element('result-share').disabled, false);
  console.log('Share image checks passed: portraits, custom avatar, async ordering, duplicate clicks, failures, timeout, stale match.');
}

async function renderSamples(modulePath) {
  const canvasApi = require(path.resolve(modulePath));
  if (process.platform === 'win32') {
    canvasApi.GlobalFonts.loadFontsFromDir('C:/Windows/Fonts');
    // The native test renderer does not inherit the browser's Chinese font fallback.
    const chineseFont = 'C:/Windows/Fonts/msyh.ttc';
    if (fs.existsSync(chineseFont)) canvasApi.GlobalFonts.registerFromPath(chineseFont, 'sans-serif');
  }
  const players = JSON.parse(fs.readFileSync(path.join(root, 'app/data/base.json'), 'utf8')).players;
  const names = ['轩染', '钟意', '长生', '一诺', '大帅', '清清', '小胖', '紫幻', '道崽', '无畏'];
  const entries = names.map(name => Object.entries(players).find(([, player]) => player.name === name));
  assert.ok(entries.every(Boolean));
  const avatars = await Promise.all(entries.map(([, player]) => canvasApi.loadImage(path.join(root, 'app', player.icon))));
  const custom = await canvasApi.loadImage(path.join(root, 'app/assets/custom-avatar-female.webp'));
  const customCanvas = canvasApi.createCanvas(custom.width, custom.height);
  customCanvas.getContext('2d').drawImage(custom, 0, 0);
  avatars[9] = await canvasApi.loadImage(customCanvas.toDataURL('image/png'));
  const output = path.join(root, 'tmp/share-card-verification');
  fs.mkdirSync(output, { recursive: true });
  for (const mode of ['classic', 'allstar']) {
    const run = runFixture(mode === 'classic' ? 5 : 10, mode);
    const nameById = {};
    run.records.forEach((record, index) => { nameById[record.player_id] = index === 9 ? '自定义选手' : names[index]; });
    const f = fixture(run, { canvasApi, names: nameById });
    f.context.paintShareImage(run, avatars.slice(0, run.records.length));
    const bytes = Buffer.from(f.element('share-img').src.split(',')[1], 'base64');
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    const result = await canvasApi.loadImage(bytes);
    assert.equal(result.width, 1080);
    const withAvatars = canvasApi.createCanvas(result.width, result.height);
    withAvatars.getContext('2d').drawImage(result, 0, 0);
    f.context.paintShareImage(run, run.records.map(() => null));
    const fallback = await canvasApi.loadImage(f.element('share-img').src);
    const fallbackCanvas = canvasApi.createCanvas(result.width, result.height);
    fallbackCanvas.getContext('2d').drawImage(fallback, 0, 0);
    run.records.forEach((_, index) => {
      const y = 418 + (index + 1) * 124 - 72;
      const pixels = withAvatars.getContext('2d').getImageData(64, y, 80, 80).data;
      const fallbackPixels = fallbackCanvas.getContext('2d').getImageData(64, y, 80, 80).data;
      assert.notDeepEqual(pixels, fallbackPixels, 'Each exported avatar must contain real image pixels');
    });
    const file = path.join(output, mode + '.png');
    fs.writeFileSync(file, bytes);
    console.log('Real canvas PNG verified: ' + file);
  }
}

regressions().then(async () => {
  const modulePath = process.argv[2];
  if (modulePath) await renderSamples(modulePath);
}).catch(error => { console.error(error); process.exitCode = 1; });
