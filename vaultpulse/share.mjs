// VaultPulse guest sharing: personal invite link + auto-generated one-time passcode.
// Guests only ever reach a separate loopback listener (GUEST_PORT) that the tunnel forwards to.
// That listener whitelists a tiny read-only surface; owner/vault routes are unreachable from it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { addLine } from './console-capture.mjs'; // owner-only, memory-only console (never written to disk)

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const MAX_ATTEMPTS = 5;
const EPHEMERAL = process.env.SHARE_EPHEMERAL !== '0'; // guest data erased on logout / session end
const hasTor = () => { try { return spawnSync('tor', ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
const GUEST_ALLOWED_GET = new Set(['/', '/index.html', '/app.js', '/styles.css', '/api/adult/feed', '/api/adult/categories', '/api/adult/stream-info', '/api/vault/status', '/api/vault/preferences', '/api/vault/history', '/api/vault/bookmarks']);
const GUEST_ALLOWED_WRITE = new Set(['/api/guest/logout', '/api/vault/preferences', '/api/vault/history', '/api/vault/bookmarks']); // no-op stubs

const genPasscode = () => {
  const b = crypto.randomBytes(8);
  const s = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};
const normPass = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const safeEq = (a, b) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

// SHARING IS OFF BY DEFAULT. The guest listener is not even started unless VAULTPULSE_SHARE=1.
export const SHARING_ENABLED = process.env.VAULTPULSE_SHARE === '1';

export function initShare({ mainServer, dataDir, guestPort }) {
  const invites = new Map();   // token -> invite
  const sessions = new Map();  // sid -> { inviteId, label, expiresAt, hits: number[] }
  const AUDIT = path.join(dataDir, 'share.log');
  const ACTIVITY = path.join(dataDir, 'share_activity.jsonl');
  const USERS_FILE = path.join(dataDir, 'share_users.json');
  const users = new Map(); // name -> { name, createdAt, blocked, note }
  try { for (const u of JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))) users.set(u.name, u); } catch {}
  // Ephemeral mode persists only blocked users (so a block survives restarts); everything else is memory-only
  const saveUsers = () => { try { fs.writeFileSync(USERS_FILE, JSON.stringify([...users.values()].filter((u) => !EPHEMERAL || u.blocked), null, 2), { mode: 0o600 }); } catch {} };
  if (EPHEMERAL) { try { fs.writeFileSync(ACTIVITY, ''); } catch {} } // wipe any leftovers at startup
  const activity = (() => { try { return fs.readFileSync(ACTIVITY, 'utf8').trim().split('\n').filter(Boolean).slice(-2000).map((l) => JSON.parse(l)); } catch { return []; } })();
  const record = (user, type, detail = {}, ip = '', ua = '') => {
    const ev = { t: new Date().toISOString(), user, type, ...detail }; // no IP / user-agent is ever stored
    activity.push(ev); if (activity.length > 2000) activity.shift();
    if (!EPHEMERAL) { try { fs.appendFileSync(ACTIVITY, JSON.stringify(ev) + '\n', { mode: 0o600 }); } catch {} }
  };
  let tunnel = null;
  let tunnelUrl = '';
  let tunnelWaiters = [];
  let idleSince = 0;

  const purgeUser = (name) => {           // erase a guest's activity from memory and disk
    for (let i = activity.length - 1; i >= 0; i--) if (activity[i].user === name) activity.splice(i, 1);
    try { fs.writeFileSync(ACTIVITY, activity.map((e) => JSON.stringify(e)).join('\n') + (activity.length ? '\n' : ''), { mode: 0o600 }); } catch {}
    const u = users.get(name);
    if (u && !u.blocked && ![...sessions.values()].some((x) => x.label === name) && ![...invites.values()].some((i) => i.label === name && statusOf(i) === 'pending')) { users.delete(name); saveUsers(); }
  };
  const endSession = (sid) => {
    const x = sessions.get(sid); if (!x) return;
    addLine('log', `GUEST LOGOUT/END user="${x.label}"  id=${x.inviteId}${EPHEMERAL ? '  (their data erased)' : ''}`, 'share');
    sessions.delete(sid);
    if (EPHEMERAL) { for (const [t, i] of invites) if (i.id === x.inviteId) invites.delete(t); purgeUser(x.label); }
  };
  const audit = (msg) => { try { fs.appendFileSync(AUDIT, `${new Date().toISOString()} ${msg}\n`); } catch {} };
  const now = () => Date.now();
  const statusOf = (i) => (i.revoked ? 'revoked' : i.used ? 'redeemed' : now() > i.expiresAt ? 'expired' : 'pending');

  // ------------------------------- tunnel (on demand) -------------------------------
  let network = ''; // 'tor' | 'pinggy' for the running tunnel
  const torDir = path.join(dataDir, 'tor');
  function startTor() {
    fs.rmSync(torDir, { recursive: true, force: true }); // fresh onion address every time (nothing persists)
    fs.mkdirSync(path.join(torDir, 'data'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(torDir, 'hs'), { recursive: true, mode: 0o700 });
    const rc = path.join(torDir, 'torrc');
    fs.writeFileSync(rc, ['DataDirectory ' + path.join(torDir, 'data'), 'SocksPort 0', 'ClientOnly 1', 'AvoidDiskWrites 1',
      'HiddenServiceDir ' + path.join(torDir, 'hs'), `HiddenServicePort 80 127.0.0.1:${guestPort}`,
      'ReachableAddresses *:443,*:80', 'Log notice stdout'].join('\n') + '\n', { mode: 0o600 });
    tunnel = spawn('tor', ['-f', rc], { stdio: ['ignore', 'pipe', 'pipe'] });
    const onOut = (chunk) => {
      if (/Bootstrapped 100%/.test(chunk.toString())) {
        try {
          const host = fs.readFileSync(path.join(torDir, 'hs', 'hostname'), 'utf8').trim();
          tunnelUrl = `http://${host}`; tunnelWaiters.splice(0).forEach((w) => w.resolve(tunnelUrl)); audit('tor onion up');
        } catch (e) { tunnelWaiters.splice(0).forEach((w) => w.reject(e)); }
      }
    };
    tunnel.stdout.on('data', onOut); tunnel.stderr.on('data', onOut);
    tunnel.on('error', (e) => { tunnelWaiters.splice(0).forEach((w) => w.reject(e)); tunnel = null; tunnelUrl = ''; });
    tunnel.on('exit', () => {
      tunnel = null; tunnelUrl = ''; audit('tor down');
      fs.rmSync(torDir, { recursive: true, force: true });
      tunnelWaiters.splice(0).forEach((w) => w.reject(new Error('Tor exited before it came up')));
    });
  }
  function startTunnel(net) {
    if (tunnel) return;
    tunnelUrl = ''; network = net;
    if (net === 'tor') return startTor();
    const args = ['-p', '443', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${path.join(dataDir, 'share_known_hosts')}`,
      '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'IdentitiesOnly=yes',
      `-R0:127.0.0.1:${guestPort}`, 'a.pinggy.io'];
    tunnel = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const parse = (chunk) => {
      const m = chunk.toString().match(/https:\/\/[a-zA-Z0-9.-]+\.(?:free\.pinggy\.net|pinggy-free\.link)/);
      if (m) { tunnelUrl = m[0]; tunnelWaiters.splice(0).forEach((w) => w.resolve(tunnelUrl)); audit('tunnel up'); }
    };
    tunnel.stdout.on('data', parse);
    tunnel.stderr.on('data', parse);
    tunnel.on('error', (e) => { tunnelWaiters.splice(0).forEach((w) => w.reject(e)); tunnel = null; tunnelUrl = ''; });
    tunnel.on('exit', () => {
      tunnel = null; tunnelUrl = ''; audit('tunnel down');
      tunnelWaiters.splice(0).forEach((w) => w.reject(new Error('Tunnel closed before it came up')));
      if (hasActive()) setTimeout(() => { if (hasActive()) startTunnel('pinggy'); }, 5000); // free tunnels rotate hourly
    });
  }
  function stopTunnel() { if (tunnel) { try { tunnel.kill('SIGTERM'); } catch {} } }
  function ensureTunnel(net = 'pinggy') {
    if (process.env.SHARE_NO_TUNNEL === '1') { tunnelUrl = `http://127.0.0.1:${guestPort}`; return Promise.resolve(tunnelUrl); }
    if (tunnelUrl) { if (network && network !== net) return Promise.reject(new Error(`A ${network} link is already active. Stop sharing first to switch networks.`)); return Promise.resolve(tunnelUrl); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { reject(new Error(`Tunnel did not come up in ${net === 'tor' ? 120 : 25}s`)); if (!tunnelUrl) stopTunnel(); }, net === 'tor' ? 120000 : 25000);
      tunnelWaiters.push({ resolve: (u) => { clearTimeout(t); resolve(u); }, reject: (e) => { clearTimeout(t); reject(e); } });
      startTunnel(net);
    });
  }
  function hasActive() {
    for (const i of invites.values()) if (statusOf(i) === 'pending') return true;
    for (const s of sessions.values()) if (s.expiresAt > now()) return true;
    return false;
  }
  setInterval(() => {
    for (const [sid, x] of sessions) if (x.expiresAt <= now()) endSession(sid);
    if (tunnel && !hasActive()) { idleSince ||= now(); if (now() - idleSince > 120000) { audit('idle: stopping tunnel'); stopTunnel(); idleSince = 0; } }
    else idleSince = 0;
  }, 30000).unref();

  // ------------------------------- owner API (main listener only) -------------------------------
  const publicView = (i) => {
    const st = statusOf(i);
    return {
      id: i.id, label: i.label, status: st, createdAt: i.createdAt, expiresAt: i.expiresAt, sessionHours: i.sessionMs / 3600000,
      activeSessions: [...sessions.values()].filter((s) => s.inviteId === i.id && s.expiresAt > now()).length,
      passcode: i.passcode, createdBy: i.createdBy || 'owner',
      ...(st === 'pending' ? { link: tunnelUrl ? `${tunnelUrl}/i/${i.token}` : '' } : {}),
    };
  };

  async function handleOwner(req, res, pathname, readJson, sendJson, sendError) {
    if (!SHARING_ENABLED) return sendJson(res, 200, { success: false, disabled: true, error: 'Sharing is turned off. Restart VaultPulse with VAULTPULSE_SHARE=1 to enable it.', invites: [], users: [], events: [], sessions: [], counts: { users: 0, blocked: 0, pending: 0, redeemed: 0, activeSessions: 0 }, tunnel: { up: false, url: '', network: '' }, tor: false, ephemeral: true });
    if (pathname === '/api/share/list' && req.method === 'GET') {
      return sendJson(res, 200, { success: true, tunnel: { up: !!tunnelUrl, url: tunnelUrl, network }, tor: hasTor(), ephemeral: EPHEMERAL, invites: [...invites.values()].map(publicView).reverse() });
    }
    if (pathname === '/api/share/create' && req.method === 'POST') {
      const b = await readJson();
      const label = String(b.label || 'Guest').slice(0, 60).replace(/[^\w .@'-]/g, '');
      if (users.get(label)?.blocked) return sendError(res, 403, `User "${label}" is blocked. Unblock them in the admin console first.`);
      const inviteHours = Math.min(72, Math.max(1, Number(b.inviteHours) || 24));
      const sessionHours = Math.min(24, Math.max(1, Number(b.sessionHours) || 4));
      const inv = { id: crypto.randomBytes(4).toString('hex'), token: crypto.randomBytes(24).toString('base64url'), passcode: genPasscode(),
        label, createdBy: 'owner (vault unlocked)', createdAt: now(), expiresAt: now() + inviteHours * 3600000, sessionMs: sessionHours * 3600000, used: false, revoked: false, attempts: 0 };
      const net = b.network === 'pinggy' ? 'pinggy' : b.network === 'tor' ? 'tor' : (hasTor() ? 'tor' : 'pinggy');
      if (net === 'tor' && !hasTor()) return sendError(res, 501, 'Tor is not installed. Run: sudo apt install tor   (then: sudo systemctl disable --now tor, since VaultPulse runs its own private Tor process)');
      try { await ensureTunnel(net); } catch (e) { return sendError(res, 502, `Could not open tunnel: ${e.message}`); }
      if (!users.has(label)) { users.set(label, { name: label, createdAt: new Date().toISOString(), blocked: false, note: '' }); saveUsers(); }
      invites.set(inv.token, inv);
      record(label, 'invite_created', { invite: inv.id, code: inv.passcode });
      addLine('log', `INVITE CREATED  user="${label}"  passcode=${inv.passcode}  id=${inv.id}  expires=${new Date(inv.expiresAt).toLocaleString()}`, 'share');
      audit(`invite created id=${inv.id} expires=${new Date(inv.expiresAt).toISOString()}`);
      return sendJson(res, 200, { success: true, invite: publicView(inv) });
    }
    if (pathname === '/api/share/revoke' && req.method === 'POST') {
      const { id } = await readJson();
      for (const i of invites.values()) if (i.id === id) {
        i.revoked = true;
        for (const [sid, s] of sessions) if (s.inviteId === id) endSession(sid);
        record(i.label, 'invite_revoked', { invite: id });
        addLine('log', `INVITE REVOKED  user="${i.label}"  id=${id}`, 'share');
        audit(`invite revoked id=${id}`);
      }
      return sendJson(res, 200, { success: true });
    }
    if (pathname === '/api/share/stop' && req.method === 'POST') {
      for (const i of invites.values()) i.revoked = true;
      for (const sid of [...sessions.keys()]) endSession(sid);
      stopTunnel(); audit('sharing stopped: all revoked');
      return sendJson(res, 200, { success: true });
    }
    if (pathname === '/api/share/summary' && req.method === 'GET') {
      const list = [...invites.values()];
      return sendJson(res, 200, { success: true, tunnel: { up: !!tunnelUrl, url: tunnelUrl, network }, tor: hasTor(), ephemeral: EPHEMERAL,
        counts: { users: users.size, blocked: [...users.values()].filter((u) => u.blocked).length, pending: list.filter((i) => statusOf(i) === 'pending').length,
          redeemed: list.filter((i) => i.used).length, activeSessions: [...sessions.values()].filter((x) => x.expiresAt > now()).length },
        sessions: [...sessions.entries()].filter(([, x]) => x.expiresAt > now()).map(([sid, x]) => ({ sid: sid.slice(0, 8), user: x.label, expiresAt: x.expiresAt, hits: x.hits.length, since: x.since, lastSeen: x.lastSeen, ip: x.ip, ua: x.ua })) });
    }
    if (pathname === '/api/share/users' && req.method === 'GET') {
      return sendJson(res, 200, { success: true, users: [...users.values()].map((u) => {
        const ev = activity.filter((e) => e.user === u.name);
        const last = [...ev].reverse().find((e) => e.type !== 'invite_created' && e.type !== 'invite_revoked');
        return { ...u, invites: [...invites.values()].filter((i) => i.label === u.name).length, events: ev.length, lastSeen: last?.t || null, lastIp: last?.ip || '',
          activeSessions: [...sessions.values()].filter((x) => x.label === u.name && x.expiresAt > now()).length };
      }) });
    }
    if (pathname === '/api/share/user' && req.method === 'POST') {
      const { name, action, note } = await readJson();
      const u = users.get(name);
      if (!u) return sendError(res, 404, 'Unknown user');
      if (action === 'block') {
        u.blocked = true;
        for (const i of invites.values()) if (i.label === name) i.revoked = true;
        for (const [sid, x] of sessions) if (x.label === name) sessions.delete(sid);
        record(name, 'user_blocked');
      } else if (action === 'unblock') { u.blocked = false; record(name, 'user_unblocked'); }
      else if (action === 'note') { u.note = String(note || '').slice(0, 200); }
      else if (action === 'delete') {
        for (const i of invites.values()) if (i.label === name) i.revoked = true;
        for (const [sid, x] of sessions) if (x.label === name) sessions.delete(sid);
        users.delete(name); record(name, 'user_deleted');
      } else return sendError(res, 400, 'Unknown action');
      saveUsers();
      return sendJson(res, 200, { success: true });
    }
    if (pathname === '/api/share/activity' && req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      const user = q.get('user'); const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 100));
      const rows = (user ? activity.filter((e) => e.user === user) : activity).slice(-limit).reverse();
      return sendJson(res, 200, { success: true, events: rows });
    }
    if (pathname === '/api/share/activity/clear' && req.method === 'POST') {
      activity.length = 0; try { fs.writeFileSync(ACTIVITY, ''); } catch {}
      return sendJson(res, 200, { success: true });
    }
    return sendError(res, 404, 'Unknown share route');
  }

  // ------------------------------- guest gateway -------------------------------
  const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  const text = (res, code, body, type = 'text/plain; charset=utf-8', extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...SEC, ...extra }); res.end(body); };
  const json = (res, code, obj, extra = {}) => text(res, code, JSON.stringify(obj), 'application/json', extra);
  const notFound = (res) => text(res, 404, 'Not found');
  const cookieOf = (req, name) => (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];
  const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  const PAGE = (token) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Private Invite</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c10;color:#f0f2f5;font-family:system-ui,sans-serif}
form{background:#15161e;border:1px solid #272938;border-radius:14px;padding:28px;width:min(92vw,360px)}h1{font-size:18px;margin:0 0 6px}p{color:#9aa0a6;font-size:13px;margin:0 0 16px}
input{width:100%;box-sizing:border-box;padding:12px;font-size:20px;letter-spacing:3px;text-align:center;text-transform:uppercase;border-radius:8px;border:1px solid #272938;background:#1f202b;color:#fff}
button{margin-top:14px;width:100%;padding:12px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-weight:600;font-size:15px;cursor:pointer}#e{color:#f43f5e;font-size:13px;margin-top:10px;min-height:16px}</style></head>
<body><form id="f"><h1>🔒 Private invite</h1><p>Enter the one-time passcode you were sent. It works once. While you are logged in the host can see what you browse; it is erased when you log out. No IP address is stored.</p>
<input id="p" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX" maxlength="9" autofocus><button>Enter</button><div id="e"></div></form>
<script>document.getElementById('f').addEventListener('submit',async(ev)=>{ev.preventDefault();const e=document.getElementById('e');e.textContent='';
const r=await fetch('/i/${token}/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode:document.getElementById('p').value})});
const d=await r.json().catch(()=>({}));if(d.success){location.replace('/');}else{e.textContent=d.error||'Invalid';}});</script></body></html>`;

  const guest = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      const m = /^\/i\/([A-Za-z0-9_-]{20,64})(\/redeem)?$/.exec(p);
      if (m) {
        const inv = invites.get(m[1]);
        const valid = inv && statusOf(inv) === 'pending';
        if (!m[2] && req.method === 'GET') {
          if (!valid) return notFound(res);
          return text(res, 200, PAGE(inv.token), 'text/html; charset=utf-8', { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
        }
        if (m[2] && req.method === 'POST') {
          if (valid && users.get(inv.label)?.blocked) { inv.revoked = true; return json(res, 410, { success: false, error: 'This invite is no longer valid.' }); }
          if (!valid) return json(res, 410, { success: false, error: 'This invite is no longer valid.' });
          let body = ''; for await (const c of req) { body += c; if (body.length > 1024) return json(res, 413, { success: false, error: 'Too large' }); }
          let pass = ''; try { pass = normPass(JSON.parse(body).passcode); } catch {}
          if (!safeEq(pass, normPass(inv.passcode))) {
            inv.attempts++;
            audit(`bad passcode id=${inv.id} attempt=${inv.attempts}`);
            record(inv.label, 'bad_passcode', { attempt: inv.attempts, invite: inv.id }, '', '');
            addLine('warn', `BAD PASSCODE    user="${inv.label}"  id=${inv.id}  attempt ${inv.attempts}/${MAX_ATTEMPTS}  ip=${ipOf(req)}`, 'share');
            await new Promise((r) => setTimeout(r, 1000));
            if (inv.attempts >= MAX_ATTEMPTS) { inv.revoked = true; audit(`invite burned id=${inv.id} (too many attempts)`); addLine('error', `INVITE BURNED   user="${inv.label}"  id=${inv.id} (too many wrong passcodes)`, 'share'); return json(res, 429, { success: false, error: 'Too many attempts. Invite disabled.' }); }
            return json(res, 401, { success: false, error: `Wrong passcode (${MAX_ATTEMPTS - inv.attempts} attempts left)` });
          }
          inv.used = true; // single use: consumed on first success
          const sid = crypto.randomBytes(32).toString('base64url');
          sessions.set(sid, { inviteId: inv.id, label: inv.label, expiresAt: now() + inv.sessionMs, hits: [], since: now(), ip: ipOf(req), ua: String(req.headers['user-agent'] || '').slice(0, 120), lastSeen: now() }); // live-only, memory
          record(inv.label, 'login', { invite: inv.id, code: inv.passcode }, '', '');
          addLine('log', `GUEST LOGIN     user="${inv.label}"  passcode=${inv.passcode}  id=${inv.id}  ip=${ipOf(req)}`, 'share');
          audit(`invite redeemed id=${inv.id}`);
          const maxAge = Math.floor(inv.sessionMs / 1000);
          return json(res, 200, { success: true }, { 'Set-Cookie': `vp_guest=${sid}; HttpOnly;${tunnelUrl.startsWith('https') ? ' Secure;' : ''} SameSite=Strict; Path=/; Max-Age=${maxAge}` });
        }
        return notFound(res);
      }

      const sid = cookieOf(req, 'vp_guest');
      const sess = sid && sessions.get(sid);
      if (!sess || sess.expiresAt <= now()) return notFound(res);
      const allowed = req.method === 'GET' || req.method === 'HEAD' ? GUEST_ALLOWED_GET.has(p) : GUEST_ALLOWED_WRITE.has(p);
      if (!allowed) return notFound(res);
      sess.lastSeen = now(); sess.ip = ipOf(req) || sess.ip;
      sess.hits = sess.hits.filter((t) => now() - t < 60000); sess.hits.push(now());
      if (sess.hits.length > 120) return json(res, 429, { success: false, error: 'Slow down' });

      if (p === '/api/guest/logout' && req.method === 'POST') {
        endSession(sid);
        return json(res, 200, { success: true }, { 'Set-Cookie': 'vp_guest=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      // Vault-content routes: guests get empty, non-persistent stubs (never the owner's data)
      if (p === '/api/vault/status') return json(res, 200, { success: true, configured: true, unlocked: true, guest: true, autoLockMinutes: 0 });
      if (p === '/api/vault/preferences') return json(res, 200, { success: true, preferences: { defaultMode: 'hentai', uncensoredOnly: true, favoriteGenres: [] } });
      if (p === '/api/vault/history') return json(res, 200, { success: true, history: [] });
      if (p === '/api/vault/bookmarks') return json(res, 200, { success: true, bookmarks: [] });

      if (p === '/api/adult/feed') {
        const g = (k) => u.searchParams.get(k);
        if (g('search') || g('page') === '1' || !g('page')) record(sess.label, 'browse', { content: g('type') || 'hentai', category: g('category') || 'trending', search: g('search') || '', tag: g('categoryTag') || g('genre') || '' }, '', '');
      } else if (p === '/api/adult/stream-info') {
        record(sess.label, 'watch', { id: u.searchParams.get('id'), ep: u.searchParams.get('ep') || '1' }, '', '');
      }
      req.isGuest = true;
      mainServer.emit('request', req, res); // feed / stream-info / static only (whitelisted above)
    } catch (e) {
      if (!res.headersSent) json(res, 500, { success: false, error: 'Server error' });
    }
  });
  if (SHARING_ENABLED) guest.listen(guestPort, '127.0.0.1');
  else addLine('log', 'Sharing is OFF: guest listener not started, no tunnel can be opened.', 'share');
  return { handleOwner };
}
