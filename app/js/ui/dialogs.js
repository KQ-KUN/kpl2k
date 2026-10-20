/* dialogs: injected coordination callbacks; no module imports or listener installation at load. */
(function(global){'use strict';
(global.KPL_UI_MODULES=global.KPL_UI_MODULES||{}).dialogs=function(ctx){

  function openConfirm(title, body, onOk, okText) {
    ctx.$('cf-title').textContent = title;
    ctx.$('cf-body').textContent = body;
    ctx.$('cf-ok').textContent = okText || '确定';
    ctx.confirmCb = onOk || null;
    ctx.$('confirm-mask').classList.add('show');
    ctx.$('confirm-box').classList.add('show');
  }
  function closeConfirm() {
    ctx.confirmCb = null;
    ctx.$('confirm-mask').classList.remove('show');
    ctx.$('confirm-box').classList.remove('show');
  }


  function setupOverlayInteraction() {
    var panels = [
      { id: 'drawer', title: 'picker-title', close: ctx.closePicker },
      { id: 'share-modal', label: '分享战绩', close: ctx.closeShareModal },
      { id: 'confirm-box', title: 'cf-title', close: closeConfirm },
      { id: 'disclaimer', label: '玩家须知', close: null }
    ];
    var active = null, returnFocus = null, savedOverflow = '';
    var inertBefore = new Map();
    function focusable(panel) {
      return Array.from(panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]'))
        .filter(function (el) { return el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'; });
    }
    function sync() {
      var next = panels.filter(function (item) { return ctx.$(item.id).classList.contains('show'); }).pop() || null;
      if (next === active) return;
      inertBefore.forEach(function (value, el) { el.inert = value; });
      inertBefore.clear();
      if (!active && next) { returnFocus = document.activeElement; savedOverflow = document.body.style.overflow; }
      active = next;
      if (active) {
        var panel = ctx.$(active.id);
        document.body.style.overflow = 'hidden';
        Array.from(document.body.children).forEach(function (el) {
          if (el === panel || el.contains(panel) || !el.querySelector('button,a,input,select')) return;
          inertBefore.set(el, el.inert); el.inert = true;
        });
        (focusable(panel)[0] || panel).focus({ preventScroll: true });
      } else {
        document.body.style.overflow = savedOverflow;
        if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
      }
    }
    panels.forEach(function (item) {
      var panel = ctx.$(item.id);
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.tabIndex = -1;
      panel.setAttribute(item.title ? 'aria-labelledby' : 'aria-label', item.title || item.label);
      new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    });
    document.addEventListener('keydown', function (event) {
      if (!active) return;
      if (event.key === 'Escape' && active.close) { event.preventDefault(); active.close(); return; }
      if (event.key !== 'Tab') return;
      var panel = ctx.$(active.id), items = focusable(panel);
      var index = items.indexOf(document.activeElement);
      if (!items.length) { event.preventDefault(); panel.focus(); }
      else if (index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus();
      }
    });
    var bars = Array.from(document.querySelectorAll('.bottom-bar'));
    function measureBars() {
      var height = Math.max.apply(null, [0].concat(bars.map(function (bar) { return bar.getBoundingClientRect().height; })));
      document.body.style.setProperty('--action-bar-height', height + 'px');
    }
    var observer = new ResizeObserver(measureBars);
    bars.forEach(function (bar) { observer.observe(bar); });
    measureBars(); sync();
  }


return {openConfirm,closeConfirm,setupOverlayInteraction};
};
})(window);
