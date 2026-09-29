(() => {
  let sessionToken = sessionStorage.getItem('vault_token') || null;
  let IS_GUEST = false; // set by /api/vault/status on the invite gateway
  let currentContentType = 'hentai';
  let currentView = 'explore';
  let currentCategory = 'trending';
  let currentCategoryTag = 'All';
  let currentSearch = '';
  let uncensoredOnly = true;
  let activeAnime = null;
  let activeBookmarks = new Set();
  let userPreferences = {
    defaultMode: 'hentai',
    uncensoredOnly: true,
    favoriteGenres: ['Romance', 'Comedy', 'Ecchi', 'Fantasy']
  };

  const HENTAI_CATEGORIES = [
    { id: 'All', name: '✨ All Categories' },
    { id: 'Romance', name: '❤️ Vanilla & Romance' },
    { id: 'Female Harem', name: '👑 Harem' },
    { id: 'MILF', name: '🍷 MILF & Mature' },
    { id: 'Gyaru', name: '💅 Gyaru' },
    { id: 'Ecchi', name: '🔥 Ecchi' },
    { id: 'Fantasy', name: '⚔️ Fantasy & Isekai' },
    { id: 'Supernatural', name: '🔮 Supernatural & Demon' },
    { id: 'Succubus', name: '🦇 Succubus' },
    { id: 'Maids', name: '🎀 Maid & Cosplay' },
    { id: 'Office Lady', name: '💼 Office Lady' },
    { id: 'Tsundere', name: '💢 Tsundere' },
    { id: 'Yandere', name: '🔪 Yandere' },
    { id: 'Monster Girl', name: '🐾 Monster Girls' },
    { id: 'Incest', name: '🏡 Family & Taboo' },
    { id: 'Teacher', name: '👩‍🏫 Teacher & Student' },
    { id: 'Nurse', name: '💉 Nurse & Medical' },
    { id: 'Elf', name: '🧝‍♀️ Elf & Fantasy Race' },
    { id: 'Large Breasts', name: '🍈 Oppai & Busty' },
    { id: 'Threesome', name: '👯‍♀️ Threesome & Group' },
    { id: 'Sci-Fi', name: '🚀 Cyberpunk & Sci-Fi' },
    { id: 'Action', name: '⚡ Action & Adventure' },
    { id: 'Comedy', name: '🤣 Comedy' },
    { id: 'Mystery', name: '🔍 Mystery' }
  ];

  const REAL_CATEGORIES = [
    { id: 'All', name: '✨ All English & Western' },
    { id: 'amateur', name: '📹 Amateur & Verified' },
    { id: 'milf', name: '🍷 American MILF & Mature' },
    { id: 'pov', name: '👓 POV / First Person' },
    { id: 'blonde', name: '👱‍♀️ Blonde Babes' },
    { id: 'brunette', name: '👩 Brunette' },
    { id: 'big tits', name: '🍈 Busty & Curvy' },
    { id: 'college', name: '🎓 College & Reality' },
    { id: 'threesome', name: '🔥 Threesome (FMF)' },
    { id: 'squirting', name: '💦 Squirting & Intense' },
    { id: 'petite', name: '🎀 Petite & Athletic' },
    { id: 'latina', name: '💃 Latina' },
    { id: 'ebony', name: '✨ Ebony' },
    { id: 'redhead', name: '🦊 Redhead' },
    { id: 'massage', name: '💆 Sensual Massage' },
    { id: 'nurse', name: '💉 Nurse & Uniform' },
    { id: 'teacher', name: '👩‍🏫 Teacher & Student' },
    { id: 'solo', name: '✨ Solo & Fingering' },
    { id: '1080p', name: '💎 Full HD 1080p' }
  ];

  // Pagination state for endless scrolling
  let currentPage = 1;
  let hasNextPage = true;
  let isLoadingMore = false;

  // DOM Elements
  const categoryStrip = document.getElementById('category-strip');
  const pinModal = document.getElementById('pin-modal');
  const pinForm = document.getElementById('pin-form');
  const pinInput = document.getElementById('pin-input');
  const pinConfirmContainer = document.getElementById('pin-confirm-container');
  const pinConfirmInput = document.getElementById('pin-confirm-input');
  const pinError = document.getElementById('pin-error');
  const pinModalTitle = document.getElementById('pin-modal-title');
  const pinModalDesc = document.getElementById('pin-modal-desc');
  const pinSubmitBtn = document.getElementById('pin-submit-btn');

  const vaultStatusIndicator = document.getElementById('vault-status-indicator');
  const vaultStatusText = document.getElementById('vault-status-text');
  const personalizeBtn = document.getElementById('personalize-btn');
  const lockBtn = document.getElementById('lock-btn');
  const purgeBtn = document.getElementById('purge-btn');

  const modeButtons = document.querySelectorAll('.mode-btn');
  const uncensoredCheckbox = document.getElementById('uncensored-filter');

  const mainContent = document.getElementById('main-content');
  const mediaGrid = document.getElementById('media-grid');
  const loadingSpinner = document.getElementById('loading-spinner');
  const emptyState = document.getElementById('empty-state');
  const emptyTitle = document.getElementById('empty-title');
  const emptyDesc = document.getElementById('empty-desc');

  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const genreSelect = document.getElementById('genre-select');
  const navTabs = document.querySelectorAll('.nav-tab');

  // Shelves
  const homepagePersonalization = document.getElementById('homepage-personalization');
  const shelfContinue = document.getElementById('shelf-continue');
  const shelfContinueRow = document.getElementById('shelf-continue-row');
  const shelfBookmarks = document.getElementById('shelf-bookmarks');
  const shelfBookmarksRow = document.getElementById('shelf-bookmarks-row');
  const catalogHeading = document.getElementById('catalog-heading');

  // Infinite Scroll Sentinel & Spinner
  const sentinel = document.getElementById('infinite-scroll-sentinel');
  const infiniteSpinner = document.getElementById('infinite-scroll-spinner');

  // Detail Modal
  const detailModal = document.getElementById('detail-modal');
  const detailCloseBtn = document.getElementById('detail-close-btn');
  const detailPoster = document.getElementById('detail-poster');
  const detailTitle = document.getElementById('detail-title');
  const detailScore = document.getElementById('detail-score');
  const detailEpisodes = document.getElementById('detail-episodes');
  const detailGenres = document.getElementById('detail-genres');
  const detailSynopsis = document.getElementById('detail-synopsis');
  const bookmarkToggleBtn = document.getElementById('bookmark-toggle-btn');
  const streamButtonsContainer = document.getElementById('stream-buttons-container');

  const inappPlayerContainer = document.getElementById('inapp-player-container');
  const inappPlayerFrame = document.getElementById('inapp-player-frame');
  const closePlayerBtn = document.getElementById('close-player-btn');
  const uncensoredBadge = document.getElementById('uncensored-badge');

  // Preferences Modal
  const prefsModal = document.getElementById('prefs-modal');
  const prefsCloseBtn = document.getElementById('prefs-close-btn');
  const prefsForm = document.getElementById('prefs-form');
  const prefUncensored = document.getElementById('pref-uncensored');
  const prefGenreTags = document.getElementById('pref-genre-tags');

  // ---------------------------------------------------------------------------
  // API Fetch Helper
  // ---------------------------------------------------------------------------
  async function apiFetch(endpoint, options = {}) {
    const headers = options.headers || {};
    if (sessionToken) {
      headers['X-Vault-Token'] = sessionToken;
    }
    headers['Content-Type'] = 'application/json';
    headers['X-VaultPulse'] = '1';
    const res = await fetch(endpoint, { ...options, headers });
    if (res.status === 401 || (IS_GUEST && res.status === 404)) {
      if (IS_GUEST) { location.replace('/'); throw new Error('Guest session ended'); }
      lockClient();
      throw new Error('Vault Locked');
    }
    return res.json();
  }

  // ---------------------------------------------------------------------------
  // Security & Vault Lifecycle
  // ---------------------------------------------------------------------------
  async function checkVaultStatus() {
    try {
      const data = await apiFetch('/api/vault/status');
      if (data.guest) {
        IS_GUEST = true; sessionToken = 'guest';
        for (const id of ['purge-btn', 'personalize-btn', 'admin-link', 'share-btn', 'exit-btn', 'pin-exit-btn', 'kill-btn', 'pin-kill-btn']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
        const lb = document.getElementById('lock-btn');
        if (lb) { // swap in a clean Log out button (drops the owner-vault handlers)
          const nb = lb.cloneNode(false); nb.textContent = '🚪 Log out'; nb.title = 'End your session and erase it';
          nb.addEventListener('click', async () => { try { await fetch('/api/guest/logout', { method: 'POST' }); } catch {} location.replace('/'); });
          lb.replaceWith(nb);
        }
        unlockClient();
      } else if (!data.configured) {
        showPinModal(true);
      } else if (!data.unlocked || !sessionToken) {
        showPinModal(false);
      } else {
        unlockClient();
      }
    } catch (e) {
      showPinModal(false);
    }
  }

  function showPinModal(isSetup) {
    pinModal.style.display = 'flex';
    pinInput.value = '';
    pinConfirmInput.value = '';
    pinError.style.display = 'none';

    if (isSetup) {
      pinModalTitle.textContent = 'Create Master Vault PIN';
      pinModalDesc.textContent = 'Choose a secret PIN to encrypt your watch history and bookmarks with AES-256-GCM.';
      pinConfirmContainer.style.display = 'block';
      pinSubmitBtn.textContent = 'Encrypt & Lock Vault';
    } else {
      pinModalTitle.textContent = 'Enter Master PIN';
      pinModalDesc.textContent = 'Vault is locked. Enter your secret PIN to decrypt your private session.';
      pinConfirmContainer.style.display = 'none';
      pinSubmitBtn.textContent = 'Unlock Vault';
    }
    pinInput.focus();
  }

  function lockClient() {
    if (IS_GUEST) return; // guests have no vault to lock
    sessionToken = null;
    sessionStorage.removeItem('vault_token');
    vaultStatusIndicator.className = 'status-indicator locked';
    vaultStatusText.textContent = 'Locked';
    detailModal.style.display = 'none';
    prefsModal.style.display = 'none';
    closePlayer();
    showPinModal(false);
  }

  // Header shows whether outbound traffic really exits through Tor (owner only).
  async function showNetStatus() {
    if (IS_GUEST) return;
    try {
      const n = await apiFetch('/api/net-status');
      if (n && n.success) {
        vaultStatusText.textContent = n.isTor ? 'Encrypted · 🧅 via Tor' : (n.proxied ? 'Encrypted · ⚠️ Tor check failed' : 'Encrypted · ⚠️ NOT via Tor');
        vaultStatusText.title = n.isTor ? `Tor exit IP: ${n.exitIp}` : (n.error || 'Traffic is not confirmed to leave through Tor');
      }
    } catch (e) { /* locked or offline: leave the default label */ }
  }

  async function unlockClient() {
    pinModal.style.display = 'none';
    vaultStatusIndicator.className = 'status-indicator unlocked';
    vaultStatusText.textContent = 'Encrypted (AES-GCM)';
    showNetStatus();
    await loadPreferences();
    renderCategoryStrip();
    loadBookmarks();
    refreshView();
  }

  pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = pinInput.value.trim();
    if (!pin || pin.length < 4) {
      pinError.textContent = 'PIN must be at least 4 digits';
      pinError.style.display = 'block';
      return;
    }

    if (pinConfirmContainer.style.display === 'block') {
      const confirmPin = pinConfirmInput.value.trim();
      if (pin !== confirmPin) {
        pinError.textContent = 'PINs do not match';
        pinError.style.display = 'block';
        return;
      }

      try {
        const res = await fetch('/api/vault/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-VaultPulse': '1' },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (data.success && data.token) {
          sessionToken = data.token;
          sessionStorage.setItem('vault_token', sessionToken);
          unlockClient();
        } else {
          pinError.textContent = data.error || 'Setup failed';
          pinError.style.display = 'block';
        }
      } catch (err) {
        pinError.textContent = err.message;
        pinError.style.display = 'block';
      }
    } else {
      try {
        const res = await fetch('/api/vault/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-VaultPulse': '1' },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (data.success && data.token) {
          sessionToken = data.token;
          sessionStorage.setItem('vault_token', sessionToken);
          unlockClient();
        } else {
          pinError.textContent = data.error || 'Incorrect Master PIN';
          pinError.style.display = 'block';
        }
      } catch (err) {
        pinError.textContent = err.message;
        pinError.style.display = 'block';
      }
    }
  });

  lockBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/vault/lock', { method: 'POST' });
    } catch (e) {}
    lockClient();
  });

  purgeBtn.addEventListener('click', async () => {
    const confirm1 = confirm('⚠️ EMERGENCY PURGE: This will completely destroy all encrypted vault records, bookmarks, and encryption keys from disk. Proceed?');
    if (!confirm1) return;
    const confirm2 = confirm('Confirm second time: Are you absolutely certain you want to zero-out all data?');
    if (!confirm2) return;

    try {
      const purged = await apiFetch('/api/vault/purge', { method: 'POST' });
      if (!purged.success) throw new Error(purged.error || 'Purge failed');
      alert('All vault data securely destroyed.');
      location.reload();
    } catch (err) {
      alert('Purge error: ' + err.message);
    }
  });

  // Lock when the window goes away (close, crash, navigation). sendBeacon cannot set headers, and
  // /api/vault/lock needs none; locking can only reduce access. A reload therefore re-asks for the PIN.
  window.addEventListener('pagehide', () => {
    if (!IS_GUEST && sessionToken) {
      try { navigator.sendBeacon('/api/vault/lock'); } catch (e) {}
    }
  });

  // Lock & Exit: two clicks (arm, then confirm). Server locks the vault, then closes this Chrome window.
  function wireExitButton(btn, idleLabel) {
    if (!btn) return;
    let armTimer = null;
    const disarm = () => { clearTimeout(armTimer); armTimer = null; btn.textContent = idleLabel; };
    btn.addEventListener('click', async () => {
      if (!armTimer) {
        btn.textContent = 'Click again to exit';
        armTimer = setTimeout(disarm, 3000);
        return;
      }
      disarm();
      try {
        const res = await fetch('/api/close-window', { method: 'POST', headers: { 'X-VaultPulse': '1' } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      } catch (err) {
        lockClient();
        try { window.close(); } catch (e) {}
        alert('Vault locked, but the window could not be closed: ' + err.message);
      }
    });
  }
  // Kill switch: two clicks. Server locks, then destroys profile + Tor state and relaunches a fresh window.
  function wireKillButton(btn, idleLabel) {
    if (!btn) return;
    let armTimer = null;
    const disarm = () => { clearTimeout(armTimer); armTimer = null; btn.textContent = idleLabel; };
    btn.addEventListener('click', async () => {
      if (!armTimer) {
        btn.textContent = 'Click again: WIPE + restart';
        armTimer = setTimeout(disarm, 3000);
        return;
      }
      clearTimeout(armTimer); armTimer = null;
      btn.textContent = 'Wiping…';
      try { sessionStorage.clear(); } catch (e) {}
      try {
        const res = await fetch('/api/kill-switch', { method: 'POST', headers: { 'X-VaultPulse': '1' } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
        document.body.innerHTML = '<div style="font:16px sans-serif;color:#aaa;padding:40px">Kill switch engaged. This window will close; a fresh one opens after Tor restarts (usually under 2 minutes, up to 5).</div>';
      } catch (err) {
        lockClient();
        btn.textContent = idleLabel;
        alert('Kill switch failed: ' + err.message);
      }
    });
  }
  wireKillButton(document.getElementById('kill-btn'), '🧨 Kill Switch');
  wireKillButton(document.getElementById('pin-kill-btn'), '🧨 Kill Switch');
  wireExitButton(document.getElementById('exit-btn'), '⏻ Lock & Exit');
  wireExitButton(document.getElementById('pin-exit-btn'), '⏻ Exit');

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (detailModal && detailModal.style.display !== 'none') {
        detailModal.style.display = 'none';
        closePlayer();
        return;
      }
      if (prefsModal && prefsModal.style.display !== 'none') {
        prefsModal.style.display = 'none';
        return;
      }
      if (vaultStatusIndicator && vaultStatusIndicator.classList.contains('unlocked')) {
        lockBtn.click();
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Personalization & Preferences
  // ---------------------------------------------------------------------------
  async function loadPreferences() {
    try {
      const data = await apiFetch('/api/vault/preferences');
      if (data.success && data.preferences) {
        userPreferences = data.preferences;
        if (userPreferences.defaultMode) {
          currentContentType = userPreferences.defaultMode;
          modeButtons.forEach(b => {
            b.classList.toggle('active', b.dataset.contentType === currentContentType);
          });
        }
        if (typeof userPreferences.uncensoredOnly === 'boolean') {
          uncensoredOnly = userPreferences.uncensoredOnly;
          if (uncensoredCheckbox) uncensoredCheckbox.checked = uncensoredOnly;
        }
      }
    } catch (e) {}
  }

  personalizeBtn.addEventListener('click', () => {
    // Populate preferences form
    const modeRadio = prefsForm.querySelector(`input[name="pref-mode"][value="${userPreferences.defaultMode || 'hentai'}"]`);
    if (modeRadio) modeRadio.checked = true;
    if (prefUncensored) prefUncensored.checked = userPreferences.uncensoredOnly !== false;

    const favoriteGenres = new Set(userPreferences.favoriteGenres || ['Romance', 'Comedy', 'Ecchi', 'Fantasy']);
    prefGenreTags.querySelectorAll('.genre-tag').forEach(tag => {
      tag.classList.toggle('active', favoriteGenres.has(tag.dataset.genre));
    });

    prefsModal.style.display = 'flex';
  });

  prefsCloseBtn.addEventListener('click', () => {
    prefsModal.style.display = 'none';
  });

  prefGenreTags.addEventListener('click', (e) => {
    if (e.target.classList.contains('genre-tag')) {
      e.target.classList.toggle('active');
    }
  });

  prefsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const selectedMode = prefsForm.querySelector('input[name="pref-mode"]:checked')?.value || 'hentai';
    const isUncensored = prefUncensored.checked;
    const selectedGenres = Array.from(prefGenreTags.querySelectorAll('.genre-tag.active')).map(t => t.dataset.genre);

    userPreferences = {
      defaultMode: selectedMode,
      uncensoredOnly: isUncensored,
      favoriteGenres: selectedGenres
    };

    try {
      await apiFetch('/api/vault/preferences', {
        method: 'POST',
        body: JSON.stringify(userPreferences)
      });
      currentContentType = selectedMode;
      uncensoredOnly = isUncensored;
      modeButtons.forEach(b => {
        b.classList.toggle('active', b.dataset.contentType === currentContentType);
      });
      if (uncensoredCheckbox) uncensoredCheckbox.checked = uncensoredOnly;
      prefsModal.style.display = 'none';
      refreshView();
    } catch (err) {
      alert('Error saving preferences: ' + err.message);
    }
  });

  // ---------------------------------------------------------------------------
  // Category Selection Strip (Wide Variety of Categories)
  // ---------------------------------------------------------------------------
  const FULL_CATS = { hentai: null, real: null };
  async function loadFullCategories() {
    const type = currentContentType === 'real' ? 'real' : 'hentai';
    if (FULL_CATS[type]) return FULL_CATS[type];
    try {
      const d = await apiFetch(`/api/adult/categories?type=${type}`);
      if (d.success) FULL_CATS[type] = d.categories;
    } catch { /* fall back to built-in quick picks */ }
    return FULL_CATS[type] || [];
  }

  function openCategoryBrowser() {
    let ov = document.getElementById('cat-browser');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'cat-browser';
      ov.className = 'modal-overlay';
      ov.innerHTML = `<div class="modal-content" style="max-width:900px;width:94%;max-height:88vh;overflow:auto;padding:20px">
        <div style="display:flex;gap:8px;margin-bottom:10px"><input id="cat-q" placeholder="Search all categories..." autocomplete="off" style="flex:1;padding:10px;border-radius:8px;border:1px solid #272938;background:#1f202b;color:#fff"><button id="cat-x" class="btn-stealth" type="button">Close</button></div>
        <div id="cat-body"></div></div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.style.display = 'none'; });
      ov.querySelector('#cat-x').addEventListener('click', () => { ov.style.display = 'none'; });
    }
    ov.style.display = 'flex';
    const body = ov.querySelector('#cat-body');
    const q = ov.querySelector('#cat-q');
    const draw = async () => {
      const all = await loadFullCategories();
      const f = q.value.trim().toLowerCase();
      const groups = new Map();
      all.filter((c) => !f || c.name.toLowerCase().includes(f)).forEach((c) => { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); });
      body.innerHTML = '';
      if (!groups.size) body.textContent = all.length ? 'No matches.' : 'Could not load the full list (offline?). Use the quick picks.';
      groups.forEach((items, g) => {
        const h = document.createElement('div'); h.textContent = `${g} (${items.length})`; h.style.cssText = 'margin:12px 0 6px;font-weight:600;color:#9aa0a6;font-size:13px';
        const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
        items.forEach((c) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = `category-chip ${currentCategoryTag === c.id ? 'active' : ''}`; b.textContent = c.label || c.name;
          b.addEventListener('click', () => { currentCategoryTag = c.id; ov.style.display = 'none'; renderCategoryStrip(); refreshView(); });
          wrap.appendChild(b);
        });
        body.append(h, wrap);
      });
    };
    q.oninput = draw; q.value = ''; draw(); q.focus();
  }

  // Kinks & Fetish panel: built from the server catalog (featured items), grouped, collapsible.
  let kinkPanelOpen = true;
  let kinkPanelEl = null;

  async function renderKinkPanel() {
    if (!categoryStrip) return;
    if (!kinkPanelEl) {
      kinkPanelEl = document.createElement('div');
      kinkPanelEl.id = 'kink-panel';
      kinkPanelEl.className = 'kink-panel';
      categoryStrip.insertAdjacentElement('afterend', kinkPanelEl);
    }
    const typeAtStart = currentContentType;
    const all = await loadFullCategories();
    if (typeAtStart !== currentContentType) return; // user switched tabs while this was loading
    const featured = all.filter((c) => c.featured);
    kinkPanelEl.textContent = '';
    if (!featured.length) { kinkPanelEl.style.display = 'none'; return; }
    kinkPanelEl.style.display = 'flex';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'kink-toggle';
    const body = document.createElement('div');
    body.className = 'kink-body';
    const sync = () => {
      head.textContent = `🔥 Kinks & Fetish (${featured.length}) ${kinkPanelOpen ? '▴' : '▾'}`;
      body.style.display = kinkPanelOpen ? 'flex' : 'none';
    };
    head.addEventListener('click', () => { kinkPanelOpen = !kinkPanelOpen; sync(); });

    const groups = new Map();
    featured.forEach((c) => { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); });
    groups.forEach((items, groupName) => {
      const row = document.createElement('div');
      row.className = 'kink-group';
      const title = document.createElement('span');
      title.className = 'kink-group-title';
      title.textContent = groupName;
      row.appendChild(title);
      items.forEach((c) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `category-chip ${currentCategoryTag === c.id ? 'active' : ''}`;
        chip.textContent = c.label || c.name;
        chip.title = c.name;
        chip.addEventListener('click', () => { currentCategoryTag = c.id; renderCategoryStrip(); refreshView(); });
        row.appendChild(chip);
      });
      body.appendChild(row);
    });
    kinkPanelEl.append(head, body);
    sync();
  }

  function renderCategoryStrip() {
    if (!categoryStrip) return;
    renderKinkPanel().catch(() => {});
    categoryStrip.innerHTML = '';
    const list = [...(currentContentType === 'real' ? REAL_CATEGORIES : HENTAI_CATEGORIES)];
    if (currentCategoryTag !== 'All' && !list.some((c) => c.id === currentCategoryTag)) list.splice(1, 0, { id: currentCategoryTag, name: `📌 ${currentCategoryTag}` });
    const allBtn = document.createElement('button');
    allBtn.className = 'category-chip';
    allBtn.type = 'button';
    allBtn.textContent = '☰ All Categories';
    allBtn.addEventListener('click', openCategoryBrowser);
    categoryStrip.appendChild(allBtn);
    list.forEach(cat => {
      const chip = document.createElement('button');
      chip.className = `category-chip ${currentCategoryTag === cat.id ? 'active' : ''}`;
      chip.type = 'button';
      chip.textContent = cat.name;
      chip.addEventListener('click', () => {
        categoryStrip.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentCategoryTag = cat.id;
        refreshView();
      });
      categoryStrip.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // Content Type Switcher & Filters
  // ---------------------------------------------------------------------------
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      modeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentContentType = btn.dataset.contentType;
      currentCategoryTag = 'All';
      renderCategoryStrip();
      refreshView();
    });
  });

  if (uncensoredCheckbox) {
    uncensoredCheckbox.addEventListener('change', () => {
      uncensoredOnly = uncensoredCheckbox.checked;
      refreshView();
    });
  }

  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentView = tab.dataset.view;
      if (tab.dataset.cat) currentCategory = tab.dataset.cat;
      refreshView();
    });
  });

  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    currentSearch = searchInput.value.trim();
    searchClearBtn.style.display = currentSearch ? 'block' : 'none';
    searchTimeout = setTimeout(() => {
      refreshView();
    }, 400);
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    currentSearch = '';
    searchClearBtn.style.display = 'none';
    refreshView();
  });

  function refreshView() {
    mediaGrid.innerHTML = '';
    emptyState.style.display = 'none';
    currentPage = 1;
    hasNextPage = true;
    isLoadingMore = false;

    if (currentView === 'explore') {
      if (!currentSearch && currentCategoryTag === 'All') {
        homepagePersonalization.style.display = 'block';
        updateCatalogHeading();
        loadPersonalizedShelves();
      } else {
        homepagePersonalization.style.display = 'none';
      }
      loadExploreFeed(true);
    } else if (currentView === 'history') {
      homepagePersonalization.style.display = 'none';
      loadHistoryFeed();
    } else if (currentView === 'bookmarks') {
      homepagePersonalization.style.display = 'none';
      loadBookmarksFeed();
    }
  }

  function updateCatalogHeading() {
    if (currentCategoryTag !== 'All') {
      catalogHeading.textContent = `🎯 Category: ${currentCategoryTag}`;
      return;
    }
    const titles = {
      trending: '🔥 Trending Uncensored Catalog',
      popular: '⭐ Most Popular Catalog',
      top: '🏆 Highest Rated Vault Titles',
      recent: '🆕 Newly Released Releases'
    };
    catalogHeading.textContent = titles[currentCategory] || '🔥 Uncensored Catalog';
  }

  async function loadPersonalizedShelves() {
    // Continue watching row
    try {
      const histData = await apiFetch('/api/vault/history');
      const hist = histData.history || [];
      if (hist.length > 0) {
        shelfContinue.style.display = 'block';
        shelfContinueRow.innerHTML = '';
        hist.slice(0, 10).forEach(item => {
          const card = document.createElement('div');
          card.className = 'shelf-card';
          const title = item.title?.english || item.title?.romaji || item.title || 'Untitled';
          const poster = item.coverImage?.large || item.coverImage?.medium || item.coverImage || '';
          card.innerHTML = `
            <img class="shelf-poster" src="${poster}" alt="${title}" loading="lazy" referrerpolicy="no-referrer">
            <div class="shelf-content">
              <div class="shelf-title" title="${title}">${title}</div>
              <div class="shelf-meta">▶ Ep ${item.episode || 1} • Resume</div>
            </div>
          `;
          card.addEventListener('click', () => openDetailModal(item));
          shelfContinueRow.appendChild(card);
        });
      } else {
        shelfContinue.style.display = 'none';
      }
    } catch (e) {
      shelfContinue.style.display = 'none';
    }

    // Bookmarks shelf
    try {
      const bData = await apiFetch('/api/vault/bookmarks');
      const bmarks = bData.bookmarks || [];
      if (bmarks.length > 0) {
        shelfBookmarks.style.display = 'block';
        shelfBookmarksRow.innerHTML = '';
        bmarks.slice(0, 10).forEach(item => {
          const card = document.createElement('div');
          card.className = 'shelf-card';
          const title = item.title?.english || item.title?.romaji || item.title || 'Untitled';
          const poster = item.coverImage?.large || item.coverImage?.medium || item.coverImage || '';
          card.innerHTML = `
            <img class="shelf-poster" src="${poster}" alt="${title}" loading="lazy" referrerpolicy="no-referrer">
            <div class="shelf-content">
              <div class="shelf-title" title="${title}">${title}</div>
              <div class="shelf-meta">★ ${item.score || 'HD'}</div>
            </div>
          `;
          card.addEventListener('click', () => openDetailModal(item));
          shelfBookmarksRow.appendChild(card);
        });
      } else {
        shelfBookmarks.style.display = 'none';
      }
    } catch (e) {
      shelfBookmarks.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------------------
  // Endless Scrolling & Feed Loading
  // ---------------------------------------------------------------------------
  async function loadExploreFeed(isInitial = false) {
    if (isLoadingMore) return;
    isLoadingMore = true;

    if (isInitial) {
      loadingSpinner.style.display = 'block';
    } else {
      infiniteSpinner.style.display = 'block';
    }

    try {
      const params = new URLSearchParams({
        type: currentContentType,
        category: currentCategory,
        categoryTag: currentCategoryTag,
        search: currentSearch,
        uncensored: uncensoredOnly ? 'true' : 'false',
        page: currentPage
      });

      const data = await apiFetch(`/api/adult/feed?${params.toString()}`);
      loadingSpinner.style.display = 'none';
      infiniteSpinner.style.display = 'none';

      const media = data.media || [];
      if (isInitial && media.length === 0) {
        emptyTitle.textContent = 'No Titles Found';
        emptyDesc.textContent = 'No titles matched your genre or search query.';
        emptyState.style.display = 'block';
        hasNextPage = false;
        isLoadingMore = false;
        return;
      }

      if (media.length === 0) {
        hasNextPage = false;
      } else {
        renderMediaCards(media, !isInitial);
      }
    } catch (err) {
      loadingSpinner.style.display = 'none';
      infiniteSpinner.style.display = 'none';
      console.error(err);
    } finally {
      isLoadingMore = false;
    }
  }

  // IntersectionObserver for seamless infinite scrolling
  const observer = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && !isLoadingMore && hasNextPage && currentView === 'explore') {
      currentPage++;
      loadExploreFeed(false);
    }
  }, {
    rootMargin: '400px'
  });

  if (sentinel) {
    observer.observe(sentinel);
  }

  async function loadHistoryFeed() {
    loadingSpinner.style.display = 'block';
    try {
      const data = await apiFetch('/api/vault/history');
      loadingSpinner.style.display = 'none';
      if (!data.history || data.history.length === 0) {
        emptyTitle.textContent = 'Encrypted History Empty';
        emptyDesc.textContent = 'Your watch activity is encrypted on disk. Titles will appear here as you stream.';
        emptyState.style.display = 'block';
        return;
      }
      renderMediaCards(data.history, false);
    } catch (err) {
      loadingSpinner.style.display = 'none';
    }
  }

  async function loadBookmarks() {
    try {
      const data = await apiFetch('/api/vault/bookmarks');
      activeBookmarks = new Set((data.bookmarks || []).map(b => String(b.id)));
    } catch (e) {}
  }

  async function loadBookmarksFeed() {
    loadingSpinner.style.display = 'block';
    try {
      const data = await apiFetch('/api/vault/bookmarks');
      loadingSpinner.style.display = 'none';
      if (!data.bookmarks || data.bookmarks.length === 0) {
        emptyTitle.textContent = 'No Bookmarks Saved';
        emptyDesc.textContent = 'Add titles to your encrypted bookmark list to access them quickly.';
        emptyState.style.display = 'block';
        return;
      }
      renderMediaCards(data.bookmarks, false);
    } catch (err) {
      loadingSpinner.style.display = 'none';
    }
  }

  function renderMediaCards(items, append = false) {
    if (!append) {
      mediaGrid.innerHTML = '';
    }

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'media-card';

      const title = item.title?.english || item.title?.romaji || item.title || 'Untitled';
      const posterUrl = item.coverImage?.large || item.coverImage?.medium || item.coverImage || '';
      const score = item.averageScore ? `${item.averageScore}%` : (item.score ? `${item.score}%` : 'HD');
      const episodes = item.duration ? item.duration : (item.episodes ? `${item.episodes} Ep` : 'HD Feature');

      card.innerHTML = `
        <img class="card-poster" src="${posterUrl}" alt="${title}" loading="lazy" referrerpolicy="no-referrer">
        <div class="card-content">
          <div class="card-title" title="${title}">${title}</div>
          <div class="card-meta">
            <span class="card-score">★ ${score}</span>
            <span>${episodes}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => openDetailModal(item));
      mediaGrid.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // Detail & Anonymous Streaming Modal
  // ---------------------------------------------------------------------------
  function openDetailModal(anime) {
    activeAnime = anime;
    closePlayer();

    const title = anime.title?.english || anime.title?.romaji || anime.title || 'Untitled';
    const posterUrl = anime.coverImage?.large || anime.coverImage?.medium || anime.coverImage || '';

    detailTitle.textContent = title;
    detailPoster.src = posterUrl;
    detailScore.textContent = anime.averageScore ? `${anime.averageScore}%` : 'HD';
    detailEpisodes.textContent = anime.duration ? anime.duration : (anime.episodes || '1');
    detailSynopsis.textContent = anime.description ? anime.description.replace(/<[^>]*>?/gm, '') : (anime.isReal ? 'Verified high-definition uncensored live feature.' : 'Uncensored high-definition streaming release.');

    if (uncensoredBadge) {
      uncensoredBadge.style.display = 'inline-block';
    }

    // Genres
    detailGenres.innerHTML = '';
    (anime.genres || []).forEach((g) => {
      const tag = document.createElement('span');
      tag.className = 'genre-tag';
      tag.textContent = g;
      detailGenres.appendChild(tag);
    });

    updateBookmarkBtn(String(anime.id));

    // Streaming Mirrors: fetch verified playable streams from backend probe
    streamButtonsContainer.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 12px; color: var(--text-muted); font-size: 12px;">⚡ Probing verified playable mirrors...</div>';
    
    apiFetch(`/api/adult/stream-info?id=${encodeURIComponent(anime.id)}&ep=1`)
      .then((info) => {
        streamButtonsContainer.innerHTML = '';
        const mirrors = info.streams?.inAppMirrors || [];
        if (mirrors.length === 0) {
          streamButtonsContainer.innerHTML = '<div style="grid-column: 1/-1; padding: 12px; color: var(--danger); font-size: 13px;">⚠️ No verified playable mirrors currently online for this title.</div>';
          return;
        }

        mirrors.forEach((m) => {
          if (m.isEmbed) {
            const btn = document.createElement('button');
            btn.className = 'btn-stream-mirror';
            btn.type = 'button';
            btn.innerHTML = `
              <span class="mirror-title">▶ ${m.name}</span>
              <span class="mirror-desc">${m.description}</span>
            `;
            btn.addEventListener('click', () => {
              playInApp(m.url, m.name);
              recordHistory(anime);
            });
            streamButtonsContainer.appendChild(btn);
          } else {
            const btn = document.createElement('a');
            btn.className = 'btn-stream-mirror';
            btn.href = m.url;
            btn.target = '_blank';
            btn.rel = 'noreferrer noopener';
            btn.innerHTML = `
              <span class="mirror-title">▶ ${m.name}</span>
              <span class="mirror-desc">${m.description}</span>
            `;
            btn.addEventListener('click', () => {
              recordHistory(anime);
            });
            streamButtonsContainer.appendChild(btn);
          }
        });
      })
      .catch((err) => {
        streamButtonsContainer.innerHTML = '<div style="grid-column: 1/-1; padding: 12px; color: var(--danger); font-size: 13px;">Failed to verify stream mirrors.</div>';
      });

    detailModal.style.display = 'flex';
  }

  function playInApp(url, name) {
    if (inappPlayerFrame && inappPlayerContainer) {
      inappPlayerFrame.src = url;
      inappPlayerContainer.style.display = 'block';
      const playerTitle = document.getElementById('player-title');
      if (playerTitle) playerTitle.textContent = name;
      inappPlayerContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function closePlayer() {
    if (inappPlayerFrame && inappPlayerContainer) {
      inappPlayerFrame.src = '';
      inappPlayerContainer.style.display = 'none';
    }
  }

  if (closePlayerBtn) {
    closePlayerBtn.addEventListener('click', closePlayer);
  }

  function updateBookmarkBtn(id) {
    if (activeBookmarks.has(String(id))) {
      bookmarkToggleBtn.textContent = '❤️ Bookmarked';
      bookmarkToggleBtn.className = 'btn-secondary active';
    } else {
      bookmarkToggleBtn.textContent = '🤍 Bookmark';
      bookmarkToggleBtn.className = 'btn-secondary';
    }
  }

  bookmarkToggleBtn.addEventListener('click', async () => {
    if (!activeAnime) return;
    const id = String(activeAnime.id);
    if (activeBookmarks.has(id)) {
      await apiFetch(`/api/vault/bookmarks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      activeBookmarks.delete(id);
    } else {
      await apiFetch('/api/vault/bookmarks', {
        method: 'POST',
        body: JSON.stringify({
          id,
          title: activeAnime.title?.english || activeAnime.title?.romaji || activeAnime.title,
          coverImage: activeAnime.coverImage?.large || activeAnime.coverImage?.medium || activeAnime.coverImage,
          score: activeAnime.averageScore,
          isReal: !!activeAnime.isReal
        })
      });
      activeBookmarks.add(id);
    }
    updateBookmarkBtn(id);
  });

  async function recordHistory(anime) {
    try {
      await apiFetch('/api/vault/history', {
        method: 'POST',
        body: JSON.stringify({
          id: anime.id,
          title: anime.title?.english || anime.title?.romaji || anime.title,
          coverImage: anime.coverImage?.large || anime.coverImage?.medium || anime.coverImage,
          episode: 1,
          isReal: !!anime.isReal
        })
      });
    } catch (e) {}
  }

  detailCloseBtn.addEventListener('click', () => {
    detailModal.style.display = 'none';
    closePlayer();
  });

  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) {
      detailModal.style.display = 'none';
      closePlayer();
    }
  });

  // Start initialization
  checkVaultStatus();
})();
