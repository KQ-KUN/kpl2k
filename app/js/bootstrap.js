/* One initialization and one in-flight retry per document. */
(function (global) {
  'use strict';
  function mount(options) {
    var pending = null, initialized = false;
    var status = document.getElementById('core-load-status');
    var message = document.getElementById('core-load-message');
    var retry = document.getElementById('core-load-retry');
    var entries = document.querySelectorAll('[data-core-entry]');
    function state(value, text) {
      document.body.dataset.loadState = value;
      status.hidden = value === 'ready';
      status.setAttribute('aria-busy', String(value === 'loading'));
      message.textContent = text;
      retry.hidden = value !== 'error';
      retry.disabled = value === 'loading';
      entries.forEach(function (entry) { entry.disabled = value !== 'ready'; });
      document.querySelectorAll('.page, .bottom-bar').forEach(function (page) { page.inert = value !== 'ready'; });
    }
    function attempt() {
      if (pending || initialized) return pending || Promise.resolve();
      state('loading', '正在加载核心数据…');
      pending = Promise.resolve().then(options.load).then(function () {
        // Initialization is not retried: partially installed listeners must never be duplicated.
        initialized = true;
        options.initialize();
        state('ready', '加载完成');
      }).catch(function (error) {
        state('error', initialized ? '页面初始化失败，请刷新页面重试。' : '核心数据加载失败，请检查网络后重试。');
        retry.hidden = initialized;
        if (options.onError) options.onError(error);
      }).finally(function () { pending = null; });
      return pending;
    }
    retry.addEventListener('click', attempt);
    attempt();
    return { retry: attempt };
  }
  global.KPL_BOOTSTRAP = { mount: mount };
})(window);
