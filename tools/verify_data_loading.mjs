import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', {
  paths: ['C:/Users/22974/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'],
}));
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(workspace, 'app');
const output = path.join(workspace, 'output/first-batch-fixes-20261018');
fs.mkdirSync(output, { recursive: true });
const origin = 'http://127.0.0.1:4199';
const statsForwarded = [];
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
  if (pathname.includes('/__event')) {
    statsForwarded.push(pathname);
    response.writeHead(204).end();
    return;
  }
  const file = path.resolve(app, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(app + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  const stream = fs.createReadStream(file);
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
});

const scenarios = [];
let browser;
const trackedIds = ['core-load-retry', 'btn-classic', 'btn-quick', 'btn-allstar', 'btn-budget'];
async function scenario(name, config = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const requests = {};
  const errors = [];
  const blockedAnalytics = [];
  let fail = true;
  await page.addInitScript(() => {
    localStorage.setItem('kpl2k_disclaimer_v1', '1');
    window.__loadListenerCounts = {};
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      const key = this === window ? `window:${type}` : this.id ? `${this.id}:${type}` : '';
      if (key) window.__loadListenerCounts[key] = (window.__loadListenerCounts[key] || 0) + 1;
      return add.call(this, type, callback, options);
    };
    const beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, ...args) => String(url).includes('__event') ? true : beacon(url, ...args);
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/__event')) {
      blockedAnalytics.push(url.pathname);
      return route.fulfill({ status: 204, body: '' });
    }
    if (url.origin !== origin) return route.abort('blockedbyclient');
    requests[url.pathname] = (requests[url.pathname] || 0) + 1;
    if (config.optionalFailure && ['/data/team_icons.json', '/data/dynasties.json'].includes(url.pathname)) {
      return route.fulfill({ status: 503, contentType: 'text/plain', body: 'optional unavailable' });
    }
    if (config.missingImages && url.pathname === '/data/team_icons.json') {
      const manifest = JSON.parse(fs.readFileSync(path.join(app, 'data/manifest.json'), 'utf8'));
      return route.fulfill({ json: { icons: Object.fromEntries(manifest.teams2026.map(team => [team.id, '/missing-team-logo.png'])) } });
    }
    if (config.resource === url.pathname) {
      if (fail) {
        if (config.failure === 'html') return route.fulfill({ status: 200, contentType: 'application/json', body: '<!doctype html><title>Fallback</title>' });
        if (config.failure === 'schema') return route.fulfill({ json: config.invalid ?? {} });
        return route.fulfill({ status: 503, contentType: 'text/plain', body: 'temporary failure' });
      }
      // Keep the recovery request open long enough to exercise overlapping clicks.
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return route.continue();
  });
  const record = { name, passed: false, requests, runtimeErrors: errors, blockedAnalytics, screenshots: [] };
  scenarios.push(record);
  try {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    if (config.resource) {
      await page.waitForFunction(() => document.body.dataset.loadState === 'error');
      assert.match(await page.locator('#core-load-message').innerText(), /加载失败/);
      await page.waitForFunction(() => !document.getElementById('core-load-retry').hidden);
      const blocked = await page.evaluate(() => ({
        entries: [...document.querySelectorAll('[data-core-entry]')].every(button => button.disabled),
        inert: [...document.querySelectorAll('.page,.bottom-bar')].every(element => element.inert),
        uncommitted: window.KPL_DATA.DATA.base === null && window.KPL_DATA.DATA.manifest === null,
      }));
      assert.deepEqual(blocked, { entries: true, inert: true, uncommitted: true });
      record.failureState = blocked;
      if (name === 'base-503-keyboard-retry') {
        const screenshot = '2k-load-error-390.png';
        await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
        record.screenshots.push(screenshot);
      }
      const requestsBefore = requests[config.resource];
      fail = false;
      // A real keyboard Enter starts the retry; rapid programmatic events then test single-flight.
      await page.locator('#core-load-retry').focus();
      await page.keyboard.press('Enter');
      await page.evaluate(() => {
        for (let index = 0; index < 12; index++) {
          document.getElementById('core-load-retry').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      });
      await page.waitForFunction(() => document.body.dataset.loadState === 'ready');
      assert.equal(requests[config.resource], requestsBefore + 1);
      record.singleFlightResourceRequests = requests[config.resource] - requestsBefore;
      const beforeReadyClick = requests[config.resource];
      await page.evaluate(() => document.getElementById('core-load-retry').dispatchEvent(new MouseEvent('click')));
      await page.waitForTimeout(80);
      assert.equal(requests[config.resource], beforeReadyClick);
    } else {
      await page.waitForFunction(() => document.body.dataset.loadState === 'ready');
    }
    record.listenerCounts = await page.evaluate(() => window.__loadListenerCounts);
    assert.equal(record.listenerCounts['window:hashchange'], 1);
    for (const id of trackedIds) assert.equal(record.listenerCounts[`${id}:click`], 1, id);
    assert.equal(await page.locator('#core-load-status').isVisible(), false);
    assert.equal(await page.locator('#btn-classic').isEnabled(), true);
    if (name === 'base-503-keyboard-retry') {
      const screenshot = '2k-load-ready-390.png';
      await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
      record.screenshots.push(screenshot);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    }
    await page.locator('#btn-classic').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/#/team');
    await page.waitForSelector('#team-strip .team-chip');
    record.teamButtons = await page.locator('#team-strip .team-chip').count();
    assert.ok(record.teamButtons > 0);
    if (config.optionalFailure) {
      assert.deepEqual(await page.evaluate(() => window.KPL_DATA.DATA.teamIcons), {});
      assert.ok(await page.locator('#team-strip .team-ava.fb').count() > 0);
      record.optionalFallback = true;
    }
    if (config.missingImages) {
      await page.waitForFunction(() => [...document.querySelectorAll('#team-strip img')].some(image => image.style.display === 'none'));
      record.failedImages = await page.locator('#team-strip img[style*="display: none"]').count();
      assert.ok(record.failedImages > 0);
      assert.ok(requests['/missing-team-logo.png'] > 0);
      record.imageFallback = await page.locator('#team-strip .team-ava.fb[style*="inline-flex"]').count();
      assert.ok(record.imageFallback > 0);
    }
    assert.deepEqual(errors, []);
    record.passed = true;
  } catch (error) {
    record.failure = error.stack ?? String(error);
    record.lastState = await page.evaluate(() => ({ state: document.body.dataset.loadState, message: document.getElementById('core-load-message')?.textContent })).catch(() => null);
  } finally {
    await context.close();
  }
}

try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4199, '127.0.0.1', resolve); });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  await scenario('base-503-keyboard-retry', { resource: '/data/base.json' });
  await scenario('base-html-200', { resource: '/data/base.json', failure: 'html' });
  await scenario('base-invalid-schema', { resource: '/data/base.json', failure: 'schema' });
  await scenario('manifest-503', { resource: '/data/manifest.json' });
  await scenario('manifest-invalid-schema', { resource: '/data/manifest.json', failure: 'schema', invalid: { seasons: [{}] } });
  await scenario('optional-metadata-503', { optionalFailure: true });
  await scenario('team-images-404', { missingImages: true });
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  const report = {
    testedAt: new Date().toISOString(), browser: 'Microsoft Edge (Playwright Chromium channel msedge), headless',
    viewport: '390x844', server: origin, strict404: true, passed: scenarios.length === 7 && scenarios.every(item => item.passed) && statsForwarded.length === 0,
    productAnalyticsRequestsForwarded: statsForwarded, scenarios,
    limitations: ['真实 Edge headless 浏览器；未进行物理手机、正式生产站点或中国大陆网络验收。'],
  };
  fs.writeFileSync(path.join(output, '2k-browser.json'), JSON.stringify(report, null, 2) + '\n');
  const text = [
    '# 2K 加载恢复真实浏览器验证', '',
    `结果：${report.passed ? '通过' : '失败'}；${scenarios.filter(item => item.passed).length}/${scenarios.length} 场景。`, '',
    'Microsoft Edge headless，Playwright，390×844，本地 strict-404 / MIME 静态服务。所有 /__event 请求在浏览器路由层拦截，外域请求阻断，真实统计转发 0 次。', '',
    ...scenarios.map(item => `- ${item.passed ? '通过' : '失败'}：${item.name}${item.failure ? `；${item.failure.split('\n')[0]}` : ''}`), '',
    '故障场景均检查核心入口 disabled、页面与底栏 inert、核心数据未部分发布；键盘 Enter 重试，连续 12 次点击只新增 1 组请求，恢复后入口/路由监听器各 1 组，并实际按 Enter 进入战队选择。', '',
    '截图：2k-load-error-390.png、2k-load-ready-390.png。详细请求数、监听器数和错误见 2k-browser.json。', '',
    ...report.limitations,
  ].join('\n');
  fs.writeFileSync(path.join(output, '2k-browser.md'), text + '\n');
  console.log(JSON.stringify({ passed: report.passed, scenarios: scenarios.map(({ name, passed, failure }) => ({ name, passed, failure })), statsForwarded }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
