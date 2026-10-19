// AnimePulse Frontend Logic
(function () {
  'use strict';

  // State
  let currentMode = 'trending';
  let currentGenre = 'All';
  let currentSearch = '';
  let currentAudioFilter = 'all';
  let currentSort = 'trending';
  let currentPage = 1;
  let activeAnimeList = [];
  let historyList = [];
  let currentModalAnime = null;
  let searchDebounceTimer = null;
  let currentRemoteUrl = '';
  // Live-action TV/movie tabs
  const LIVE_KIND = { 'live-tv': 'tv', 'live-movies': 'movie' };
  let currentLiveGenre = 'All';
  let liveGenres = null;
  let liveFeedSeq = 0;
  let liveModalSeq = 0;
  const LIVE_SINCE_YEAR = 2020;
  const LIVE_RECENT_KEY = 'animepulse.liveRecentOnly';
  let liveRecentOnly = true; // charts show 2020+ titles unless the viewer turns it off
  try { liveRecentOnly = localStorage.getItem(LIVE_RECENT_KEY) !== '0'; } catch (_) {}

  // DOM Elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const genreChips = document.querySelectorAll('.genre-chip');
  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const sectionTitle = document.getElementById('section-title');
  const resultsCount = document.getElementById('results-count');
  const animeGrid = document.getElementById('anime-grid');
  const historyContainer = document.getElementById('history-container');
  const downloadsContainer = document.getElementById('downloads-container');
  const downloadsTree = document.getElementById('downloads-tree');
  const historyListEl = document.getElementById('history-list');
  const historyBadge = document.getElementById('history-badge');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const btnSyncHistory = document.getElementById('btn-sync-history');
  const loadingState = document.getElementById('loading-state');
  const emptyState = document.getElementById('empty-state');
  const toast = document.getElementById('toast');
  const animeGenreBar = document.getElementById('genre-bar');
  const liveGenreBar = document.getElementById('live-genre-bar');
  const liveModal = document.getElementById('live-modal');
  const liveModalCloseBtn = document.getElementById('live-modal-close-btn');
  const liveModalBanner = document.getElementById('live-modal-banner');
  const liveModalTitle = document.getElementById('live-modal-title');
  const liveModalSub = document.getElementById('live-modal-sub');
  const liveModalBody = document.getElementById('live-modal-body');
  const loadingText = document.querySelector('#loading-state span');
  const LOADING_TEXT_ANIME = loadingText ? loadingText.textContent : '';
  const SEARCH_PLACEHOLDER_ANIME = document.getElementById('search-input')?.placeholder || '';
  const outsideViewersCount = document.getElementById('outside-viewers-count');
  const btnShareLink = document.getElementById('btn-share-link');

  // Modal Elements
  const detailModal = document.getElementById('detail-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalBanner = document.getElementById('modal-banner');
  const modalTitle = document.getElementById('modal-title');
  const modalSubTitle = document.getElementById('modal-sub-title');
  const modalCover = document.getElementById('modal-cover');
  const modalScore = document.getElementById('modal-score');
  const modalEpisodes = document.getElementById('modal-episodes');
  const modalStatus = document.getElementById('modal-status');
  const modalStudio = document.getElementById('modal-studio');
  const modalSubAvail = document.getElementById('modal-sub-avail');
  const modalDubAvail = document.getElementById('modal-dub-avail');
  const modalServerButtonsInApp = document.getElementById('modal-server-buttons-inapp');
  const modalServerButtonsExternal = document.getElementById('modal-server-buttons-external');
  const modalSynopsis = document.getElementById('modal-synopsis');
  const modalGenres = document.getElementById('modal-genres');
  const modalEpInput = document.getElementById('modal-ep-input');
  const modalStatusSelect = document.getElementById('modal-status-select');
  const modalSaveHistoryBtn = document.getElementById('modal-save-history-btn');
  const btnDisplayPin = document.getElementById('btn-display-pin');
  const displayModal = document.getElementById('display-modal');
  const displayModalCloseBtn = document.getElementById('display-modal-close-btn');
  const btnDisplayCancel = document.getElementById('btn-display-cancel');
  const btnExecutePin = document.getElementById('btn-execute-pin');
  const monitorChipsGrid = document.getElementById('monitor-chips-grid');
  const coverageOptionsGrid = document.getElementById('coverage-options-grid');

  let detectedMonitors = [];
  let selectedMonitorId = '';
  let selectedCoverageMode = 'full';
  let selectedCoverageSide = 'left';

  // Episode Navigator & Counterparts Elements
  const btnPrevEp = document.getElementById('btn-prev-ep');
  const btnNextEp = document.getElementById('btn-next-ep');
  const activeEpDisplay = document.getElementById('active-ep-display');
  const epButtonsGrid = document.getElementById('ep-buttons-grid');
  const counterpartsSection = document.getElementById('counterparts-section');
  const counterpartsList = document.getElementById('counterparts-list');
  const counterpartsCount = document.getElementById('counterparts-count');
  let currentSelectedEp = 1;

  // In-App Theater Player Elements
  const playerTheaterBox = document.getElementById('player-theater-box');
  const playerFrame = document.getElementById('player-frame');
  const playerStreamTitle = document.getElementById('player-stream-title');
  const btnPlayerClose = document.getElementById('btn-player-close');
  const btnPlayerExternal = document.getElementById('btn-player-external');
  const btnPlayerPrevEp = document.getElementById('btn-player-prev-ep');
  const btnPlayerNextEp = document.getElementById('btn-player-next-ep');
  const playerServerChips = document.getElementById('player-server-chips');
  let activeStreamUrl = '';
  let activeInAppServers = [];

  // Native Local Video Player & Completion Elements
  const nativePlayer = document.getElementById('native-player');
  if (nativePlayer) {
    const savedMuted = localStorage.getItem('ap_player_muted');
    nativePlayer.muted = savedMuted === 'true';
    nativePlayer.defaultMuted = false;
    const savedVol = localStorage.getItem('ap_player_volume');
    if (savedVol !== null) {
      const v = parseFloat(savedVol);
      if (!isNaN(v) && v >= 0 && v <= 1) nativePlayer.volume = v;
    } else {
      nativePlayer.volume = 1.0;
    }
  }
  const completionOverlay = document.getElementById('completion-action-overlay');
  const completionTitle = document.getElementById('completion-title');
  const btnCompletionTrash = document.getElementById('btn-completion-trash');
  const btnCompletionSave = document.getElementById('btn-completion-save');
  const btnCompletionNext = document.getElementById('btn-completion-next');

  // Pre-Download Section Elements
  const btnPrebufferEp = document.getElementById('btn-prebuffer-ep');
  const btnPrebufferText = document.getElementById('btn-prebuffer-text');
  const btnDownloadSeriesModal = document.getElementById('btn-download-series-modal');
  const downloadProgressBox = document.getElementById('download-progress-box');
  const dlStatusTitle = document.getElementById('dl-status-title');
  const dlMetaStats = document.getElementById('dl-meta-stats');
  const dlProgressFill = document.getElementById('dl-progress-fill');
  const btnPlayCachedStream = document.getElementById('btn-play-cached-stream');
  const btnCancelOrTrash = document.getElementById('btn-cancel-or-trash');

  let downloadPollTimer = null;
  let activePlayingDownloadKey = null;

  // Toast Helper
  let toastTimer = null;
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // Stats & Remote Family Access
  // ---------------------------------------------------------------------------

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.success) {
        if (outsideViewersCount) {
          outsideViewersCount.textContent = data.outsideViews || 0;
        }
        if (data.remoteUrl) {
          currentRemoteUrl = data.remoteUrl;
          if (btnShareLink) {
            btnShareLink.title = `Live Family Tunnel: ${data.remoteUrl} (Click to copy)`;
          }
        }
      }
    } catch (err) {
      console.warn('[AnimePulse] loadStats error:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Data Fetchers
  // ---------------------------------------------------------------------------

  // Pager (Prev / page numbers / Next) shown under the grid for paged feeds.
  let pagerEl = null;

  function hidePager() {
    if (pagerEl) pagerEl.style.display = 'none';
  }

  function goToPage(page) {
    if (page < 1 || page === currentPage) return;
    currentPage = page;
    if (sectionTitle && sectionTitle.scrollIntoView) {
      sectionTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    loadFeed();
  }

  function renderPager(info) {
    if (!pagerEl) {
      pagerEl = document.createElement('nav');
      pagerEl.id = 'feed-pager';
      pagerEl.className = 'feed-pager';
      pagerEl.setAttribute('aria-label', 'Catalog pages');
      animeGrid.insertAdjacentElement('afterend', pagerEl);
    }
    const lastPage = info.lastPage || 0;
    const hasNext = !!info.hasNextPage;
    if (currentPage === 1 && !hasNext) {
      pagerEl.style.display = 'none';
      return;
    }
    pagerEl.textContent = '';

    const makeBtn = (label, page, opts = {}) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pager-btn' + (opts.active ? ' active' : '');
      b.textContent = label;
      if (opts.disabled) b.disabled = true;
      if (opts.active) b.setAttribute('aria-current', 'page');
      if (!opts.disabled && !opts.active) b.addEventListener('click', () => goToPage(page));
      return b;
    };

    pagerEl.appendChild(makeBtn('← Prev', currentPage - 1, { disabled: currentPage <= 1 }));
    if (lastPage > 1) {
      for (let p = 1; p <= lastPage; p++) {
        pagerEl.appendChild(makeBtn(String(p), p, { active: p === currentPage }));
      }
    } else {
      pagerEl.appendChild(makeBtn(`Page ${currentPage}`, currentPage, { active: true }));
    }
    pagerEl.appendChild(makeBtn('Next →', currentPage + 1, { disabled: !hasNext }));
    pagerEl.style.display = 'flex';
  }

  // ---------- Downloads view (read-only file tree). Names are rendered with textContent, never innerHTML. ----------
  const fmtSize = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B');
  const fmtDate = (ms) => { try { return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (_) { return ''; } };
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function fetchTree(cat, rel) {
    const r = await fetch(`/api/files/tree?cat=${encodeURIComponent(cat)}&path=${encodeURIComponent(rel || '')}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || j.message || `HTTP ${r.status}`);
    return j;
  }

  // Watched / partial / completed badge for a playable file row
  function setBadge(slot, st) {
    slot.textContent = '';
    if (!st || !st.state || st.state === 'unwatched') return;
    const pct = Math.round((st.pct || 0) * 100);
    const b = mk('span', `dl-badge dl-badge-${st.state}`, st.state === 'completed' ? '✓ Completed' : st.state === 'partial' ? `◐ ${pct}% watched` : '● Watched');
    slot.appendChild(b);
  }

  // In-app player for files listed in the Downloads view (streams from /api/files/stream, supports seeking and .vtt subtitles).
  function openPlayer(cat, en, siblings, onState) {
    const old = document.getElementById('dl-player'); if (old) old.remove();
    const overlay = mk('div', 'dl-player'); overlay.id = 'dl-player';
    const box = mk('div', 'dl-player-box');
    const bar = mk('div', 'dl-player-bar');
    bar.appendChild(mk('span', 'dl-player-title', en.name));
    const closeBtn = mk('button', 'dl-player-close', '✕ Close'); closeBtn.type = 'button'; bar.appendChild(closeBtn);
    const media = document.createElement(en.kind === 'audio' ? 'audio' : 'video');
    media.controls = true; media.autoplay = true; media.className = 'dl-player-media';
    media.muted = false; media.volume = 1.0;
    const url = (p) => `/api/files/stream?cat=${encodeURIComponent(cat.id)}&path=${encodeURIComponent(p)}`;
    media.src = url(en.path);
    const stem = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();
    const sub = (siblings || []).find((x) => x.type === 'file' && x.ext === '.vtt' && stem(x.name) === stem(en.name));
    if (sub && en.kind === 'video') {
      const t = document.createElement('track'); t.kind = 'subtitles'; t.label = 'Subtitles'; t.srclang = 'en'; t.default = true; t.src = url(sub.path); media.appendChild(t);
    }
    let lastSent = 0;                                                  // save progress: every ~10s, on pause, on end, and on close
    const send = () => {
      const d = media.duration, t = media.currentTime;
      if (!isFinite(d) || d <= 0 || t < 1) return;
      fetch('/api/files/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ cat: cat.id, path: en.path, position: t, duration: d }) })
        .then((r) => r.json()).then((j) => { if (j && j.success && onState) onState(j.state === 'none' ? null : { state: j.state, pct: j.pct, position: j.position || 0 }); }).catch(() => {});
    };
    media.addEventListener('timeupdate', () => { const n = Date.now(); if (n - lastSent > 10000) { lastSent = n; send(); } });
    media.addEventListener('pause', send); media.addEventListener('ended', send);
    if (en.watch && en.watch.state === 'partial' && en.watch.position > 10) {       // resume where you left off
      media.addEventListener('loadedmetadata', () => { try { media.currentTime = Math.max(0, en.watch.position - 3); } catch (_) {} }, { once: true });
    }
    const msg = mk('div', 'dl-note dl-err'); msg.style.display = 'none';
    media.addEventListener('error', () => { msg.style.display = 'block'; msg.textContent = 'This browser could not play this file (format not supported).'; });
    const onKey = (ev) => { if (ev.key === 'Escape') closeAll(); };
    const closeAll = () => { try { send(); media.pause(); media.removeAttribute('src'); media.load(); } catch (_) {} overlay.remove(); document.removeEventListener('keydown', onKey); };
    closeBtn.addEventListener('click', closeAll);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeAll(); });
    document.addEventListener('keydown', onKey);
    box.appendChild(bar); box.appendChild(media); box.appendChild(msg); overlay.appendChild(box); document.body.appendChild(overlay);
  }

  function fillFolder(body, cat, rel) {
    body.textContent = '';
    body.appendChild(mk('div', 'dl-note', 'Loading…'));
    fetchTree(cat.id, rel).then((data) => {
      body.textContent = '';
      if (data.state !== 'ready') { body.appendChild(mk('div', 'dl-note', data.message)); return; }
      if (!data.entries.length) { body.appendChild(mk('div', 'dl-note', 'This folder is empty.')); return; }
      data.entries.forEach((en) => {
        if (en.type === 'dir') {
          const d = document.createElement('details'); d.className = 'dl-folder';
          const sm = document.createElement('summary');
          sm.appendChild(mk('span', 'dl-ico', '📁'));
          sm.appendChild(mk('span', 'dl-name', en.label || en.name));
          if (en.label) sm.title = en.name;
          sm.appendChild(mk('span', 'dl-meta', en.items == null ? '' : `${en.items} item${en.items === 1 ? '' : 's'}`));
          d.appendChild(sm);
          const inner = mk('div', 'dl-children'); d.appendChild(inner);
          let loaded = false;
          d.addEventListener('toggle', () => { if (d.open && !loaded) { loaded = true; fillFolder(inner, cat, en.path); } });
          body.appendChild(d);
        } else {
          const playable = en.kind === 'video' || en.kind === 'audio';
          const slot = mk('span', 'dl-badge-slot'); if (playable) setBadge(slot, en.watch);
          const row = mk('div', playable ? 'dl-file dl-playable' : 'dl-file');
          row.appendChild(mk('span', 'dl-ico', playable ? '▶' : en.kind === 'subs' ? '💬' : '📄'));
          if (playable) {
            row.tabIndex = 0; row.setAttribute('role', 'button'); row.title = 'Click to play';
            const play = () => openPlayer(cat, en, data.entries, (st) => { en.watch = st; setBadge(slot, st); });
            row.addEventListener('click', play);
            row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); play(); } });
          }
          row.appendChild(mk('span', 'dl-name', en.name));
          row.appendChild(mk('span', 'dl-meta', `${fmtSize(en.size)} · ${fmtDate(en.mtime)}`));
          row.appendChild(slot);
          body.appendChild(row);
        }
      });
      if (data.truncated) body.appendChild(mk('div', 'dl-note', 'Showing the first 500 items.'));
    }).catch((err) => { body.textContent = ''; body.appendChild(mk('div', 'dl-note dl-err', `Could not read this folder: ${err.message}`)); });
  }

  async function renderDownloadsView() {
    sectionTitle.textContent = '📁 Downloads';
    animeGrid.style.display = 'none'; emptyState.style.display = 'none'; loadingState.style.display = 'none';
    historyContainer.style.display = 'none'; hidePager();
    downloadsContainer.style.display = 'flex';
    downloadsTree.textContent = '';
    downloadsTree.appendChild(mk('div', 'dl-note', 'Loading categories…'));
    try {
      const r = await fetch('/api/files/categories'); const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
      downloadsTree.textContent = '';
      resultsCount.textContent = `${j.categories.length} categories`;
      if (j.categories.some((c) => c.state === 'locked')) downloadsTree.appendChild(mk('div', 'dl-banner', '🔒 The external drive is not mounted (locked). Unlock it in the file manager, then press Refresh. Drive categories stay empty until then.'));
      j.categories.forEach((c) => {
        const d = document.createElement('details'); d.className = 'dl-cat';
        const sm = document.createElement('summary');
        sm.appendChild(mk('span', 'dl-ico', c.icon)); sm.appendChild(mk('span', 'dl-name', c.label));
        sm.appendChild(mk('span', `dl-chip dl-${c.state}`, c.state === 'ready' ? `${c.items == null ? 0 : c.items} items` : c.state === 'locked' ? 'Locked' : 'Empty'));
        d.appendChild(sm);
        const body = mk('div', 'dl-children'); body.appendChild(mk('div', 'dl-note', `${c.note}\n${c.root}`)); d.appendChild(body);
        let loaded = false;
        d.addEventListener('toggle', () => { if (d.open && !loaded) { loaded = true; fillFolder(body, c, ''); } });
        downloadsTree.appendChild(d);
      });
    } catch (err) { downloadsTree.textContent = ''; downloadsTree.appendChild(mk('div', 'dl-note dl-err', `Could not load downloads: ${err.message}`)); }
  }

  async function loadFeed() {
    if (currentMode === 'downloads') { renderDownloadsView(); return; }
    if (currentMode === 'history') {
      renderHistoryView();
      return;
    }
    if (isLiveMode()) { loadLiveFeed(); return; }
    liveFeedSeq++; // a pending live response must not paint over this feed
    if (loadingText) loadingText.textContent = LOADING_TEXT_ANIME;

    loadingState.style.display = 'flex';
    emptyState.style.display = 'none';
    animeGrid.style.display = 'none';
    historyContainer.style.display = 'none';
    downloadsContainer.style.display = 'none';
    hidePager();

    const modeLabels = {
      trending: '🔥 Trending Anime',
      popular: '⭐ Most Popular of All Time',
      airing: '📡 Currently Airing This Season',
      top: '✨ Highest Rated Anime',
    };
    sectionTitle.textContent = currentSearch
      ? `Search results for "${currentSearch}"`
      : modeLabels[currentMode] || 'Anime Catalog';

    const modeAtStart = currentMode;
    try {
      let url = currentSearch
        ? `/api/search?q=${encodeURIComponent(currentSearch)}`
        : `/api/feed?mode=${encodeURIComponent(currentMode)}&genre=${encodeURIComponent(currentGenre)}&page=${currentPage}`;

      const res = await fetch(url);
      const data = await res.json();
      if (currentMode !== modeAtStart) return; // user switched tabs while this was loading

      loadingState.style.display = 'none';

      if (!data.success || !Array.isArray(data.media) || data.media.length === 0) {
        emptyState.style.display = 'flex';
        resultsCount.textContent = '0 titles found';
        activeAnimeList = [];
        return;
      }

      activeAnimeList = data.media;
      const info = data.pageInfo || {};
      const paged = !currentSearch && (currentPage > 1 || info.hasNextPage);
      resultsCount.textContent = paged
        ? `Page ${currentPage}${info.lastPage ? ` of ${info.lastPage}` : ''} · ${activeAnimeList.length} titles`
        : `${activeAnimeList.length} titles loaded`;
      renderGrid(activeAnimeList);
      animeGrid.style.display = 'grid';
      if (!currentSearch) renderPager(info);
    } catch (err) {
      if (currentMode !== modeAtStart) return;
      console.error('loadFeed error:', err);
      loadingState.style.display = 'none';
      emptyState.style.display = 'flex';
      resultsCount.textContent = 'Failed to load catalog';
      showToast('Error querying anime database');
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      if (data.success && Array.isArray(data.history)) {
        historyList = data.history;
        if (historyBadge) historyBadge.textContent = historyList.length;
        if (currentMode === 'history') renderHistoryView();
      }
    } catch (err) {
      console.error('loadHistory error:', err);
    }
  }

  async function recordWatchHistory(anime, episodeNumber = 1, status = 'Watching', streamUrl = '') {
    if (!anime) return;
    const title = anime.title?.english || anime.title?.romaji || 'Unknown Anime';
    const payload = {
      id: anime.id,
      title,
      coverImage: anime.coverImage?.large || anime.coverImage?.extraLarge || '',
      lastEpisodeWatched: parseInt(episodeNumber, 10) || 1,
      totalEpisodes: anime.episodes || null,
      status,
      streamUrl: streamUrl || `https://vidsrc.pm/embed/anime/${anime.id}/${parseInt(episodeNumber, 10) || 1}`,
    };

    try {
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        historyList = data.history || [];
        if (historyBadge) historyBadge.textContent = historyList.length;
      }
    } catch (err) {
      console.error('Error saving history:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Grid Rendering
  // ---------------------------------------------------------------------------

  function updateHeroSpotlight(items) {
    const heroSection = document.getElementById('hero-spotlight');
    if (!heroSection) return;
    if (isLiveMode() || currentMode === 'history' || currentMode === 'downloads' || !items || !items.length) {
      heroSection.style.display = 'none';
      return;
    }
    const top = items[0];
    const bannerArt = document.getElementById('hero-banner-art');
    const heroTitle = document.getElementById('hero-title');
    const heroScore = document.getElementById('hero-score');
    const heroStatus = document.getElementById('hero-status');
    const heroFormat = document.getElementById('hero-format');
    const heroGenres = document.getElementById('hero-genres');
    const heroSynopsis = document.getElementById('hero-synopsis');
    const btnHeroStream = document.getElementById('btn-hero-stream');
    const btnHeroDetails = document.getElementById('btn-hero-details');

    const title = top.title?.english || top.title?.romaji || 'Featured Anime';
    const banner = top.bannerImage || top.coverImage?.extraLarge || '';
    if (bannerArt) bannerArt.style.backgroundImage = banner ? `url("${banner}")` : 'none';
    if (heroTitle) heroTitle.textContent = title;
    if (heroScore) heroScore.textContent = top.averageScore ? `⭐ ${top.averageScore}%` : '⭐ Highly Rated';
    if (heroStatus) heroStatus.textContent = top.status === 'RELEASING' ? 'Airing' : (top.status || 'Complete');
    if (heroFormat) heroFormat.textContent = top.format || 'TV Series';
    if (heroSynopsis) {
      const syn = top.description ? top.description.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '') : 'No synopsis available.';
      heroSynopsis.textContent = syn;
    }
    if (heroGenres) {
      heroGenres.innerHTML = '';
      (top.genres || []).slice(0, 4).forEach((g) => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag';
        tag.textContent = g;
        heroGenres.appendChild(tag);
      });
    }

    if (btnHeroStream) {
      btnHeroStream.onclick = () => {
        openModal(top);
        setTimeout(() => {
          const inAppBtn = modalServerButtonsInApp?.querySelector('.btn-server');
          if (inAppBtn) inAppBtn.click();
        }, 400);
      };
    }
    if (btnHeroDetails) {
      btnHeroDetails.onclick = () => openModal(top);
    }

    heroSection.style.display = 'flex';
  }

  function getFilteredAndSortedItems(items) {
    if (!Array.isArray(items)) return [];
    let result = [...items];

    if (currentAudioFilter === 'dub') {
      result = result.filter(a => a.availability?.dub?.available);
    }

    if (currentSort === 'score') {
      result.sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0));
    } else if (currentSort === 'popular') {
      result.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    } else if (currentSort === 'title') {
      result.sort((a, b) => {
        const tA = (a.title?.english || a.title?.romaji || '').toLowerCase();
        const tB = (b.title?.english || b.title?.romaji || '').toLowerCase();
        return tA.localeCompare(tB);
      });
    } else if (currentSort === 'episodes') {
      result.sort((a, b) => (b.episodes || 0) - (a.episodes || 0));
    }

    return result;
  }

  function renderGrid(rawItems) {
    animeGrid.innerHTML = '';
    const items = getFilteredAndSortedItems(rawItems);
    updateHeroSpotlight(items);

    if (items.length === 0) {
      emptyState.style.display = 'flex';
      resultsCount.textContent = '0 titles matching filters';
      return;
    }
    emptyState.style.display = 'none';

    items.forEach((anime) => {
      const card = document.createElement('div');
      card.className = 'anime-card';

      const title = anime.title?.english || anime.title?.romaji || 'Untitled';
      const poster = anime.coverImage?.large || anime.coverImage?.extraLarge || '';
      const score = anime.averageScore ? `${anime.averageScore}%` : '--';
      const isReleasing = anime.status === 'RELEASING';
      const statusLabel = isReleasing ? 'Airing' : (anime.status === 'FINISHED' ? 'Finished' : anime.status);
      const episodesText = anime.episodes ? `${anime.episodes} eps` : (isReleasing ? 'Simulcasting' : '--');
      const dubStatus = anime.availability?.dub?.available ? 'Dub: HD' : 'Sub Only';

      card.innerHTML = `
        <div class="card-poster-box">
          <img class="card-poster" src="${escapeHtml(poster)}" alt="${escapeHtml(title)}" loading="lazy">
          <div class="card-badges-top">
            <span class="badge-score">⭐ ${score}</span>
            <span class="badge-status ${isReleasing ? 'releasing' : 'finished'}">${statusLabel}</span>
          </div>
          <div class="card-quick-overlay">
            <button class="btn-card-quick-play" type="button" title="Instant Play Ep 1">▶</button>
            <span class="btn-card-quick-label">Play Ep 1</span>
          </div>
        </div>
        <div class="card-info">
          <div class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="card-meta">
            <span>${episodesText}</span>
            <span>${anime.format || 'TV'}</span>
          </div>
          <div class="card-avail-pill">
            <span class="card-avail-sub">● Sub 1080p</span>
            <span class="card-avail-dub">${dubStatus}</span>
          </div>
          <button class="btn-watch-card" type="button">▶ Stream Options</button>
        </div>
      `;

      card.addEventListener('click', () => openModal(anime));

      const btnWatch = card.querySelector('.btn-watch-card');
      if (btnWatch) {
        btnWatch.addEventListener('click', (e) => {
          e.stopPropagation();
          openModal(anime);
        });
      }

      const btnQuickPlay = card.querySelector('.btn-card-quick-play');
      if (btnQuickPlay) {
        btnQuickPlay.addEventListener('click', (e) => {
          e.stopPropagation();
          openModal(anime);
          setTimeout(() => {
            const inAppBtn = modalServerButtonsInApp?.querySelector('.btn-server');
            if (inAppBtn) inAppBtn.click();
          }, 450);
        });
      }

      animeGrid.appendChild(card);
    });
  }


  // ---------------------------------------------------------------------------
  // Live-action TV series & movies (separate ids, endpoints and modal from anime;
  // nothing here touches AniList history, playback or the stream resolver)
  // ---------------------------------------------------------------------------
  const isLiveMode = () => Object.prototype.hasOwnProperty.call(LIVE_KIND, currentMode);

  function syncModeChrome() {
    const live = isLiveMode();
    if (animeGenreBar) animeGenreBar.style.display = live ? 'none' : '';
    if (liveGenreBar) liveGenreBar.style.display = live ? '' : 'none';
    if (searchInput) {
      searchInput.placeholder = !live ? SEARCH_PLACEHOLDER_ANIME
        : LIVE_KIND[currentMode] === 'tv' ? 'Search live-action TV series…' : 'Search live-action movies…';
    }
    if (live) renderLiveGenreChips();
  }

  async function ensureLiveGenres() {
    if (liveGenres) return liveGenres;
    try {
      const res = await fetch('/api/live/genres');
      const data = await res.json();
      if (data.success && data.genres) liveGenres = data.genres;
    } catch (err) {
      console.warn('live genres unavailable:', err);
    }
    return liveGenres;
  }

  async function renderLiveGenreChips() {
    if (!liveGenreBar) return;
    const kind = LIVE_KIND[currentMode];
    const genres = (await ensureLiveGenres())?.[kind] || [{ key: 'All' }];
    if (LIVE_KIND[currentMode] !== kind) return;
    liveGenreBar.textContent = '';
    genres.forEach((g) => {
      const chip = mk('button', 'genre-chip' + (g.key === currentLiveGenre ? ' active' : ''), g.key);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        currentLiveGenre = g.key;
        currentPage = 1;
        // A genre browses the chart, so it clears any live search.
        currentSearch = '';
        if (searchInput) searchInput.value = '';
        if (searchClearBtn) searchClearBtn.style.display = 'none';
        liveGenreBar.querySelectorAll('.genre-chip').forEach((c) => c.classList.toggle('active', c === chip));
        loadFeed();
      });
      liveGenreBar.appendChild(chip);
    });

    const recent = mk('button', 'genre-chip live-recent-chip' + (liveRecentOnly ? ' active' : ''), `🆕 ${LIVE_SINCE_YEAR}+ only`);
    recent.type = 'button';
    recent.title = liveRecentOnly ? `Showing titles from ${LIVE_SINCE_YEAR} on (and shows still running). Click to show everything.` : `Click to hide titles released before ${LIVE_SINCE_YEAR}.`;
    recent.setAttribute('aria-pressed', String(liveRecentOnly));
    recent.addEventListener('click', () => {
      liveRecentOnly = !liveRecentOnly;
      try { localStorage.setItem(LIVE_RECENT_KEY, liveRecentOnly ? '1' : '0'); } catch (_) {}
      currentPage = 1;
      renderLiveGenreChips();
      loadFeed();
    });
    liveGenreBar.appendChild(recent);
  }

  async function loadLiveFeed() {
    const kind = LIVE_KIND[currentMode];
    const seq = ++liveFeedSeq;
    const search = currentSearch;
    loadingState.style.display = 'flex';
    emptyState.style.display = 'none';
    animeGrid.style.display = 'none';
    historyContainer.style.display = 'none';
    downloadsContainer.style.display = 'none';
    hidePager();
    if (loadingText) loadingText.textContent = kind === 'tv' ? 'Loading live-action TV charts (iTunes + TVmaze)…' : 'Loading live-action movie charts (iTunes)…';
    const label = kind === 'tv' ? '📺 Top Live-Action TV Series' : '🎬 Top Live-Action Movies';
    sectionTitle.textContent = search
      ? `${kind === 'tv' ? 'TV series' : 'Movie'} results for "${search}"`
      : `${label}${currentLiveGenre !== 'All' ? ` · ${currentLiveGenre}` : ''}${liveRecentOnly ? ` · ${LIVE_SINCE_YEAR}+` : ''}`;
    activeAnimeList = [];

    try {
      const url = search
        ? `/api/live/search?kind=${kind}&q=${encodeURIComponent(search)}`
        : `/api/live/feed?kind=${kind}&genre=${encodeURIComponent(currentLiveGenre)}&page=${currentPage}${liveRecentOnly ? `&since=${LIVE_SINCE_YEAR}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (seq !== liveFeedSeq || LIVE_KIND[currentMode] !== kind) return; // a newer tab/search won
      loadingState.style.display = 'none';
      if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.notice) showToast(data.notice);
      const items = Array.isArray(data.media) ? data.media : [];
      if (items.length === 0) {
        emptyState.style.display = 'flex';
        resultsCount.textContent = '0 titles found';
        return;
      }
      const info = data.pageInfo || {};
      const paged = !search && (currentPage > 1 || info.hasNextPage);
      resultsCount.textContent = paged
        ? `Page ${info.currentPage || currentPage}${info.lastPage ? ` of ${info.lastPage}` : ''} · ${items.length} titles`
        : `${items.length} titles loaded`;
      renderLiveGrid(items);
      animeGrid.style.display = 'grid';
      if (!search) renderPager(info);
    } catch (err) {
      if (seq !== liveFeedSeq || LIVE_KIND[currentMode] !== kind) return;
      console.error('loadLiveFeed error:', err);
      loadingState.style.display = 'none';
      emptyState.style.display = 'flex';
      resultsCount.textContent = 'Failed to load catalog';
      showToast(`Live catalog error: ${err.message}`);
    }
  }

  function setPosterWithFallback(img, src) {
    img.addEventListener('error', () => { img.src = '/icon.png'; img.classList.add('poster-fallback'); }, { once: true });
    if (src) img.src = src;
    else { img.src = '/icon.png'; img.classList.add('poster-fallback'); }
  }

  function renderLiveGrid(items) {
    animeGrid.innerHTML = '';
    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'anime-card live-card';
      const title = item.title || 'Untitled';
      const isTv = item.kind === 'tv';
      const score = Number.isFinite(item.rating) ? `${item.rating.toFixed(1)}/10` : '--';
      const running = item.status === 'Running';
      const statusLabel = item.status || (isTv ? 'Series' : (item.year ? String(item.year) : 'Movie'));
      const metaLeft = isTv ? (item.subtitle || (item.year ? String(item.year) : 'TV Series')) : (item.year ? String(item.year) : 'Movie');
      const metaRight = isTv ? (item.network || 'TV') : (item.subtitle || 'Movie');
      const genre = (item.genres && item.genres[0]) || (isTv ? 'TV' : 'Film');

      card.innerHTML = `
        <div class="card-poster-box">
          <img class="card-poster" alt="${escapeHtml(title)}" loading="lazy">
          <div class="card-badges-top">
            <span class="badge-score">⭐ ${escapeHtml(score)}</span>
            <span class="badge-status ${running ? 'releasing' : 'finished'}">${escapeHtml(statusLabel)}</span>
          </div>
        </div>
        <div class="card-info">
          <div class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="card-meta">
            <span>${escapeHtml(metaLeft)}</span>
            <span class="live-meta-right">${escapeHtml(metaRight)}</span>
          </div>
          <div class="card-avail-pill">
            <span class="card-avail-sub">● ${isTv ? 'Live-Action Series' : 'Live-Action Movie'}</span>
            <span class="card-avail-dub">${escapeHtml(genre)}</span>
          </div>
          <button class="btn-watch-card" type="button">▶ Where to Watch</button>
        </div>
      `;
      setPosterWithFallback(card.querySelector('.card-poster'), item.poster);
      card.addEventListener('click', () => openLiveModal(item));
      const btnWatch = card.querySelector('.btn-watch-card');
      if (btnWatch) {
        btnWatch.addEventListener('click', (e) => {
          e.stopPropagation();
          openLiveModal(item);
        });
      }
      animeGrid.appendChild(card);
    });
  }

  function liveFallbackLinks(item) {
    const q = encodeURIComponent(item.title || '');
    const yq = encodeURIComponent([item.title, item.year].filter(Boolean).join(' '));
    return [
      { name: 'JustWatch', tag: 'Every Service', url: `https://www.justwatch.com/us/search?q=${q}` },
      { name: 'IMDb', tag: 'Info', url: `https://www.imdb.com/find/?q=${yq}` },
      { name: 'YouTube', tag: 'Trailer', url: `https://www.youtube.com/results?search_query=${encodeURIComponent([item.title, item.year, 'trailer'].filter(Boolean).join(' '))}` },
    ];
  }

  function setLiveBanner(url) {
    if (!liveModalBanner) return;
    liveModalBanner.style.backgroundImage = url ? `url("${String(url).replace(/["\\\n\r]/g, '')}")` : '';
  }

  async function openLiveModal(item) {
    if (!item || !liveModal) return;
    const seq = ++liveModalSeq;
    liveModal.style.display = 'flex';
    if (liveModalTitle) liveModalTitle.textContent = item.title || 'Untitled';
    if (liveModalSub) liveModalSub.textContent = [item.subtitle, item.year].filter(Boolean).join(' · ');
    setLiveBanner(item.poster);
    liveModalBody.textContent = '';
    liveModalBody.appendChild(mk('div', 'live-loading', 'Loading details…'));
    try {
      const res = await fetch(`/api/live/details?id=${encodeURIComponent(item.liveId)}`);
      const data = await res.json();
      if (seq !== liveModalSeq || liveModal.style.display !== 'flex') return;
      if (!data.success || !data.item) throw new Error(data.error || `HTTP ${res.status}`);
      const d = data.item;
      renderLiveDetails({
        ...item,
        ...d,
        poster: d.poster || item.poster,
        summary: d.summary || item.summary,
        trailer: d.trailer || item.trailer || '',
        genres: d.genres && d.genres.length ? d.genres : (item.genres || []),
      });
    } catch (err) {
      if (seq !== liveModalSeq || liveModal.style.display !== 'flex') return;
      console.error('openLiveModal error:', err);
      // Still useful: show what the card had plus search links.
      renderLiveDetails({ ...item, links: liveFallbackLinks(item), error: err.message });
    }
  }

  function renderLiveDetails(d) {
    const isTv = d.kind === 'tv';
    if (liveModalTitle) liveModalTitle.textContent = d.title || 'Untitled';
    if (liveModalSub) liveModalSub.textContent = [d.subtitle, d.year].filter(Boolean).join(' · ');
    setLiveBanner(d.poster);
    liveModalBody.textContent = '';

    // Sidebar: poster + quick stats
    const sidebar = mk('div', 'modal-sidebar');
    const cover = mk('img', 'modal-cover-img');
    cover.alt = d.title || 'Poster';
    setPosterWithFallback(cover, d.poster);
    sidebar.appendChild(cover);
    const stats = mk('div', 'modal-quick-stats');
    const addStat = (label, val) => {
      if (val == null || val === '') return;
      const pill = mk('div', 'stat-pill');
      pill.appendChild(mk('span', 'label', label));
      pill.appendChild(mk('span', 'val', String(val)));
      stats.appendChild(pill);
    };
    addStat('Rating', Number.isFinite(d.rating) ? `${d.rating.toFixed(1)}/10` : '');
    addStat(isTv ? 'Premiered' : 'Year', isTv ? (d.premiered || d.year) : d.year);
    if (isTv) addStat('Status', d.ended ? `${d.status || 'Ended'} (${String(d.ended).slice(0, 4)})` : d.status);
    addStat(isTv ? 'Network' : 'Director', isTv ? d.network : (d.directors && d.directors.join(', ')));
    addStat('Runtime', d.runtime ? `${d.runtime} min` : '');
    if (isTv && Array.isArray(d.seasons) && d.seasons.length) addStat('Seasons', d.seasons.length);
    addStat('Rated', d.contentRating);
    sidebar.appendChild(stats);
    liveModalBody.appendChild(sidebar);

    const main = mk('div', 'modal-content-area');

    if (d.error) main.appendChild(mk('div', 'live-error', `Full details unavailable (${d.error}). Showing the basics.`));

    // Trailer (iTunes previews are plain video files, so they play in-app)
    if (d.trailer) {
      const box = mk('div', 'live-section');
      box.appendChild(mk('h3', null, '🎞️ Trailer'));
      const video = document.createElement('video');
      video.className = 'live-trailer';
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.src = d.trailer;
      if (d.poster) video.poster = d.poster;
      video.addEventListener('error', () => { box.remove(); }, { once: true });
      box.appendChild(video);
      main.appendChild(box);
    }

    // Where to watch (legal links only)
    const watch = mk('div', 'live-section');
    watch.appendChild(mk('h3', null, '📺 Where to Watch'));
    const grid = mk('div', 'server-buttons-grid');
    (Array.isArray(d.links) && d.links.length ? d.links : liveFallbackLinks(d)).forEach((link) => {
      const btn = mk('button', 'btn-server-stream external');
      btn.type = 'button';
      const label = mk('span');
      label.appendChild(mk('span', 'server-dot external'));
      label.appendChild(document.createTextNode(`🌐 ${link.name}`));
      btn.appendChild(label);
      btn.appendChild(mk('span', 'badge', link.tag || ''));
      btn.addEventListener('click', () => {
        window.open(link.url, '_blank');
        showToast(`Opened ${link.name} in new tab`);
      });
      grid.appendChild(btn);
    });
    watch.appendChild(grid);
    watch.appendChild(mk('p', 'live-note', 'Legal sources only. Free services (Tubi, The Roku Channel, Plex) open a search for this title; JustWatch lists every service that carries it.'));
    main.appendChild(watch);

    // Synopsis
    const syn = mk('div', 'synopsis-box');
    syn.appendChild(mk('h3', null, 'Synopsis'));
    syn.appendChild(mk('p', 'synopsis-text', d.summary || 'No synopsis available.'));
    main.appendChild(syn);

    // Seasons (TV)
    if (isTv && Array.isArray(d.seasons) && d.seasons.length) {
      const box = mk('div', 'live-section');
      box.appendChild(mk('h3', null, `🗂️ Seasons (${d.seasons.length})`));
      const list = mk('div', 'live-seasons');
      d.seasons.forEach((s) => {
        const yr = s.premiere ? String(s.premiere).slice(0, 4) : '';
        const parts = [`S${s.number}`, s.episodes ? `${s.episodes} eps` : '', yr].filter(Boolean);
        const chip = mk('span', 'live-season-chip', parts.join(' · '));
        if (s.name) chip.title = s.name;
        list.appendChild(chip);
      });
      box.appendChild(list);
      main.appendChild(box);
    }

    // Cast
    if (Array.isArray(d.cast) && d.cast.length) {
      const box = mk('div', 'live-section');
      box.appendChild(mk('h3', null, '🎭 Cast'));
      const list = mk('div', 'live-cast-grid');
      d.cast.forEach((c) => {
        const row = mk('div', 'live-cast');
        if (c.image) {
          const img = mk('img', 'live-cast-img');
          img.alt = c.name;
          img.loading = 'lazy';
          img.addEventListener('error', () => img.remove(), { once: true });
          img.src = c.image;
          row.appendChild(img);
        }
        const txt = mk('div', 'live-cast-text');
        txt.appendChild(mk('span', 'live-cast-name', c.name));
        if (c.character) txt.appendChild(mk('span', 'live-cast-role', c.character));
        row.appendChild(txt);
        list.appendChild(row);
      });
      box.appendChild(list);
      main.appendChild(box);
    }

    // Genres + data source
    if (Array.isArray(d.genres) && d.genres.length) {
      const tags = mk('div', 'genres-list');
      d.genres.forEach((g) => tags.appendChild(mk('span', 'genre-tag', g)));
      main.appendChild(tags);
    }
    if (d.source) main.appendChild(mk('p', 'live-note', `Data: ${d.source}`));

    liveModalBody.appendChild(main);
  }

  function closeLiveModal() {
    if (!liveModal) return;
    liveModalSeq++; // drop any in-flight details response
    liveModal.querySelectorAll('video').forEach((v) => {
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {}
    });
    liveModal.style.display = 'none';
    if (liveModalBody) liveModalBody.textContent = '';
  }

  // ---------------------------------------------------------------------------
  // History View Rendering
  // ---------------------------------------------------------------------------

  function renderHistoryView() {
    sectionTitle.textContent = '📜 Watch History & Progress Tracker';
    resultsCount.textContent = `${historyList.length} titles tracked`;
    animeGrid.style.display = 'none';
    emptyState.style.display = 'none';
    loadingState.style.display = 'none';
    downloadsContainer.style.display = 'none';
    historyContainer.style.display = 'flex';

    historyListEl.innerHTML = '';
    if (historyList.length === 0) {
      historyListEl.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-secondary);">
          No watch history yet. Click any anime and launch a stream to begin tracking.
        </div>
      `;
      return;
    }

    historyList.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'history-card';
      const epCount = item.totalEpisodes ? ` / ${item.totalEpisodes}` : '';
      const watchedDate = item.lastWatchedAt ? new Date(item.lastWatchedAt).toLocaleDateString() : '';

      card.innerHTML = `
        <img class="history-thumb" src="${escapeHtml(item.coverImage)}" alt="Cover">
        <div class="history-details">
          <div class="history-title">${escapeHtml(item.title)}</div>
          <div class="history-ep-tag">Episode ${item.lastEpisodeWatched}${epCount} • ${escapeHtml(item.status)}</div>
          <div class="history-time">Last viewed: ${watchedDate}</div>
          <div class="history-actions">
            <button class="btn-resume" type="button">▶ Resume In-App</button>
            <button class="btn-delete-item" type="button" title="Remove from history">✕</button>
          </div>
        </div>
      `;

      const btnResume = card.querySelector('.btn-resume');
      btnResume.addEventListener('click', async () => {
        showToast(`Loading in-app theater for ${item.title}...`);
        const animeObj = {
          id: item.id,
          title: { english: item.title, romaji: item.title },
          coverImage: { extraLarge: item.coverImage, large: item.coverImage },
          episodes: item.totalEpisodes,
        };
        await openModal(animeObj);
        const epNum = item.lastEpisodeWatched || 1;
        selectEpisode(epNum);

        const inAppServers = [
          { name: 'VidSrc PM (In-App HD Player)', url: `https://vidsrc.pm/embed/anime/${item.id}/${epNum}` },
          { name: 'VidSrc SU (In-App Ultra)', url: `https://vidsrc.su/embed/anime/${item.id}/${epNum}` },
          { name: 'Videasy (In-App Fast)', url: `https://player.videasy.to/anime/${item.id}/${epNum}` },
          { name: 'VidSrc SH (In-App Mirror)', url: `https://vidsrc.sh/embed/anime?anilist=${item.id}&episode=${epNum}` },
          { name: '2Embed CC (Multi-Server)', url: `https://www.2embed.cc/embed/anime/${item.id}/${epNum}` },
        ];
        launchWithAutoFailover(animeObj, epNum, inAppServers, 0);
      });

      const btnDelete = card.querySelector('.btn-delete-item');
      btnDelete.addEventListener('click', async () => {
        await fetch(`/api/history?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        loadHistory();
        showToast('Removed from history');
      });

      historyListEl.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // Episode Selector & Open-Choice Mirror Generation
  // ---------------------------------------------------------------------------

  function selectEpisode(epNum, shouldSave = false) {
    if (!currentModalAnime) return;
    decorateEpisodes(currentModalAnime.id);
    const total = currentModalAnime.episodes || 999;
    const targetEp = Math.max(1, Math.min(total, parseInt(epNum, 10) || 1));
    currentSelectedEp = targetEp;

    if (activeEpDisplay) activeEpDisplay.textContent = `Episode ${targetEp}`;
    if (modalEpInput) modalEpInput.value = targetEp;

    const isFirst = targetEp <= 1;
    const isLast = currentModalAnime.episodes ? targetEp >= currentModalAnime.episodes : false;

    if (btnPrevEp) btnPrevEp.disabled = isFirst;
    if (btnNextEp) btnNextEp.disabled = isLast;
    if (btnPlayerPrevEp) btnPlayerPrevEp.disabled = isFirst;
    if (btnPlayerNextEp) btnPlayerNextEp.disabled = isLast;

    // Highlight active episode button
    if (epButtonsGrid) {
      const allBtns = epButtonsGrid.querySelectorAll('.btn-ep-choice');
      allBtns.forEach((b) => {
        b.classList.toggle('active', parseInt(b.getAttribute('data-ep'), 10) === targetEp);
      });
      const activeBtn = epButtonsGrid.querySelector(`.btn-ep-choice[data-ep="${targetEp}"]`);
      if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
        activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    // Refresh Download & Offline Ultra-Buffer Section for Selected Episode
    updateDownloadSection(currentModalAnime.id, targetEp);

    // Regenerate server launch URLs for the selected episode
    renderServerButtons(currentModalAnime, targetEp);

    // If explicit episode selection or step, persist to history immediately
    if (shouldSave) {
      recordWatchHistory(currentModalAnime, targetEp, modalStatusSelect ? modalStatusSelect.value : 'Watching');
    }

    // If in-app theater player is actively open, switch to the new episode automatically
    if (playerTheaterBox && playerTheaterBox.style.display !== 'none') {
      const title = currentModalAnime.title?.english || currentModalAnime.title?.romaji || 'Anime';
      if (nativePlayer && nativePlayer.style.display !== 'none') {
        playLocalVideo(currentModalAnime, targetEp);
        showToast(`Playing local 0-lag Episode ${targetEp}`);
      } else if (activeInAppServers.length > 0) {
        const primary = activeInAppServers[0];
        const nextUrl = primary.url;
        activeStreamUrl = nextUrl;
        playerFrame.src = nextUrl;
        if (playerStreamTitle) {
          playerStreamTitle.textContent = `${title} — Episode ${targetEp} (${primary.name})`;
        }
        recordWatchHistory(currentModalAnime, targetEp, modalStatusSelect ? modalStatusSelect.value : 'Watching', nextUrl);
        showToast(`Switched theater to Episode ${targetEp}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Resume where you left off (positions are stored server-side per anime + episode)
  // ---------------------------------------------------------------------------
  let playbackCtx = null;      // { animeId, episode } of what is currently playing; null while switching
  let playbackToken = 0;       // invalidates stale async work when the episode changes
  let playbackLastSent = 0;
  let playbackTrackingReady = false;

  const fmtPlaybackTime = (secs) => {
    const s = Math.max(0, Math.floor(secs));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };

  function sendPlaybackPosition(useBeacon) {
    if (!playbackCtx || !nativePlayer) return;
    const t = nativePlayer.currentTime;
    const d = nativePlayer.duration;
    if (!Number.isFinite(t) || t < 1) return;
    const body = JSON.stringify({
      animeId: playbackCtx.animeId,
      episode: playbackCtx.episode,
      position: t,
      duration: Number.isFinite(d) ? d : 0,
    });
    playbackLastSent = Date.now();
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/playback', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/playback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  }

  function setupPlaybackTracking() {
    if (playbackTrackingReady || !nativePlayer) return;
    playbackTrackingReady = true;
    nativePlayer.addEventListener('volumechange', () => {
      try {
        localStorage.setItem('ap_player_muted', nativePlayer.muted ? 'true' : 'false');
        localStorage.setItem('ap_player_volume', String(nativePlayer.volume));
      } catch (_) {}
    });
    nativePlayer.addEventListener('timeupdate', () => {
      if (!nativePlayer.paused && Date.now() - playbackLastSent > 5000) sendPlaybackPosition(false);
    });
    nativePlayer.addEventListener('pause', () => sendPlaybackPosition(false));
    nativePlayer.addEventListener('ended', () => sendPlaybackPosition(false)); // server clears it near the end
    window.addEventListener('pagehide', () => sendPlaybackPosition(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sendPlaybackPosition(true);
    });
  }

  function playLocalVideo(anime, epNum) {
    if (!anime || !playerTheaterBox || !nativePlayer) return;
    const title = anime.title?.english || anime.title?.romaji || 'Anime';

    if (playerFrame) {
      playerFrame.src = 'about:blank';
      playerFrame.style.display = 'none';
    }

    if (completionOverlay) completionOverlay.style.display = 'none';
    nativePlayer.style.display = 'block';
    playerTheaterBox.style.display = 'block';
    try { playerTheaterBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}

    // Save the episode we are leaving, then stop tracking until the new one has been resumed.
    sendPlaybackPosition(false);
    playbackCtx = null;
    setupPlaybackTracking();

    while (nativePlayer.firstChild) {
      nativePlayer.removeChild(nativePlayer.firstChild);
    }

    const streamUrl = `/api/download/stream?animeId=${encodeURIComponent(anime.id)}&episode=${encodeURIComponent(epNum)}`;
    const subUrl = `/api/download/subtitle?animeId=${encodeURIComponent(anime.id)}&episode=${encodeURIComponent(epNum)}`;

    // Default to unmuted with full volume unless user explicitly muted
    const prefMuted = localStorage.getItem('ap_player_muted');
    nativePlayer.muted = prefMuted === 'true';
    nativePlayer.defaultMuted = false;
    const prefVol = localStorage.getItem('ap_player_volume');
    if (prefVol !== null) {
      const v = parseFloat(prefVol);
      if (!isNaN(v) && v >= 0 && v <= 1) nativePlayer.volume = v;
    } else {
      nativePlayer.volume = 1.0;
    }

    nativePlayer.src = streamUrl;
    try {
      nativePlayer.load();
      nativePlayer.play().catch((err) => { console.warn('[nativePlayer] Autoplay prevented:', err); });
    } catch (_) {}
    nativePlayer.addEventListener('error', () => {
      const err = nativePlayer.error;
      console.error('[nativePlayer] Video error:', err);
      showToast(`⚠️ Video failed to load (${err?.message || err?.code || 'format error'})`);
    }, { once: true });

    // Resume: fetch the saved position and seek once the metadata is ready (whichever arrives last).
    const myToken = ++playbackToken;
    let resumeAt = null;
    let metaReady = nativePlayer.readyState >= 1;
    let resumeDone = false;
    const tryResume = () => {
      if (myToken !== playbackToken || resumeDone || resumeAt === null || !metaReady) return;
      resumeDone = true;
      const d = nativePlayer.duration;
      if (resumeAt > 5 && (!Number.isFinite(d) || resumeAt < d - 15)) {
        nativePlayer.currentTime = resumeAt;
        showToast(`⏩ Resumed Episode ${epNum} at ${fmtPlaybackTime(resumeAt)}`);
      }
      playbackCtx = { animeId: anime.id, episode: epNum }; // start saving only after the resume decision
      try { nativePlayer.play().catch(() => {}); } catch (_) {}
    };
    nativePlayer.addEventListener('loadedmetadata', () => { metaReady = true; tryResume(); }, { once: true });
    fetch(`/api/playback?animeId=${encodeURIComponent(anime.id)}&episode=${encodeURIComponent(epNum)}`)
      .then((r) => r.json())
      .then((p) => { resumeAt = p && p.success ? Number(p.position) || 0 : 0; tryResume(); })
      .catch(() => { resumeAt = 0; tryResume(); });

    // Subtitles: one active track, dub-aware default, CC toggle + timing nudge (see subs.js).
    const updateSubControls = (st) => {
      const modeBtn = document.getElementById('sub-mode-btn');
      const lbl = document.getElementById('sub-offset-lbl');
      if (modeBtn) {
        modeBtn.textContent = st.mode === 'on' ? 'CC: On' : st.mode === 'off' ? 'CC: Off' : `CC: Auto (${st.showing ? 'on' : 'off'})`;
        modeBtn.title = st.mode === 'auto'
          ? 'Auto: hidden for an English dub whose captions are the full sub script (wording and timing do not match the dub). Click to force On / Off.'
          : 'Click to cycle Auto / On / Off';
      }
      if (lbl) lbl.textContent = `${st.offset > 0 ? '+' : ''}${st.offset.toFixed(1)}s`;
    };
    let subCtl = null;
    if (window.APSubs) {
      subCtl = window.APSubs.attach(nativePlayer, subUrl, `ap_subpref_${anime.id}_${epNum}`, updateSubControls);
    } else {
      // subs.js failed to load: fall back to a single plain track
      const fallbackTrack = document.createElement('track');
      fallbackTrack.kind = 'subtitles';
      fallbackTrack.src = subUrl;
      fallbackTrack.srclang = 'en';
      fallbackTrack.label = 'English';
      fallbackTrack.default = true;
      nativePlayer.appendChild(fallbackTrack);
    }

    if (playerStreamTitle) {
      playerStreamTitle.textContent = `${title} — Episode ${epNum} (⚡ 0-Lag Ultra-Buffered Local HD)`;
    }

    if (playerServerChips) {
      playerServerChips.innerHTML = `
        <button class="chip-server active" type="button">⚡ Local 1080p Ultra-Buffer (0ms Scrub)</button>
        <button id="chip-audio-badge" class="chip-server" type="button" style="border-color: rgba(16, 185, 129, 0.4); color: #10b981;">🔊 Dub Priority Verified</button>
        <span style="display:inline-flex;gap:6px;align-items:center;margin-left:10px">
          <button id="sub-mode-btn" class="chip-server" type="button">CC</button>
          <button id="sub-back-btn" class="chip-server" type="button" title="Subtitles appear 0.5s EARLIER">◀ 0.5s</button>
          <span id="sub-offset-lbl" style="font-size:12px;opacity:.8;min-width:42px;text-align:center">0.0s</span>
          <button id="sub-fwd-btn" class="chip-server" type="button" title="Subtitles appear 0.5s LATER">0.5s ▶</button>
          <button id="sub-reset-btn" class="chip-server" type="button" title="Reset subtitle timing">reset</button>
        </span>
      `;
      if (subCtl) {
        const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
        bind('sub-mode-btn', () => subCtl.cycleMode());
        bind('sub-back-btn', () => subCtl.nudge(-subCtl.step));
        bind('sub-fwd-btn', () => subCtl.nudge(subCtl.step));
        bind('sub-reset-btn', () => subCtl.resetOffset());
        updateSubControls(subCtl.state());
      }
    }

    // Probe status to display exact multi-pass verification tag in header
    fetch(`/api/download/status?animeId=${encodeURIComponent(anime.id)}&episode=${encodeURIComponent(epNum)}`)
      .then((r) => r.json())
      .then((st) => {
        if (st && st.success && subCtl) subCtl.setDub(!!st.isDub);
        if (st.success) {
          const badgeText = st.audioLabel || (st.isDub ? 'English Dub (Verified ✓)' : 'Subbed (Dub Unavailable)');
          if (playerStreamTitle) {
            playerStreamTitle.textContent = `${title} — Episode ${epNum} (⚡ 0-Lag • ${badgeText})`;
          }
          const audioChip = document.getElementById('chip-audio-badge');
          if (audioChip) {
            audioChip.textContent = st.isDub ? '🔊 English Dub (Verified ✓)' : '📝 Subbed (Dub Unavailable)';
            audioChip.style.color = st.isDub ? '#10b981' : '#38bdf8';
          }
        }
      })
      .catch(() => {});

    // Proactively prebuffer the subsequent episode in background to guarantee continuous 0-lag binge watching
    const totalEps = anime.episodes || 24;
    const nextEp = parseInt(epNum, 10) + 1;
    if (nextEp <= totalEps) {
      fetch(`/api/download/status?animeId=${encodeURIComponent(anime.id)}&episode=${encodeURIComponent(nextEp)}`)
        .then((r) => r.json())
        .then((st) => {
          if (!st.isLocalReady && st.status !== 'downloading') {
            fetch('/api/download/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                animeId: anime.id,
                episode: nextEp,
                title,
                altTitle: anime.title?.romaji || anime.title?.english || '',
                totalEpisodes: totalEps,
              }),
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }

    activePlayingDownloadKey = { anime, episode: epNum };
    recordWatchHistory(anime, epNum, modalStatusSelect ? modalStatusSelect.value : 'Watching', streamUrl);
    fetch('/api/stats/stream', { method: 'POST' }).catch(() => {});

    playerTheaterBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    nativePlayer.play().catch((err) => {
      console.warn('Native playback auto-start error:', err);
    });
    showToast(`▶ Playing Episode ${epNum} from local ultra-buffered cache`);
  }

  function playInApp(url, serverName, anime, epNum, availableServers = []) {
    if (!playerTheaterBox || !playerFrame) {
      window.open(url, '_blank');
      return;
    }

    if (nativePlayer) {
      nativePlayer.pause();
      nativePlayer.removeAttribute('src');
      nativePlayer.load();
      nativePlayer.style.display = 'none';
    }
    if (completionOverlay) completionOverlay.style.display = 'none';
    if (playerFrame) playerFrame.style.display = 'block';

    activeStreamUrl = url;
    playerFrame.src = url;
    playerTheaterBox.style.display = 'block';

    const title = anime.title?.english || anime.title?.romaji || 'Anime';
    if (playerStreamTitle) {
      playerStreamTitle.textContent = `${title} — Episode ${epNum} (${serverName})`;
    }

    // Populate server chips for rapid in-player mirror switching (embeddable only)
    if (playerServerChips && availableServers.length > 0) {
      playerServerChips.innerHTML = '';
      availableServers.forEach((srv) => {
        const chip = document.createElement('button');
        chip.className = `chip-server ${srv.url === url ? 'active' : ''}`;
        chip.type = 'button';
        chip.textContent = srv.name.replace(/\(.*\)/, '').trim();
        chip.title = `Switch player to ${srv.name}`;
        chip.addEventListener('click', () => {
          playerServerChips.querySelectorAll('.chip-server').forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
          playerFrame.src = srv.url;
          activeStreamUrl = srv.url;
          if (playerStreamTitle) {
            playerStreamTitle.textContent = `${title} — Episode ${epNum} (${srv.name})`;
          }
          recordWatchHistory(anime, epNum, modalStatusSelect ? modalStatusSelect.value : 'Watching', srv.url);
          fetch('/api/stats/stream', { method: 'POST' }).catch(() => {});
          showToast(`Switched player mirror to: ${srv.name}`);
        });
        playerServerChips.appendChild(chip);
      });
    }

    recordWatchHistory(anime, epNum, modalStatusSelect ? modalStatusSelect.value : 'Watching', url);
    fetch('/api/stats/stream', { method: 'POST' }).catch(() => {});
    playerTheaterBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`▶ Streaming Ep ${epNum} in-app via ${serverName}`);
  }

  async function launchWithAutoFailover(anime, epNum, serverList, startIdx = 0, smartBtn = null) {
    if (!serverList || serverList.length === 0) {
      showToast('No in-app streaming sources available.');
      return;
    }

    if (smartBtn) {
      smartBtn.classList.add('testing');
      const labelSpan = smartBtn.querySelector('span');
      if (labelSpan) labelSpan.textContent = '⚡ Validating in-app mirrors...';
    }

    let opened = false;
    for (let i = startIdx; i < serverList.length; i++) {
      const srv = serverList[i];
      showToast(`Validating (${i + 1}/${serverList.length}) ${srv.name}...`);

      try {
        const valRes = await fetch(`/api/validate-stream?url=${encodeURIComponent(srv.url)}`);
        const valData = await valRes.json();

        if (valData.success && valData.valid) {
          const finalUrl = valData.finalUrl || srv.url;
          playInApp(finalUrl, srv.name, anime, epNum, serverList);
          opened = true;
          break;
        } else {
          showToast(`⚠ ${srv.name} down (${valData.reason || 'unreachable'}). Trying next mirror...`);
        }
      } catch (err) {
        console.warn(`[Auto-Failover] Verification failed for ${srv.name}:`, err);
      }
    }

    if (!opened) {
      // Fallback to top choice if pre-flight queries timed out
      const fallback = serverList[0];
      playInApp(fallback.url, fallback.name, anime, epNum, serverList);
      showToast(`Started in-app stream via ${fallback.name}`);
    }

    if (smartBtn) {
      smartBtn.classList.remove('testing');
      const labelSpan = smartBtn.querySelector('span');
      if (labelSpan) labelSpan.textContent = '⚡ Auto-Launch In-App Stream';
    }
  }

  function renderServerButtons(anime, epNum) {
    if (!anime) return;
    const title = anime.title?.english || anime.title?.romaji || 'Anime';
    const cleanTitle = title.replace(/[^\w\s-]/g, '').trim();
    const epSuffix = epNum && epNum > 1 ? ` episode ${epNum}` : '';
    const encodedTitle = encodeURIComponent(`${cleanTitle}${epSuffix}`);

    const officialStream = (anime.externalLinks || []).find(
      (l) => l.type === 'STREAMING' || ['Crunchyroll', 'Netflix', 'Hulu', 'HIDIVE'].includes(l.site)
    );

    // In-App Embeddable HD Theater Mirrors
    const inAppServers = [
      {
        name: `VidSrc Me (Ep ${epNum} HD)`,
        tag: 'Fast Direct',
        url: `https://vidsrc.me/embed/anime?anilist=${anime.id}&episode=${epNum}`,
        embeddable: true,
        primary: true,
      },
      {
        name: `VidSrc PM (Ep ${epNum} Player)`,
        tag: 'In-App Theater',
        url: `https://vidsrc.pm/embed/anime/${anime.id}/${epNum}`,
        embeddable: true,
        primary: false,
      },
      {
        name: `MultiEmbed (Ep ${epNum} Multi-Source)`,
        tag: 'Global Stream',
        url: `https://multiembed.mov/?video_id=${anime.id}&anilist=1&s=1&e=${epNum}`,
        embeddable: true,
        primary: false,
      },
      {
        name: `VidSrc SU (Ep ${epNum} Ultra)`,
        tag: 'Fast In-App',
        url: `https://vidsrc.su/embed/anime/${anime.id}/${epNum}`,
        embeddable: true,
        primary: false,
      },
      {
        name: `2Embed CC (Ep ${epNum} Backup)`,
        tag: 'Backup In-App',
        url: `https://www.2embed.cc/embed/anime/${anime.id}/${epNum}`,
        embeddable: true,
        primary: false,
      },
    ];

    activeInAppServers = inAppServers;

    // External Fast Browser Mirrors (Full Sites)
    const externalServers = [
      {
        name: `Miruro (Ep ${epNum} Direct HD)`,
        tag: 'Direct Player',
        url: `https://www.miruro.tv/watch?id=${anime.id}&ep=${epNum}`,
        embeddable: false,
      },
      {
        name: 'GogoAnime (Sub & Dub Search)',
        tag: 'Full Catalog',
        url: `https://gogoanime3.co/search.html?keyword=${encodedTitle}`,
        embeddable: false,
      },
      {
        name: 'YugenAnime (Fast 1080p Mirror)',
        tag: 'HD Mirror',
        url: `https://yugenanime.tv/discover/?q=${encodedTitle}`,
        embeddable: false,
      },
      {
        name: 'AnimePahe (Direct Ep Mirror)',
        tag: 'Fast Stream',
        url: `https://animepahe.ru`,
        embeddable: false,
      },
      ...(officialStream ? [{
        name: `${officialStream.site} (Official Paid)`,
        tag: 'Paid / Trial',
        url: officialStream.url,
        embeddable: false,
      }] : []),
    ];

    // Populate In-App Section
    if (modalServerButtonsInApp) {
      modalServerButtonsInApp.innerHTML = '';

      // Smart Auto-Failover Master Button
      const smartBtn = document.createElement('button');
      smartBtn.className = 'btn-smart-failover';
      smartBtn.type = 'button';
      smartBtn.innerHTML = `
        <span>⚡ Auto-Launch In-App Stream</span>
        <span class="badge">In-App Player</span>
      `;
      smartBtn.addEventListener('click', () => {
        launchWithAutoFailover(anime, epNum, inAppServers, 0, smartBtn);
      });
      modalServerButtonsInApp.appendChild(smartBtn);

      // Check if episode is cached locally for instant zero-lag playback
      fetch(`/api/download/status?animeId=${encodeURIComponent(anime.id)}&episode=${encodeURIComponent(epNum)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.success && data.status === 'ready') {
            const localBtn = document.createElement('button');
            localBtn.className = 'btn-server-stream';
            localBtn.style.borderColor = 'var(--accent-emerald)';
            localBtn.style.background = 'rgba(16, 185, 129, 0.15)';
            localBtn.type = 'button';
            localBtn.innerHTML = `
              <span><span class="server-dot live" style="background: var(--accent-emerald); box-shadow: 0 0 8px var(--accent-emerald);"></span>⚡ Play Ultra-Buffered Local HD (0ms Scrub)</span>
              <span class="badge" style="background: var(--accent-emerald); color: #000;">Zero Lag</span>
            `;
            localBtn.addEventListener('click', () => {
              playLocalVideo(anime, epNum);
            });
            if (modalServerButtonsInApp && modalServerButtonsInApp.firstChild) {
              modalServerButtonsInApp.insertBefore(localBtn, modalServerButtonsInApp.firstChild);
            }
          }
        })
        .catch(() => {});

      // Individual In-App Mirror Buttons
      inAppServers.forEach((srv, idx) => {
        const btn = document.createElement('button');
        btn.className = `btn-server-stream ${srv.primary ? '' : 'secondary'}`;
        btn.type = 'button';
        btn.innerHTML = `
          <span><span class="server-dot live"></span>▶ ${escapeHtml(srv.name)}</span>
          <span class="badge">${escapeHtml(srv.tag)}</span>
        `;

        btn.addEventListener('click', async () => {
          showToast(`Verifying ${srv.name}...`);
          try {
            const res = await fetch(`/api/validate-stream?url=${encodeURIComponent(srv.url)}`);
            const data = await res.json();

            if (data.success && data.valid) {
              const finalUrl = data.finalUrl || srv.url;
              playInApp(finalUrl, srv.name, anime, epNum, inAppServers);
            } else {
              showToast(`⚠ ${srv.name} is down (${data.reason || 'Error'}). Auto-switching to next mirror...`);
              launchWithAutoFailover(anime, epNum, inAppServers, idx + 1, smartBtn);
            }
          } catch (err) {
            console.warn('Pre-check failed, failing over to next link:', err);
            launchWithAutoFailover(anime, epNum, inAppServers, idx + 1, smartBtn);
          }
        });

        modalServerButtonsInApp.appendChild(btn);
      });
    }

    // Populate External Mirror Section
    if (modalServerButtonsExternal) {
      modalServerButtonsExternal.innerHTML = '';

      externalServers.forEach((srv) => {
        const btn = document.createElement('button');
        btn.className = 'btn-server-stream external';
        btn.type = 'button';
        btn.innerHTML = `
          <span><span class="server-dot external"></span>🌐 ${escapeHtml(srv.name)}</span>
          <span class="badge">${escapeHtml(srv.tag)}</span>
        `;

        btn.addEventListener('click', () => {
          window.open(srv.url, '_blank');
          recordWatchHistory(anime, epNum, modalStatusSelect ? modalStatusSelect.value : 'Watching', srv.url);
          fetch('/api/stats/stream', { method: 'POST' }).catch(() => {});
          showToast(`Opened ${srv.name} in new tab`);
        });

        modalServerButtonsExternal.appendChild(btn);
      });
    }
  }

  function renderEpisodeGrid(anime, currentEp) {
    if (!epButtonsGrid) return;
    epButtonsGrid.innerHTML = '';

    const maxCount = anime.episodes || (anime.nextAiringEpisode ? anime.nextAiringEpisode.episode - 1 : 24);
    const count = Math.max(1, maxCount);

    for (let i = 1; i <= count; i++) {
      const btn = document.createElement('button');
      btn.className = `btn-ep-choice ${i === currentEp ? 'active' : ''}`;
      btn.type = 'button';
      btn.setAttribute('data-ep', i);
      btn.textContent = i;
      btn.addEventListener('click', () => selectEpisode(i, true));
      btn.addEventListener('contextmenu', async (ev) => {             // right-click: mark completed / unwatched by hand
        ev.preventDefault();
        const wasDone = btn.classList.contains('ep-done');
        try {
          const r = await fetch('/api/watch-mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ animeId: anime.id, episode: i, state: wasDone ? 'clear' : 'completed' }) });
          const j = await r.json();
          if (j && j.success) { showToast(wasDone ? `Episode ${i} marked unwatched` : `Episode ${i} marked watched`); decorateEpisodes(anime.id); }
        } catch (_) { showToast('Could not save that mark'); }
      });
      epButtonsGrid.appendChild(btn);
    }
    if (!document.getElementById('ep-legend')) {
      const lg = document.createElement('div'); lg.id = 'ep-legend'; lg.className = 'ep-legend';
      lg.textContent = '✓ watched · plain number = not watched · 45% = partly watched · ● current / next up · right-click an episode to mark it watched or unwatched';
      epButtonsGrid.insertAdjacentElement('afterend', lg);
    }
    decorateEpisodes(anime.id);
  }

  // Episode button labels: green check (top-right) = watched, plain number = unwatched, dot (top-right) = current / next up, amber % = partly watched
  function setEpStatus(btn, st, isCurrent) {
    btn.classList.remove('ep-done', 'ep-partial', 'ep-opened', 'ep-current');
    btn.querySelectorAll('.ep-check, .ep-dot, .ep-pct').forEach((n) => n.remove());
    btn.removeAttribute('title');
    let tip = '';
    if (st && st.state === 'completed') {
      btn.classList.add('ep-done'); btn.appendChild(mk('span', 'ep-check', '✓'));
      tip = st.inferred ? 'Assumed watched (you opened a later episode). Right-click to mark unwatched.' : 'Watched. Right-click to mark unwatched.';
    } else if (st && st.state === 'partial') {
      const pct = Math.round((st.pct || 0) * 100);
      btn.classList.add('ep-partial'); btn.appendChild(mk('span', 'ep-pct', `${pct}%`));
      tip = `Watched partially: ${pct}%. Right-click to mark watched.`;
    }
    if (isCurrent) { btn.classList.add('ep-current'); btn.appendChild(mk('span', 'ep-dot', '●')); tip = (tip ? tip + ' ' : '') + 'Current / next up.'; }
    if (!st && !isCurrent) tip = 'Right-click to mark watched.';
    if (tip) btn.title = tip;
  }
  async function decorateEpisodes(animeId) {
    try {
      const r = await fetch(`/api/watch-status?animeId=${encodeURIComponent(animeId)}`); const j = await r.json();
      if (!j || !j.success || !epButtonsGrid) return;
      epButtonsGrid.querySelectorAll('.btn-ep-choice').forEach((b) => {
        const ep = parseInt(b.getAttribute('data-ep'), 10);
        setEpStatus(b, j.statuses[ep], j.current === ep);
      });
    } catch (_) {}
  }

  // Full series in watch order: original first, current entry highlighted, one click to any entry.
  function renderFranchise(franchise) {
    const section = document.getElementById('franchise-section');
    const list = document.getElementById('franchise-list');
    const count = document.getElementById('franchise-count');
    const origBtn = document.getElementById('franchise-original-btn');
    if (!section || !list) return;
    if (!franchise || !Array.isArray(franchise.items) || franchise.items.length < 2) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'flex';
    if (count) count.textContent = franchise.items.length;
    list.innerHTML = '';

    const openEntry = (entry) => openModal({ id: entry.id, title: { english: entry.title, romaji: entry.title } });

    franchise.items.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'counterpart-item franchise-item' + (entry.current ? ' current' : '');
      const year = entry.seasonYear ? `(${entry.seasonYear})` : '';
      const eps = entry.episodes ? `• ${entry.episodes} eps` : '';
      const tags = [`#${entry.position}`];
      if (entry.id === franchise.rootId) tags.push('ORIGINAL');
      if (entry.current) tags.push('YOU ARE HERE');

      item.innerHTML = `
        <img class="counterpart-thumb" src="${escapeHtml(entry.coverImage || '')}" alt="Cover">
        <div class="counterpart-info">
          <span class="counterpart-badge">${escapeHtml(tags.join(' · '))}</span>
          <span class="counterpart-name" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</span>
          <span class="counterpart-meta">${escapeHtml(entry.format || 'TV')} ${year} ${eps}</span>
        </div>
      `;
      if (!entry.current) item.addEventListener('click', () => openEntry(entry));
      list.appendChild(item);
    });

    if (origBtn) {
      const root = franchise.items.find((x) => x.id === franchise.rootId) || franchise.items[0];
      const showBtn = !!root && !franchise.items.some((x) => x.current && x.id === root.id);
      origBtn.style.display = showBtn ? 'inline-block' : 'none';
      origBtn.onclick = showBtn ? () => openEntry(root) : null;
      origBtn.title = showBtn ? `Open the original: ${root.title}` : '';
    }
  }

  function renderCounterparts(counterparts) {
    if (!counterpartsSection || !counterpartsList) return;
    if (!Array.isArray(counterparts) || counterparts.length === 0) {
      counterpartsSection.style.display = 'none';
      return;
    }

    counterpartsSection.style.display = 'flex';
    if (counterpartsCount) counterpartsCount.textContent = counterparts.length;
    counterpartsList.innerHTML = '';

    counterparts.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'counterpart-item';
      const year = c.seasonYear ? `(${c.seasonYear})` : '';
      const eps = c.episodes ? `• ${c.episodes} eps` : '';

      item.innerHTML = `
        <img class="counterpart-thumb" src="${escapeHtml(c.coverImage || '')}" alt="Cover">
        <div class="counterpart-info">
          <span class="counterpart-badge">${escapeHtml(c.relationType || 'RELATED')}</span>
          <span class="counterpart-name" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</span>
          <span class="counterpart-meta">${escapeHtml(c.format || 'TV')} ${year} ${eps}</span>
        </div>
      `;

      item.addEventListener('click', () => {
        openModal({ id: c.id, title: { english: c.title, romaji: c.title } });
      });

      counterpartsList.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // Detail Modal & Open-Choice Stream Launcher
  // ---------------------------------------------------------------------------

  async function openModal(anime) {
    if (!anime) return;
    currentModalAnime = anime;
    detailModal.style.display = 'flex';

    // Existing history record for this anime
    const existingHistory = historyList.find((h) => String(h.id) === String(anime.id));
    const initialEp = existingHistory ? (existingHistory.lastEpisodeWatched || 1) : 1;
    currentSelectedEp = initialEp;

    const title = anime.title?.english || anime.title?.romaji || 'Untitled';
    const subTitle = anime.title?.romaji && anime.title?.romaji !== title ? anime.title.romaji : (anime.title?.native || '');
    const banner = anime.bannerImage || anime.coverImage?.extraLarge || '';
    const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || '';
    const score = anime.averageScore ? `${anime.averageScore}%` : 'N/A';
    const studio = anime.studios?.nodes?.[0]?.name || 'Unknown Studio';

    modalTitle.textContent = title;
    modalSubTitle.textContent = subTitle;
    modalBanner.style.backgroundImage = banner ? `url("${banner}")` : 'none';
    modalCover.src = cover;
    modalScore.textContent = score;
    modalEpisodes.textContent = anime.episodes ? `${anime.episodes} Episodes` : 'Simulcasting';
    modalStatus.textContent = anime.status || 'Unknown';
    modalStudio.textContent = studio;

    // Synopsis
    const rawSynopsis = anime.description ? anime.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '') : 'No synopsis available.';
    modalSynopsis.textContent = rawSynopsis;

    // Genres
    modalGenres.innerHTML = '';
    (anime.genres || []).forEach((g) => {
      const tag = document.createElement('span');
      tag.className = 'genre-tag';
      tag.textContent = g;
      modalGenres.appendChild(tag);
    });

    if (modalEpInput) modalEpInput.value = initialEp;
    if (modalStatusSelect) modalStatusSelect.value = existingHistory ? existingHistory.status : 'Watching';

    // Setup initial episode navigator and server buttons
    renderEpisodeGrid(anime, initialEp);
    selectEpisode(initialEp);

    // Fetch full details and counterpart seasons from API
    try {
      const res = await fetch(`/api/details?id=${encodeURIComponent(anime.id)}&ep=${initialEp}`);
      const data = await res.json();
      if (data.success && data.anime) {
        currentModalAnime = data.anime;
        const fullAnime = data.anime;

        // Direct relations now; the full series chain loads in the background (it can take a few seconds)
        renderCounterparts(fullAnime.counterparts || []);
        renderFranchise(null);
        const franchiseFor = anime.id;
        fetch(`/api/franchise?id=${encodeURIComponent(franchiseFor)}`)
          .then((r) => r.json())
          .then((f) => {
            if (f && f.success && currentModalAnime && String(currentModalAnime.id) === String(franchiseFor)) renderFranchise(f.franchise);
          })
          .catch((err) => console.warn('Franchise chain unavailable:', err));

        // Update availability index
        const avail = fullAnime.availability || {};
        modalSubAvail.textContent = `${avail.sub?.quality || '1080p HD'} • All streaming mirrors active`;
        modalDubAvail.textContent = avail.dub?.status || 'Sub-Only or Pending Dub';
        modalDubAvail.className = avail.dub?.available ? 'avail-status success' : 'avail-status info';

        // Re-render episode grid with full episode counts
        renderEpisodeGrid(fullAnime, currentSelectedEp);
        selectEpisode(currentSelectedEp);
      }
    } catch (err) {
      console.warn('Failed to load full anime details/counterparts:', err);
    }
  }

  async function updateDownloadSection(animeId, ep) {
    if (!animeId || !btnPrebufferEp) return;
    try {
      const res = await fetch(`/api/download/status?animeId=${encodeURIComponent(animeId)}&episode=${encodeURIComponent(ep)}`);
      const data = await res.json();
      if (!data.success) return;

      if (data.status === 'ready') {
        if (downloadProgressBox) downloadProgressBox.style.display = 'block';
        const audioBadge = data.audioLabel || (data.isDub ? 'English Dub (Verified ✓)' : 'Subbed (Dub Unavailable)');
        if (dlStatusTitle) dlStatusTitle.textContent = `Episode ${ep} Ready (${audioBadge})`;
        if (dlMetaStats) dlMetaStats.textContent = `100% Ready • 0-Lag Ultra-Buffer • ${audioBadge}`;
        if (dlProgressFill) {
          dlProgressFill.style.width = '100%';
          dlProgressFill.style.background = data.isDub ? 'var(--accent-emerald)' : 'var(--accent-cyan)';
        }
        if (btnPlayCachedStream) btnPlayCachedStream.style.display = 'inline-flex';
        if (btnCancelOrTrash) btnCancelOrTrash.innerHTML = '<span>🗑️ Trash & Free Space</span>';
        btnPrebufferEp.classList.add('ready');
        if (btnPrebufferText) btnPrebufferText.textContent = `✓ Ep ${ep} Ready (${data.isDub ? 'English Dub' : 'Sub'})`;
        clearTimeout(downloadPollTimer);
      } else if (data.status === 'downloading') {
        if (downloadProgressBox) downloadProgressBox.style.display = 'block';
        if (dlStatusTitle) dlStatusTitle.textContent = `Downloading Episode ${ep}...`;
        const pct = Math.round(data.progress || 0);
        const modeBadge = data.audioLabel || (data.isDub ? 'Prioritizing English Dub' : 'Subbed Source');
        if (dlMetaStats) dlMetaStats.textContent = `${pct}% • ${data.speed || modeBadge} • ETA ${data.eta || ''}`;
        if (dlProgressFill) {
          dlProgressFill.style.width = `${pct}%`;
          dlProgressFill.style.background = 'var(--accent-cyan)';
        }
        if (btnPlayCachedStream) btnPlayCachedStream.style.display = 'none';
        if (btnCancelOrTrash) btnCancelOrTrash.innerHTML = '<span>✕ Cancel Download</span>';
        if (btnPrebufferText) btnPrebufferText.textContent = `Buffering Dub (${pct}%)...`;

        clearTimeout(downloadPollTimer);
        downloadPollTimer = setTimeout(() => {
          if (currentModalAnime && String(currentModalAnime.id) === String(animeId) && currentSelectedEp === ep) {
            updateDownloadSection(animeId, ep);
          }
        }, 1500);
      } else if (data.status === 'failed') {
        if (downloadProgressBox) downloadProgressBox.style.display = 'block';
        if (dlStatusTitle) dlStatusTitle.textContent = 'Download Failed';
        if (dlMetaStats) dlMetaStats.textContent = data.error || 'Check mirrors or connection';
        if (dlProgressFill) {
          dlProgressFill.style.width = '100%';
          dlProgressFill.style.background = 'var(--accent-rose)';
        }
        if (btnPlayCachedStream) btnPlayCachedStream.style.display = 'none';
        if (btnCancelOrTrash) btnCancelOrTrash.innerHTML = '<span>✕ Dismiss</span>';
        if (btnPrebufferText) btnPrebufferText.textContent = `Retry Pre-Buffer Ep ${ep}`;
        clearTimeout(downloadPollTimer);
      } else {
        if (downloadProgressBox) downloadProgressBox.style.display = 'none';
        if (btnPlayCachedStream) btnPlayCachedStream.style.display = 'none';
        btnPrebufferEp.classList.remove('ready');
        if (btnPrebufferText) btnPrebufferText.textContent = `Pre-Buffer Ep ${ep} (0-Lag)`;
        clearTimeout(downloadPollTimer);
      }
    } catch (err) {
      console.warn('Failed to query download status:', err);
    }
  }

  function closeModal() {
    detailModal.style.display = 'none';
    currentModalAnime = null;
    clearTimeout(downloadPollTimer);
    if (playerFrame) {
      playerFrame.src = 'about:blank';
      playerFrame.style.display = 'block';
    }
    if (nativePlayer) {
      nativePlayer.pause();
      nativePlayer.removeAttribute('src');
      nativePlayer.load();
      nativePlayer.style.display = 'none';
    }
    if (completionOverlay) completionOverlay.style.display = 'none';
    if (playerTheaterBox) playerTheaterBox.style.display = 'none';
    activeStreamUrl = '';
  }

  // ---------------------------------------------------------------------------
  // Display & Monitor Pinning Layout Engine
  // ---------------------------------------------------------------------------

  async function openDisplayModal() {
    if (!displayModal) return;
    displayModal.style.display = 'flex';

    if (monitorChipsGrid) {
      monitorChipsGrid.innerHTML = '<div style="color: var(--text-secondary); padding: 10px;">Querying connected displays…</div>';
    }

    try {
      const res = await fetch('/api/monitors');
      const data = await res.json();
      if (data.success && Array.isArray(data.monitors) && data.monitors.length > 0) {
        detectedMonitors = data.monitors;
        renderMonitorChips(detectedMonitors);
      } else {
        detectedMonitors = [];
        if (monitorChipsGrid) {
          monitorChipsGrid.innerHTML = `
            <div style="background: rgba(255,255,255,0.04); border: 1px dashed var(--border-color); padding: 12px; border-radius: var(--radius-sm); color: var(--text-secondary); font-size: 12px;">
              📱 Remote Client or Virtual Display detected. Use Full Screen below to toggle native browser expansion.
            </div>
          `;
        }
      }
    } catch (err) {
      console.warn('Error querying monitors:', err);
    }
  }

  function renderMonitorChips(monitors) {
    if (!monitorChipsGrid) return;
    monitorChipsGrid.innerHTML = '';

    if (!selectedMonitorId || !monitors.some((m) => m.id === selectedMonitorId)) {
      const laptop = monitors.find((m) => m.isLaptop);
      selectedMonitorId = laptop ? laptop.id : monitors[0].id;
    }

    monitors.forEach((m) => {
      const chip = document.createElement('button');
      chip.className = `monitor-chip ${m.id === selectedMonitorId ? 'active' : ''}`;
      chip.type = 'button';
      chip.innerHTML = `
        <span>${escapeHtml(m.name)}</span>
        <span class="badge-primary">${m.isPrimary ? 'Primary' : (m.isLaptop ? 'Laptop' : 'Secondary')}</span>
      `;
      chip.addEventListener('click', () => {
        selectedMonitorId = m.id;
        monitorChipsGrid.querySelectorAll('.monitor-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
      });
      monitorChipsGrid.appendChild(chip);
    });
  }

  function closeDisplayModal() {
    if (displayModal) displayModal.style.display = 'none';
  }

  async function executePinWindow() {
    if (detectedMonitors.length > 0 && selectedMonitorId) {
      showToast('Repositioning window layout...');
      try {
        const res = await fetch('/api/pin-display', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            monitorId: selectedMonitorId,
            mode: selectedCoverageMode,
            side: selectedCoverageSide,
          }),
        });
        const data = await res.json();
        if (data.success) {
          const modeDesc = selectedCoverageMode === 'full' ? 'Full Screen' : `Partial (${selectedCoverageSide})`;
          showToast(`📌 Pinned window to ${data.monitor || selectedMonitorId} [${modeDesc}]`);
        } else {
          showToast(`Pin failed: ${data.error || 'Check display server'}`);
        }
      } catch (err) {
        showToast('Error sending pin command to display server');
      }
    } else {
      if (selectedCoverageMode === 'full') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
          showToast('Entered Fullscreen Theater Mode');
        } else {
          document.exitFullscreen().catch(() => {});
          showToast('Exited Fullscreen');
        }
      } else {
        showToast('Partial layout applied to current viewport');
      }
    }
    closeDisplayModal();
  }

  // ---------------------------------------------------------------------------
  // Event Listeners & Initialization
  // ---------------------------------------------------------------------------

  function setupEvents() {
    // Close button: two clicks (arm, then confirm) so a stray click cannot kill a playing episode.
    const btnCloseWindow = document.getElementById('btn-close-window');
    if (btnCloseWindow) {
      let armTimer = null;
      const disarm = () => {
        clearTimeout(armTimer);
        armTimer = null;
        btnCloseWindow.textContent = '✕ Close';
        btnCloseWindow.classList.remove('armed');
      };
      btnCloseWindow.addEventListener('click', async () => {
        if (!armTimer) {
          btnCloseWindow.textContent = 'Click again to close';
          btnCloseWindow.classList.add('armed');
          armTimer = setTimeout(disarm, 3000);
          return;
        }
        disarm();
        try {
          const res = await fetch('/api/close-window', { method: 'POST', headers: { 'X-AnimePulse': '1' } });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
        } catch (err) {
          console.error('close-window failed:', err);
          try { window.close(); } catch {}
          showToast('Could not close window: ' + err.message);
        }
      });
    }

        // Interactive Toolbar: Audio Filter Pills
    const audioPills = document.querySelectorAll('.audio-pill');
    audioPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        audioPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        currentAudioFilter = pill.getAttribute('data-audio') || 'all';
        renderGrid(activeAnimeList);
      });
    });

    // Interactive Toolbar: Sort Selector
    const sortSelect = document.getElementById('sort-selector');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderGrid(activeAnimeList);
      });
    }

    // Interactive Toolbar: Density Toggle
    const btnDensityGrid = document.getElementById('btn-density-grid');
    const btnDensityCompact = document.getElementById('btn-density-compact');
    if (btnDensityGrid && btnDensityCompact) {
      btnDensityGrid.addEventListener('click', () => {
        btnDensityGrid.classList.add('active');
        btnDensityCompact.classList.remove('active');
        animeGrid.classList.remove('compact');
      });
      btnDensityCompact.addEventListener('click', () => {
        btnDensityCompact.classList.add('active');
        btnDensityGrid.classList.remove('active');
        animeGrid.classList.add('compact');
      });
    }

    // Episode search filter input
    const epFilterInput = document.getElementById('ep-filter-input');
    if (epFilterInput) {
      epFilterInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        const epBtns = epButtonsGrid?.querySelectorAll('.btn-ep-choice');
        if (!epBtns) return;
        epBtns.forEach((b) => {
          const epNum = b.getAttribute('data-ep');
          if (!query || (epNum && epNum.includes(query))) {
            b.style.display = '';
          } else {
            b.style.display = 'none';
          }
        });
      });
    }

    // Keyboard Shortcuts: / to search, f for fullscreen
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
      if ((e.key === 'f' || e.key === 'F') && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        if (nativePlayer && playerTheaterBox?.style.display !== 'none') {
          if (!document.fullscreenElement) {
            playerTheaterBox.requestFullscreen?.().catch(() => {});
          } else {
            document.exitFullscreen?.().catch(() => {});
          }
        }
      }
    });

    // Mode Tabs
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.getAttribute('data-mode');
        currentSearch = '';
        currentPage = 1;
        currentLiveGenre = 'All';
        if (searchInput) searchInput.value = '';
        if (searchClearBtn) searchClearBtn.style.display = 'none';
        syncModeChrome();
        if (currentMode === 'history') {
          loadHistory();
        }
        loadFeed();
      });
    });

    const btnRefreshDl = document.getElementById('btn-refresh-downloads');
    if (btnRefreshDl) btnRefreshDl.addEventListener('click', () => renderDownloadsView());
    const btnPurge = document.getElementById('btn-purge-watched');
    if (btnPurge) btnPurge.addEventListener('click', async () => {
      const call = async (dryRun) => { const r = await fetch('/api/download/purge-watched', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun }) }); const j = await r.json(); if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`); return j; };
      try {
        const pre = await call(true);
        if (!pre.count) { alert('No cached episodes are 95% or more watched.'); return; }
        const mb = (pre.freedBytes / 1048576).toFixed(0);
        if (!confirm(`Delete ${pre.count} cached episode(s) watched 95%+ and free ~${mb} MB?`)) return;
        const done = await call(false);
        alert(`Deleted ${done.count} episode(s), freed ~${(done.freedBytes / 1048576).toFixed(0)} MB.`);
        renderDownloadsView();
      } catch (err) { alert(`Purge failed: ${err.message}`); }
    });
    const btnIdent = document.getElementById('btn-identify-episodes');
    if (btnIdent) btnIdent.addEventListener('click', async () => {
      const call = async (apply) => { const r = await fetch('/api/files/identify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply }) }); const j = await r.json(); if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`); return j; };
      const orig = btnIdent.textContent; btnIdent.disabled = true; btnIdent.textContent = '⏳ Scanning…';
      try {
        const pre = await call(false);
        const un = pre.unresolved.length;
        if (!pre.proposals.length) { alert(un ? `Nothing could be renamed automatically. ${un} file(s) couldn't be identified:\n` + pre.unresolved.slice(0, 8).map((u) => `• ${u.from} (${u.reason})`).join('\n') : 'All episode files are already labeled.'); return; }
        const lines = pre.proposals.slice(0, 15).map((p) => `${p.from}\n   → ${p.to}${p.confidence === 'verified' ? '' : '  (unverified title)'}`).join('\n');
        const more = pre.proposals.length > 15 ? `\n…and ${pre.proposals.length - 15} more` : '';
        if (!confirm(`Rename ${pre.proposals.length} file(s)?${un ? ` (${un} can't be identified and will be left alone)` : ''}\n\n${lines}${more}`)) return;
        const done = await call(true);
        alert(`Renamed ${done.done.length} file(s).${done.failed.length ? `\n${done.failed.length} failed: ` + done.failed.slice(0, 5).map((f) => `${f.from}: ${f.error}`).join('; ') : ''}`);
        renderDownloadsView();
      } catch (err) { alert(`Scan failed: ${err.message}`); }
      finally { btnIdent.disabled = false; btnIdent.textContent = orig; }
    });

    // Genre Chips
    genreChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        genreChips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        currentGenre = chip.getAttribute('data-genre') || 'All';
        currentPage = 1;
        loadFeed();
      });
    });

    // Search Input with Debounce
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (searchClearBtn) searchClearBtn.style.display = val ? 'inline-block' : 'none';
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          currentSearch = val;
          currentPage = 1;
          loadFeed();
        }, 350);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearTimeout(searchDebounceTimer);
          currentSearch = searchInput.value.trim();
          currentPage = 1;
          loadFeed();
        }
      });
    }

    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchClearBtn.style.display = 'none';
        currentSearch = '';
        currentPage = 1;
        loadFeed();
      });
    }

    // In-App Theater Player Controls
    if (btnPlayerClose) {
      btnPlayerClose.addEventListener('click', () => {
        if (playerFrame) {
          playerFrame.src = 'about:blank';
          playerFrame.style.display = 'block';
        }
        if (nativePlayer) {
          sendPlaybackPosition(false);
          playbackCtx = null;
          playbackToken++;
          nativePlayer.pause();
          nativePlayer.removeAttribute('src');
          nativePlayer.load();
          nativePlayer.style.display = 'none';
        }
        if (completionOverlay) completionOverlay.style.display = 'none';
        if (playerTheaterBox) playerTheaterBox.style.display = 'none';
        activeStreamUrl = '';
        showToast('Theater player closed');
      });
    }

    if (btnPlayerExternal) {
      btnPlayerExternal.addEventListener('click', () => {
        if (activeStreamUrl) {
          window.open(activeStreamUrl, '_blank');
          showToast('Opened stream in external popout');
        }
      });
    }

    // Native Video Completion Trigger
    if (nativePlayer) {
      nativePlayer.addEventListener('ended', () => {
        const ep = activePlayingDownloadKey?.episode || currentSelectedEp;
        const title = currentModalAnime?.title?.english || currentModalAnime?.title?.romaji || 'Anime';
        if (completionTitle) {
          completionTitle.textContent = `${title} — Episode ${ep} Finished!`;
        }
        if (completionOverlay) {
          completionOverlay.style.display = 'flex';
        }
      });
    }

    // Completion Overlay Buttons: Trash vs Save vs Next
    if (btnCompletionTrash) {
      btnCompletionTrash.addEventListener('click', async () => {
        if (!currentModalAnime) return;
        const ep = activePlayingDownloadKey?.episode || currentSelectedEp;
        try {
          const res = await fetch('/api/download/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ animeId: currentModalAnime.id, episode: ep, action: 'trash' }),
          });
          const data = await res.json();
          if (data.success) {
            showToast('🗑️ Episode trashed & ephemeral disk space reclaimed!');
          }
        } catch (err) {
          console.error('Failed to trash episode:', err);
        }
        if (completionOverlay) completionOverlay.style.display = 'none';
        updateDownloadSection(currentModalAnime.id, ep);
      });
    }

    if (btnCompletionSave) {
      btnCompletionSave.addEventListener('click', async () => {
        if (!currentModalAnime) return;
        const ep = activePlayingDownloadKey?.episode || currentSelectedEp;
        try {
          const res = await fetch('/api/download/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ animeId: currentModalAnime.id, episode: ep, action: 'save' }),
          });
          const data = await res.json();
          if (data.success) {
            showToast('💾 Episode saved to your permanent library!');
          }
        } catch (err) {
          console.error('Failed to save episode:', err);
        }
        if (completionOverlay) completionOverlay.style.display = 'none';
        updateDownloadSection(currentModalAnime.id, ep);
      });
    }

    if (btnCompletionNext) {
      btnCompletionNext.addEventListener('click', () => {
        if (completionOverlay) completionOverlay.style.display = 'none';
        const currentEp = activePlayingDownloadKey?.episode || currentSelectedEp;
        const nextEp = currentEp + 1;
        const total = currentModalAnime?.episodes || 999;
        if (nextEp <= total) {
          selectEpisode(nextEp);
          showToast(`Advancing to Episode ${nextEp}...`);
        } else {
          showToast('🎉 You have reached the final episode of this series!');
        }
      });
    }

    // Pre-Download Section Controls
    if (btnPrebufferEp) {
      btnPrebufferEp.addEventListener('click', async () => {
        if (!currentModalAnime) return;
        const title = currentModalAnime.title?.english || currentModalAnime.title?.romaji || 'Anime';
        const altTitle = currentModalAnime.title?.romaji || currentModalAnime.title?.english || '';
        showToast(`⚡ Prioritizing English Dub for Episode ${currentSelectedEp}...`);
        try {
          const res = await fetch('/api/download/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              animeId: currentModalAnime.id,
              episode: currentSelectedEp,
              title,
              altTitle,
              totalEpisodes: currentModalAnime.episodes || 1,
            }),
          });
          const data = await res.json();
          if (data.success) {
            updateDownloadSection(currentModalAnime.id, currentSelectedEp);
          } else {
            showToast(`Download failed to start: ${data.message || 'Error'}`);
          }
        } catch (err) {
          console.error('Error starting download:', err);
          showToast('Failed to contact download service');
        }
      });
    }

    if (btnDownloadSeriesModal) {
      btnDownloadSeriesModal.addEventListener('click', async () => {
        if (!currentModalAnime) return;
        const title = currentModalAnime.title?.english || currentModalAnime.title?.romaji || 'Anime';
        const altTitle = currentModalAnime.title?.romaji || currentModalAnime.title?.english || '';
        const total = Math.min(currentModalAnime.episodes || 12, 12);
        showToast(`📦 Queuing season batch for ${title} (Prioritizing English Dub)...`);
        try {
          await fetch('/api/download/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              animeId: currentModalAnime.id,
              episode: currentSelectedEp,
              title,
              altTitle,
              totalEpisodes: currentModalAnime.episodes || 1,
              isSeries: true,
            }),
          });
          updateDownloadSection(currentModalAnime.id, currentSelectedEp);
        } catch (err) {
          console.error('Error initiating series download:', err);
        }
      });
    }

    if (btnPlayCachedStream) {
      btnPlayCachedStream.addEventListener('click', () => {
        if (currentModalAnime) {
          playLocalVideo(currentModalAnime, currentSelectedEp);
        }
      });
    }

    if (btnCancelOrTrash) {
      btnCancelOrTrash.addEventListener('click', async () => {
        if (!currentModalAnime) return;
        try {
          await fetch('/api/download/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              animeId: currentModalAnime.id,
              episode: currentSelectedEp,
              action: 'trash',
            }),
          });
          showToast('Episode cache cleared.');
          updateDownloadSection(currentModalAnime.id, currentSelectedEp);
        } catch (err) {
          console.error('Failed to cancel/trash:', err);
        }
      });
    }

    // Modal Close
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
    if (liveModalCloseBtn) liveModalCloseBtn.addEventListener('click', closeLiveModal);
    if (liveModal) {
      liveModal.addEventListener('click', (e) => {
        if (e.target === liveModal) closeLiveModal();
      });
    }
    if (detailModal) {
      detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) closeModal();
      });
    }

    // Episode Navigation Buttons & Input
    if (btnPrevEp) {
      btnPrevEp.addEventListener('click', () => {
        selectEpisode(currentSelectedEp - 1, true);
      });
    }
    if (btnNextEp) {
      btnNextEp.addEventListener('click', () => {
        selectEpisode(currentSelectedEp + 1, true);
      });
    }
    if (btnPlayerPrevEp) {
      btnPlayerPrevEp.addEventListener('click', () => {
        selectEpisode(currentSelectedEp - 1, true);
      });
    }
    if (btnPlayerNextEp) {
      btnPlayerNextEp.addEventListener('click', () => {
        selectEpisode(currentSelectedEp + 1, true);
      });
    }
    if (modalEpInput) {
      modalEpInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10) || 1;
        selectEpisode(val, true);
      });
    }

    // Save History from modal
    if (modalSaveHistoryBtn) {
      modalSaveHistoryBtn.addEventListener('click', () => {
        if (!currentModalAnime) return;
        const ep = parseInt(modalEpInput.value, 10) || 1;
        const status = modalStatusSelect.value;
        recordWatchHistory(currentModalAnime, ep, status);
        showToast(`Saved progress: Episode ${ep} (${status})`);
      });
    }

    // Sync History with Browser Activity
    if (btnSyncHistory) {
      btnSyncHistory.addEventListener('click', async () => {
        showToast('🔄 Syncing watch history with browser...');
        try {
          const res = await fetch('/api/history/sync', { method: 'POST' });
          const data = await res.json();
          if (data.success && Array.isArray(data.history)) {
            historyList = data.history;
            if (historyBadge) historyBadge.textContent = historyList.length;
            renderHistoryView();
            showToast('✅ Watch history synced with browser activity!');
          }
        } catch (err) {
          console.error('History sync error:', err);
          showToast('Failed to sync history with browser');
        }
      });
    }

    // Clear All History
    if (btnClearHistory) {
      btnClearHistory.addEventListener('click', async () => {
        if (confirm('Clear all watch history?')) {
          await fetch('/api/history?id=all', { method: 'DELETE' });
          loadHistory();
          showToast('All history cleared');
        }
      });
    }

    // Display & Pinning Button
    if (btnDisplayPin) {
      btnDisplayPin.addEventListener('click', openDisplayModal);
    }

    if (displayModalCloseBtn) {
      displayModalCloseBtn.addEventListener('click', closeDisplayModal);
    }

    if (btnDisplayCancel) {
      btnDisplayCancel.addEventListener('click', closeDisplayModal);
    }

    if (btnExecutePin) {
      btnExecutePin.addEventListener('click', executePinWindow);
    }

    if (displayModal) {
      displayModal.addEventListener('click', (e) => {
        if (e.target === displayModal) closeDisplayModal();
      });
    }

    // Coverage Mode Buttons
    if (coverageOptionsGrid) {
      const coverageBtns = coverageOptionsGrid.querySelectorAll('.coverage-btn');
      coverageBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          coverageBtns.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          selectedCoverageMode = btn.getAttribute('data-mode') || 'full';
          selectedCoverageSide = btn.getAttribute('data-side') || 'left';
        });
      });
    }

    // Remote Family Share Link Button
    if (btnShareLink) {
      btnShareLink.addEventListener('click', async () => {
        if (currentRemoteUrl) {
          try {
            await navigator.clipboard.writeText(currentRemoteUrl);
            showToast('📋 Family streaming link copied to clipboard!');
          } catch {
            prompt('Copy this streaming link for your family member:', currentRemoteUrl);
          }
        } else {
          showToast('Connecting remote tunnel... please retry in 5 seconds.');
          loadStats();
        }
      });
    }

    // Global ESC to close modals
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (displayModal && displayModal.style.display === 'flex') {
          closeDisplayModal();
        } else if (detailModal && detailModal.style.display === 'flex') {
          closeModal();
        } else if (liveModal && liveModal.style.display === 'flex') {
          closeLiveModal();
        }
      }
    });
  }

  function init() {
    setupEvents();
    loadStats();
    loadHistory();
    loadFeed();

    // Poll stats every 15 seconds to update outside viewer count and remote link
    setInterval(loadStats, 15000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
