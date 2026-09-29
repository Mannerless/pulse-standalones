// Media Downloader panel: download any video/audio URL via /api/media/*
(() => {
  const btn = document.getElementById('btn-media-dl');
  if (!btn) return;
  // Owner-only feature: hide for visitors arriving via the public tunnel
  if (!/^(127\.0\.0\.1|localhost|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)) { btn.style.display = 'none'; return; }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.style.display = 'none';
  wrap.innerHTML = `
    <div class="modal-card md-card" role="dialog" aria-label="Media Downloader">
      <button class="modal-close" type="button" id="md-close">✕</button>
      <h2>📥 Media Downloader</h2>
      <div class="md-row"><input type="text" id="md-url" placeholder="Paste a video / audio / playlist URL (any site yt-dlp supports)" autocomplete="off"></div>
      <div class="md-row">
        <select id="md-mode"><option value="video">Video (MP4)</option><option value="audio">Audio (MP3)</option></select>
        <select id="md-quality"><option value="best">Best quality</option><option value="1080">≤1080p</option><option value="720">≤720p</option><option value="480">≤480p</option></select>
        <label><input type="checkbox" id="md-playlist"> Whole playlist</label>
        <label><input type="checkbox" id="md-subs"> Subtitles</label>
        <button class="md-btn" id="md-start" type="button">Download</button>
      </div>
      <div class="md-row" id="md-info"></div>
      <div id="md-jobs"></div>
    </div>`;
  document.body.appendChild(wrap);
  const $ = (id) => wrap.querySelector('#' + id);
  let timer = null;

  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  async function refresh() {
    try {
      const d = await (await fetch('/api/media/jobs')).json();
      const missing = Object.entries(d.tools || {}).filter(([, ok]) => !ok).map(([k]) => k);
      $('md-info').textContent = (missing.length ? `Missing tools: ${missing.join(', ')}. ` : '') + `Saving to: ${d.dir}`;
      $('md-jobs').innerHTML = (d.jobs || []).map((j) => {
        const done = j.status === 'done';
        const actions = [];
        if (done && j.files.length) actions.push(`<button class="md-btn sec" data-a="play" data-id="${j.id}">▶ Play</button><a class="md-btn sec" style="text-decoration:none" href="/api/media/file?id=${j.id}&i=0&dl=1">⬇ Save</a>`);
        if (j.status === 'downloading' || j.status === 'queued') actions.push(`<button class="md-btn bad" data-a="cancel" data-id="${j.id}">Cancel</button>`);
        if (j.status === 'failed' || j.status === 'cancelled') actions.push(`<button class="md-btn sec" data-a="retry" data-id="${j.id}">Retry</button>`);
        if (j.status !== 'downloading') actions.push(`<button class="md-btn sec" data-a="remove" data-id="${j.id}">Remove entry</button>`);
        if (done && j.files.length) actions.push(`<button class="md-btn bad" data-a="delete" data-id="${j.id}">🗑 Delete file</button>`);
        return `<div class="md-job ${esc(j.status)}"><div class="t">${esc(j.title)}</div>
          <div class="s">${esc(j.mode)} · ${esc(j.status)}${j.status === 'downloading' ? ` · ${j.percent.toFixed(1)}% · ${esc(j.speed)} · ETA ${esc(j.eta)}` : ''}${j.error ? ` · ${esc(j.error)}` : ''}</div>
          ${j.status === 'downloading' ? `<div class="md-bar"><i style="width:${j.percent}%"></i></div>` : ''}
          <div class="md-row">${actions.join('')}</div><div id="pl-${j.id}"></div></div>`;
      }).join('') || '<div class="md-row">No downloads yet.</div>';
      const busy = (d.jobs || []).some((j) => j.status === 'downloading' || j.status === 'queued');
      clearTimeout(timer);
      if (wrap.style.display !== 'none') timer = setTimeout(refresh, busy ? 1000 : 5000);
    } catch { clearTimeout(timer); timer = setTimeout(refresh, 5000); }
  }

  btn.addEventListener('click', () => { wrap.style.display = 'flex'; refresh(); });
  $('md-close').addEventListener('click', () => { wrap.style.display = 'none'; clearTimeout(timer); });
  wrap.addEventListener('click', (e) => { if (e.target === wrap) $('md-close').click(); });
  $('md-start').addEventListener('click', async () => {
    const url = $('md-url').value.trim();
    if (!url) return;
    const r = await post('/api/media/start', { url, mode: $('md-mode').value, quality: $('md-quality').value, playlist: $('md-playlist').checked, subs: $('md-subs').checked });
    if (!r.success) { $('md-info').textContent = `Error: ${r.error || r.message || 'failed'}`; return; }
    $('md-url').value = '';
    refresh();
  });
  $('md-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('md-start').click(); });
  wrap.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const { a, id } = b.dataset;
    if (a === 'play') {
      const slot = wrap.querySelector('#pl-' + id);
      slot.innerHTML = `<video class="md-player" controls autoplay src="/api/media/file?id=${id}&i=0"></video>`;
      return;
    }
    if (a === 'delete' && !confirm('Delete the downloaded file(s) from disk?')) return;
    const r = await post('/api/media/action', { id, action: a });
    if (!r.success) $('md-info').textContent = `Error: ${r.error || r.message}`;
    refresh();
  });
})();
