// Owner-only Share panel: generate invite link + one-time passcode, list, revoke.
(() => {
  const btn = document.getElementById('share-btn');
  if (!btn) return;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tok = () => sessionStorage.getItem('vault_token') || '';
  const api = (path, body) => fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Vault-Token': tok() },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

  const wrap = document.createElement('div');
  wrap.className = 'modal-overlay';
  wrap.style.display = 'none';
  wrap.innerHTML = `<div class="modal-content" style="max-width:640px;width:94%;max-height:88vh;overflow:auto;padding:22px">
    <h2 style="margin-top:0">🔗 Private invites</h2>
    <p style="color:#9aa0a6;font-size:13px">Each invite = a personal link + a one-time passcode. Passcode works once, then the link is dead. The public tunnel only runs while an invite is active.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
      <input id="sh-label" placeholder="Who is it for? (label)" maxlength="60" style="flex:1;min-width:160px;padding:9px;border-radius:6px;border:1px solid #272938;background:#1f202b;color:#fff">
      <select id="sh-hours" style="padding:9px;border-radius:6px;border:1px solid #272938;background:#1f202b;color:#fff"><option value="1">Session 1h</option><option value="4" selected>Session 4h</option><option value="12">Session 12h</option><option value="24">Session 24h</option></select>
      <select id="sh-net" style="padding:9px;border-radius:6px;border:1px solid #272938;background:#1f202b;color:#fff"><option value="tor">Tor (anonymous, guest needs Tor Browser)</option><option value="pinggy">Regular link (Pinggy)</option></select>
      <button id="sh-create" class="btn-stealth" type="button">Generate</button>
    </div>
    <div id="sh-msg" style="font-size:13px;min-height:18px;color:#9aa0a6"></div>
    <div id="sh-list"></div>
    <div style="display:flex;gap:8px;margin-top:14px"><button id="sh-stop" class="btn-danger" type="button">Revoke all &amp; stop sharing</button><button id="sh-close" class="btn-stealth" type="button">Close</button></div></div>`;
  document.body.appendChild(wrap);
  const $ = (id) => wrap.querySelector('#' + id);
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); $('sh-msg').textContent = 'Copied.'; } catch { $('sh-msg').textContent = 'Copy failed; select and copy manually.'; } };

  async function refresh() {
    const d = await api('/api/share/list');
    const tn = $('sh-net').querySelector('option[value=tor]'); if (d.tor === false) { tn.textContent = 'Tor (not installed: sudo apt install tor)'; }
    if (d.disabled) { $('sh-create').disabled = true; $('sh-stop').disabled = true; $('sh-list').innerHTML = ''; $('sh-msg').textContent = d.error; return; }
    if (!d.success) { $('sh-list').innerHTML = ''; $('sh-msg').textContent = d.error || 'Unlock the vault first.'; return; }
    $('sh-list').innerHTML = d.invites.map((i) => `
      <div style="border:1px solid #272938;border-radius:10px;padding:10px;margin-top:8px;background:#15161e">
        <b>${esc(i.label)}</b> · <span>${esc(i.status)}</span>${i.activeSessions ? ` · ${i.activeSessions} active` : ''}
        <div style="font-size:12px;color:#9aa0a6">expires ${new Date(i.expiresAt).toLocaleString()}</div>
        <div style="font-size:12px;color:#9aa0a6;margin-top:4px">passcode <b style="font-size:15px;letter-spacing:2px;color:#f0f2f5">${esc(i.passcode)}</b> · created by ${esc(i.createdBy)} at ${new Date(i.createdAt).toLocaleTimeString()}</div>
        ${i.status === 'pending' ? `<div style="margin-top:6px;word-break:break-all;font-size:13px">${i.link ? esc(i.link) : '(tunnel reconnecting...)'}</div>
          <button class="btn-stealth" data-c="${esc(i.link)}" type="button">Copy link</button>
          <button class="btn-stealth" data-c="${esc(i.passcode)}" type="button">Copy passcode</button>
          <button class="btn-stealth" data-c="Link: ${esc(i.link)}\nPasscode: ${esc(i.passcode)}" type="button">Copy both</button>` : ''}
        ${i.status === 'pending' || i.activeSessions ? `<button class="btn-danger" data-r="${i.id}" type="button">Revoke</button>` : ''}
      </div>`).join('') || '<div style="color:#9aa0a6;margin-top:8px">No invites yet.</div>';
  }

  btn.addEventListener('click', () => { wrap.style.display = 'flex'; $('sh-msg').textContent = ''; refresh(); });
  $('sh-close').addEventListener('click', () => { wrap.style.display = 'none'; });
  $('sh-create').addEventListener('click', async () => {
    $('sh-msg').textContent = 'Opening private tunnel...';
    const d = await api('/api/share/create', { label: $('sh-label').value || 'Guest', sessionHours: $('sh-hours').value, network: $('sh-net').value });
    $('sh-msg').textContent = d.success ? 'Invite ready. Send the link and passcode.' : `Error: ${d.error}`;
    if (d.success) $('sh-label').value = '';
    refresh();
  });
  $('sh-stop').addEventListener('click', async () => { await api('/api/share/stop', {}); $('sh-msg').textContent = 'All invites revoked; tunnel stopped.'; refresh(); });
  wrap.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-c]'); if (c) return copy(c.dataset.c);
    const r = e.target.closest('[data-r]'); if (r) { await api('/api/share/revoke', { id: r.dataset.r }); refresh(); }
  });
})();
