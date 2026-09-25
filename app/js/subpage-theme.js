(function () {
  'use strict';
  var key = 'kpl2k_theme';
  var url = new URL(location.href);
  var requested = url.searchParams.get('theme');
  var theme = 'light';
  try { theme = localStorage.getItem(key) === 'dark' ? 'dark' : 'light'; } catch (_) {}
  if (requested === 'light' || requested === 'dark') {
    theme = requested;
    try { localStorage.setItem(key, theme); } catch (_) {}
    url.searchParams.delete('theme');
    history.replaceState(history.state, '', url);
  }
  function apply() {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f3f6fb' : '#080d1b';
    var button = document.getElementById('theme-toggle');
    if (button) {
      button.textContent = theme === 'light' ? '◐ 深色' : '☀ 浅色';
      button.setAttribute('aria-label', '切换' + (theme === 'light' ? '深色' : '浅色') + '模式');
    }
  }
  apply();
  document.addEventListener('DOMContentLoaded', function () {
    apply();
    document.getElementById('theme-toggle').addEventListener('click', function () {
      theme = theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(key, theme); } catch (_) {}
      apply();
    });
  });
})();
