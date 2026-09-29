// In-window console: server log + browser errors, owner-only. Hidden when the API says no (guests / tunnel visitors).
(() => {
  const tok = () => { try { return sessionStorage.getItem('vault_token') || ''; } catch { return ''; } };
  const hdr = () => ({ 'Content-Type': 'application/json', 'X-Vault-Token': tok() });
  const send = (level, msg) => { try { fetch('/api/console/client', { method: 'POST', headers: hdr(), body: JSON.stringify({ level, msg: String(msg).slice(0, 2000) }) }).catch(() => {}); } catch {} };

  // Forward browser-side problems to the same console
  window.addEventListener('error', (e) => send('error', `${e.message} @ ${e.filename || ''}:${e.lineno || ''}`));
  window.addEventListener('unhandledrejection', (e) => send('error', `unhandledrejection: ${e.reason?.message || e.reason}`));
  const oe = console.error.bind(console); console.error = (...a) => { oe(...a); send('error', a.map((x) => (x && x.message) || String(x)).join(' ')); };

  let since = 0, open = false, timer = null, wrap = null, body = null, btn = null, filter = 'all';
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const col = { error: '#f43f5e', warn: '#f59e0b', log: '#c9d1d9' };

  function build() {
    btn = document.createElement('button');
    btn.textContent = '🖥 Console'; btn.type = 'button';
    btn.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;background:#15161e;color:#f0f2f5;border:1px solid #272938;border-radius:8px;padding:7px 11px;font:12px system-ui;cursor:pointer;opacity:.85';
    wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:34vh;z-index:99998;background:#0b0c10;border-top:1px solid #272938;display:none;flex-direction:column;font:12px ui-monospace,monospace';
    wrap.innerHTML = `<div style="display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid #272938;color:#9aa0a6"><b style="color:#f0f2f5">Console</b>
      <select id="cn-f" style="background:#1f202b;color:#fff;border:1px solid #272938;border-radius:6px"><option value="all">All</option><option value="warn">Warnings+</option><option value="error">Errors</option></select>
      <button id="cn-copy" type="button">Copy</button><button id="cn-clear" type="button">Clear</button><span style="flex:1"></span><button id="cn-x" type="button">✕</button></div>
      <div id="cn-body" style="flex:1;overflow:auto;padding:8px 10px;white-space:pre-wrap;word-break:break-word"></div>`;
    wrap.querySelectorAll('button').forEach((b) => { b.style.cssText = 'background:#1f202b;color:#f0f2f5;border:1px solid #272938;border-radius:6px;padding:3px 9px;cursor:pointer'; });
    document.body.append(btn, wrap);
    body = wrap.querySelector('#cn-body');
    btn.onclick = () => toggle(true);
    wrap.querySelector('#cn-x').onclick = () => toggle(false);
    wrap.querySelector('#cn-f').onchange = (e) => { filter = e.target.value; body.innerHTML = ''; since = 0; poll(); };
    wrap.querySelector('#cn-clear').onclick = async () => { await fetch('/api/console/clear', { method: 'POST', headers: hdr() }); body.innerHTML = ''; since = 0; poll(); };
    wrap.querySelector('#cn-copy').onclick = () => navigator.clipboard.writeText(body.innerText).catch(() => {});
    window.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === '`') toggle(!open); });
  }
  function toggle(v) { open = v; wrap.style.display = v ? 'flex' : 'none'; btn.style.display = v ? 'none' : 'block'; if (v) poll(); else clearTimeout(timer); }

  async function poll() {
    clearTimeout(timer);
    try {
      const r = await fetch(`/api/console?since=${since}`, { headers: hdr() });
      if (r.status === 403 || r.status === 404) { if (btn) { btn.remove(); wrap.remove(); btn = null; } return; } // not the owner: no console
      if (!btn) build();
      if (r.status === 401) { if (open) body.innerHTML = '<div style="color:#9aa0a6">Unlock the vault to see the console.</div>'; }
      else {
        const d = await r.json();
        const rank = { log: 0, warn: 1, error: 2 }; const min = filter === 'all' ? 0 : filter === 'warn' ? 1 : 2;
        const stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
        for (const l of d.lines) {
          since = Math.max(since, l.id);
          if ((rank[l.level] ?? 0) < min) continue;
          const div = document.createElement('div'); div.style.color = col[l.level] || col.log;
          div.innerHTML = `<span style="color:#6b7280">${l.t} ${esc(l.src)}</span> ${esc(l.msg)}`; body.appendChild(div);
        }
        while (body.childNodes.length > 800) body.removeChild(body.firstChild);
        if (stick) body.scrollTop = body.scrollHeight;
      }
    } catch { /* server restarting */ }
    timer = setTimeout(poll, open ? 1000 : 4000);
  }
  poll();
})();
