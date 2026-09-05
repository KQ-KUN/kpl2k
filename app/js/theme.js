(function () {
  'use strict';
  var key = 'kpl2k_theme', theme = 'dark';
  try { theme = localStorage.getItem(key) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch (_) {}
  var entryUrl = new URL(location.href);
  if (entryUrl.searchParams.get('theme') === 'light') {
    theme = 'light';
    try { localStorage.setItem(key, theme); } catch (_) {}
    entryUrl.searchParams.delete('theme');
    history.replaceState(history.state, '', entryUrl);
  }
  function apply(value) {
    theme = value === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f3f6fb' : '#080d1b';
    var toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-label', theme === 'light' ? '切换深色模式' : '切换浅色模式');
    toggle.querySelector('span').textContent = theme === 'light' ? '◐' : '☀';
    toggle.querySelector('.theme-label').textContent = theme === 'light' ? '深色' : '浅色';
  }
  apply(theme);
  document.addEventListener('DOMContentLoaded', function () {
    apply(theme);
    document.getElementById('theme-toggle').addEventListener('click', function () {
      apply(theme === 'light' ? 'dark' : 'light');
      try { localStorage.setItem(key, theme); } catch (_) {}
    });
    function home(event) {
      event.preventDefault();
      if (document.getElementById('sim').classList.contains('active')) document.getElementById('sim-back').click();
      else location.hash = '#/';
    }
    document.getElementById('nav-home').addEventListener('click', home);
    document.querySelector('.site-header .brand').addEventListener('click', home);
    var rules = document.getElementById('game-rules');
    document.getElementById('nav-rules').addEventListener('click', function () { rules.showModal(); });
    rules.addEventListener('click', function (event) {
      if (event.target !== rules) return;
      var rect = rules.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) rules.close();
    });
  });
})();
