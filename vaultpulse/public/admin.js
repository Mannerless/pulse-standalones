(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let tab = 'overview'; let timer = null;
  const tok = () => sessionStorage.getItem('vault_token') || '';
  const api = async (p, body) => {
    const r = await fetch(p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Vault-Token': tok() }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { showLogin(); throw new Error('locked'); }
    return r.json();
  };
  const ago = (t) => { if (!t) return 'never'; const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${(s / 60) | 0}m ago` : s < 86400 ? `${(s / 3600) | 0}h ago` : `${(s / 86400) | 0}d ago`; };

  function showLogin() { $('login').style.display = 'block'; $('app').style.display = 'none'; $('out').style.display = 'none'; clearTimeout(timer); }
  async function boot() {
    if (!tok()) return showLogin();
    try { const d = await api('/api/share/summary'); if (!d.success) return showLogin(); } catch { return; }
    $('login').style.display = 'none'; $('app').style.display = 'block'; $('out').style.display = 'inline-block'; render();
  }
  $('go').onclick = async () => {
    $('lerr').textContent = '';
    const r = await fetch('/api/vault/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VaultPulse': '1' }, body: JSON.stringify({ pin: $('pin').value }) }).then((x) => x.json());
    if (r.success && r.token) { sessionStorage.setItem('vault_token', r.token); $('pin').value = ''; boot(); } else $('lerr').textContent = r.error || 'Login failed';
  };
  $('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('go').click(); });
  $('out').onclick = async () => { await fetch('/api/vault/lock', { method: 'POST' }); sessionStorage.removeItem('vault_token'); showLogin(); };
  $('tabs').onclick = (e) => { const b = e.target.closest('button[data-t]'); if (!b) return; tab = b.dataset.t; [...$('tabs').children].forEach((x) => x.classList.toggle('on', x === b)); render(); };

  async function render() {
    clearTimeout(timer);
    const v = $('v');
    try {
      if (tab === 'overview') {
        const d = await api('/api/share/summary');
        if (d.disabled) { v.innerHTML = '<div class="card"><b style="font-size:18px">🔒 Sharing is OFF</b><p class="mut">Guest access and the tunnel are disabled. Nothing can reach this vault from outside this computer. To enable later, restart VaultPulse with VAULTPULSE_SHARE=1.</p></div>'; return; }
        v.innerHTML = `<div class="cards">${[['Users', d.counts.users], ['Blocked', d.counts.blocked], ['Pending invites', d.counts.pending], ['Redeemed', d.counts.redeemed], ['Live sessions', d.counts.activeSessions]].map(([k, n]) => `<div class="card"><b>${n}</b><span class="mut">${k}</span></div>`).join('')}</div>
          <p>Tunnel: ${d.tunnel.up ? `<span class="ok">up</span> <span class="mut">${esc(d.tunnel.url)}</span>` : '<span class="mut">off (starts automatically when you create an invite)</span>'}</p>
          <h3>Live guest sessions</h3><table><tr><th>User</th><th>Connected</th><th>IP</th><th>Browser</th><th>Last seen</th><th>Expires</th><th>Req/min</th></tr>${d.sessions.map((s) => `<tr><td>${esc(s.user)}</td><td>${ago(s.since)}</td><td>${esc(s.ip)}</td><td class="mut">${esc(s.ua)}</td><td>${ago(s.lastSeen)}</td><td>${new Date(s.expiresAt).toLocaleTimeString()}</td><td>${s.hits}</td></tr>`).join('') || '<tr><td colspan=7 class="mut">None</td></tr>'}</table><p class="mut" style="font-size:12px">Connection details exist only in memory while a guest is logged in. On logout or expiry the session, its invite and its activity are erased${d.ephemeral ? '' : ' (ephemeral mode is OFF)'}. Over Tor the IP shown is local (127.0.0.1).</p>
          <p><button class="bad" id="stop">Revoke everything &amp; stop sharing</button></p>`;
        $('stop').onclick = async () => { if (confirm('Revoke all invites and end all guest sessions?')) { await api('/api/share/stop', {}); render(); } };
        timer = setTimeout(render, 5000);
      } else if (tab === 'users') {
        const d = await api('/api/share/users');
        v.innerHTML = `<table><tr><th>User</th><th>Status</th><th>Invites</th><th>Live</th><th>Last seen</th><th>Events</th><th>Note</th><th></th></tr>${d.users.map((u) => `<tr>
          <td><b>${esc(u.name)}</b></td><td>${u.blocked ? '<span class="no">blocked</span>' : '<span class="ok">active</span>'}</td><td>${u.invites}</td><td>${u.activeSessions}</td>
          <td>${ago(u.lastSeen)}<div class="mut">${esc(u.lastIp)}</div></td><td>${u.events}</td>
          <td><input data-note="${esc(u.name)}" value="${esc(u.note)}" placeholder="note" style="padding:6px"></td>
          <td><button data-h="${esc(u.name)}">History</button> <button data-a="${u.blocked ? 'unblock' : 'block'}" data-n="${esc(u.name)}">${u.blocked ? 'Unblock' : 'Block'}</button> <button class="bad" data-a="delete" data-n="${esc(u.name)}">Delete</button></td></tr>`).join('') || '<tr><td colspan=8 class="mut">No users yet. Create an invite from the vault (🔗 Share); each label becomes a user.</td></tr>'}</table>`;
        v.onchange = async (e) => { const n = e.target.dataset?.note; if (n) await api('/api/share/user', { name: n, action: 'note', note: e.target.value }); };
        v.onclick = async (e) => {
          const h = e.target.closest('[data-h]'); if (h) { tab = 'activity'; window.__u = h.dataset.h; [...$('tabs').children].forEach((x) => x.classList.toggle('on', x.dataset.t === 'activity')); return render(); }
          const b = e.target.closest('[data-a]'); if (!b) return;
          if (b.dataset.a === 'delete' && !confirm(`Delete user ${b.dataset.n} and revoke their access?`)) return;
          await api('/api/share/user', { name: b.dataset.n, action: b.dataset.a }); render();
        };
      } else if (tab === 'invites') {
        const d = await api('/api/share/list');
        v.innerHTML = `<table><tr><th>User</th><th>Status</th><th>Created</th><th>Passcode</th><th>Link</th><th></th></tr>${d.invites.map((i) => `<tr><td>${esc(i.label)}</td><td>${esc(i.status)}${i.activeSessions ? ` (${i.activeSessions} live)` : ''}</td><td>${new Date(i.createdAt).toLocaleString()}<div class="mut">by ${esc(i.createdBy)}</div></td>
          <td><b style="letter-spacing:2px">${esc(i.passcode)}</b></td><td style="word-break:break-all">${i.status === 'pending' ? esc(i.link || '(tunnel reconnecting)') : '<span class="mut">—</span>'}</td>
          <td>${i.status === 'pending' || i.activeSessions ? `<button class="bad" data-r="${i.id}">Revoke</button>` : ''}</td></tr>`).join('') || '<tr><td colspan=6 class="mut">No invites.</td></tr>'}</table>
          <p class="mut">Only invites you created appear here. A passcode you don't recognize means it was created without you: revoke it and change your Master PIN. Create invites from the vault's 🔗 Share button.</p>`;
        v.onclick = async (e) => { const r = e.target.closest('[data-r]'); if (r) { await api('/api/share/revoke', { id: r.dataset.r }); render(); } };
      } else if (tab === 'activity') {
        const u = window.__u || '';
        const us = await api('/api/share/users');
        const d = await api(`/api/share/activity?limit=300${u ? `&user=${encodeURIComponent(u)}` : ''}`);
        v.innerHTML = `<p>User: <select id="uf"><option value="">All users</option>${us.users.map((x) => `<option ${x.name === u ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select> <button class="bad" id="clr">Clear log</button></p>
          <table><tr><th>When</th><th>User</th><th>Event</th><th>Detail</th><th>IP</th></tr>${d.events.map((e) => `<tr><td title="${esc(e.t)}">${ago(e.t)}</td><td>${esc(e.user)}</td><td><span class="pill">${esc(e.type)}</span></td>
            <td>${esc([e.type === 'watch' ? `id ${e.id} ep ${e.ep}` : '', e.category ? `${e.content || ''}/${e.category}` : '', e.tag, e.search ? `“${e.search}”` : '', e.code ? `code ${e.code}` : '', e.attempt ? `attempt ${e.attempt}` : ''].filter(Boolean).join(' · '))}</td><td class="mut">${esc(e.ip)}</td></tr>`).join('') || '<tr><td colspan=5 class="mut">No activity.</td></tr>'}</table>`;
        $('uf').onchange = (e) => { window.__u = e.target.value; render(); };
        $('clr').onclick = async () => { if (confirm('Clear the activity log?')) { await api('/api/share/activity/clear', {}); render(); } };
        timer = setTimeout(render, 8000);
      }
    } catch (e) { if (e.message !== 'locked') v.textContent = `Error: ${e.message}`; }
  }
  boot();
})();
