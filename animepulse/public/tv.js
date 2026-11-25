// TV / D-pad navigation. Loaded after app.js. Does not change desktop click behavior.
(function () {
  const ua = navigator.userAgent || '';
  const params = new URLSearchParams(location.search);
  const loopback = location.hostname === '127.0.0.1' || location.hostname === 'localhost' || location.hostname === '[::1]';
  const tvMode = params.has('tv') || /Silk|AFT|AFTN|AFTHA|TV/i.test(ua) || !loopback;
  if (!tvMode) return;
  document.documentElement.classList.add('tv-mode');
  document.body.classList.add('tv-mode');
  const search = document.getElementById('search-input');
  if (search) search.placeholder = 'Search titles or genres';

  const SELECTOR = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'video',
    '.tab-btn',
    '.anime-card',
    '.history-card',
    '.counterpart-item',
    '.live-card',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function visible(el) {
    if (!el || el.disabled) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
    return true;
  }

  function focusables() {
    const seen = new Set();
    const out = [];
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (seen.has(el) || !visible(el)) continue;
      if (el.closest('[hidden]')) continue;
      seen.add(el);
      if (el.tabIndex < 0) el.tabIndex = 0;
      out.push(el);
    }
    return out;
  }

  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
  }

  function inDir(from, to, dir) {
    const a = center(from);
    const b = center(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dir === 'up') return dy < -8 && Math.abs(dy) >= Math.abs(dx) * 0.4;
    if (dir === 'down') return dy > 8 && Math.abs(dy) >= Math.abs(dx) * 0.4;
    if (dir === 'left') return dx < -8 && Math.abs(dx) >= Math.abs(dy) * 0.4;
    if (dir === 'right') return dx > 8 && Math.abs(dx) >= Math.abs(dy) * 0.4;
    return false;
  }

  function score(from, to, dir) {
    const a = center(from);
    const b = center(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    return primary + secondary * 2;
  }

  function move(dir) {
    const items = focusables();
    if (!items.length) return false;
    const active = document.activeElement;
    const from = items.includes(active) ? active : items[0];
    if (!items.includes(active)) {
      from.focus();
      from.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }
    let best = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === from) continue;
      if (!inDir(from, el, dir)) continue;
      const sc = score(from, el, dir);
      if (sc < bestScore) { best = el; bestScore = sc; }
    }
    if (!best) return false;
    best.focus();
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  function playerOpen() {
    return !!(document.querySelector('video') && document.querySelector('video').offsetParent !== null
      && (document.querySelector('.player-overlay, #player-overlay, .video-overlay, .modal-card video')));
  }

  function overlayOpen() {
    const vp = document.getElementById('viewers-panel');
    return playerOpen() || (vp && !vp.hidden);
  }

  document.addEventListener('keydown', (e) => {
    const key = e.key;
    const dir = key === 'ArrowUp' || e.keyCode === 38 ? 'up'
      : key === 'ArrowDown' || e.keyCode === 40 ? 'down'
        : key === 'ArrowLeft' || e.keyCode === 37 ? 'left'
          : key === 'ArrowRight' || e.keyCode === 39 ? 'right'
            : null;
    const isActivate = key === 'Enter' || key === ' ' || e.keyCode === 13 || e.keyCode === 23;
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (typing && (dir === 'left' || dir === 'right' || isActivate)) return;
    if (overlayOpen() && (tag === 'VIDEO' || (document.getElementById('viewers-panel') && !document.getElementById('viewers-panel').hidden))) return;

    if (dir) {
      if (move(dir)) e.preventDefault();
      return;
    }
    if (isActivate && e.target && typeof e.target.click === 'function' && tag !== 'BUTTON' && tag !== 'A' && tag !== 'INPUT') {
      e.preventDefault();
      e.target.click();
    }
  });

  function prime() {
    for (const el of document.querySelectorAll('.anime-card, .history-card, .counterpart-item, .tab-btn')) {
      if (el.tabIndex < 0) el.tabIndex = 0;
    }
    const cur = document.activeElement;
    if (!cur || cur === document.body || cur === document.documentElement) {
      const first = document.querySelector('.tab-btn, #search-input, button');
      if (first) first.focus();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prime);
  } else {
    prime();
  }
  new MutationObserver(prime).observe(document.body, { childList: true, subtree: true });
})();
