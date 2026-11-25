// Outside Views badge: single activation opens an in-app panel.
// Blocks Silk's double-click / long-press popup on this control.
(function () {
  // Drop ?token= from the visible URL without losing the cookie set on this response.
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('token')) {
      u.searchParams.delete('token');
      const next = u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash;
      history.replaceState({}, '', next);
    }
  } catch (_) { /* ignore */ }

  const badge = document.getElementById('outside-viewers-badge');
  const panel = document.getElementById('viewers-panel');
  const listEl = document.getElementById('viewers-panel-list');
  const summaryEl = document.getElementById('viewers-panel-summary');
  const closeBtn = document.getElementById('viewers-panel-close');
  if (!badge || !panel) return;

  const listenerLabel = {
    tv: 'TV listener',
    public: 'Public link',
    loopback: 'Laptop',
    unknown: 'Unknown path',
  };

  function formatTime(iso) {
    if (!iso) return 'Seen earlier';
    try {
      return new Date(iso).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      });
    } catch {
      return iso;
    }
  }

  async function loadViewers() {
    const res = await fetch('/api/stats/viewers', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Could not load viewers');
    return res.json();
  }

  async function openPanel() {
    panel.hidden = false;
    summaryEl.textContent = 'Loading…';
    listEl.replaceChildren();
    try {
      const data = await loadViewers();
      const recent = Array.isArray(data.recent) ? data.recent : [];
      const unique = data.uniqueVisitors != null ? data.uniqueVisitors : recent.length;
      const views = data.outsideViews != null ? data.outsideViews : unique;
      summaryEl.textContent = views + ' outside views · ' + unique + ' unique';
      if (!recent.length) {
        const li = document.createElement('li');
        li.textContent = 'No recent outside viewers recorded yet.';
        listEl.appendChild(li);
      } else {
        for (const row of recent) {
          const li = document.createElement('li');
          const main = document.createElement('span');
          main.textContent = (row.label || 'Device') + ' · ' + (listenerLabel[row.listener] || row.listener || '');
          const time = document.createElement('span');
          time.className = 'viewer-time';
          time.textContent = formatTime(row.at);
          li.append(main, time);
          listEl.appendChild(li);
        }
      }
    } catch (err) {
      summaryEl.textContent = 'Could not load viewer list.';
    }
    (closeBtn || panel).focus();
  }

  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true;
    badge.focus();
  }

  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPanel();
  });
  badge.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  badge.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  // Swallow the second click of a double-press so Silk does not treat it as a page action.
  badge.addEventListener('mousedown', (e) => {
    if (e.detail > 1) e.preventDefault();
  });

  closeBtn && closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    closePanel();
  });
  panel.addEventListener('click', (e) => {
    if (e.target === panel) closePanel();
  });
  document.addEventListener('keydown', (e) => {
    if (panel.hidden) return;
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      closePanel();
    }
  });

  const params = new URLSearchParams(location.search);
  if (params.has('viewers')) {
    openPanel();
  }
})();
