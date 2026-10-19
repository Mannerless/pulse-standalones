import http from 'node:http';
import { installConsoleCapture, addLine, getLines, clearLines } from './console-capture.mjs';
installConsoleCapture();
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, execSync, spawn, execFileSync } from 'node:child_process';
import {
  startDownload,
  getDownloadStatus,
  handleAction,
  getLibraryList,
  purgeWatchedCache,
  streamVideoFile,
  streamSubtitleFile,
  cleanupOrphanedParts,
} from './download-manager.mjs';
import { listCategories, listDir, openFile, watchKeyForFile } from './file-tree.mjs';
import { scanUnlabeled, applyRenames } from './episode-identify.mjs';
import { startMediaDownload, listJobs, mediaAction, streamMediaFile, checkTools, getMediaDir } from './media-downloader.mjs';
import { LIVE_GENRES, liveFeed, liveSearch, liveDetails, prewarmLiveCatalog } from './live-catalog.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '7888', 10);
const PUBLIC_PORT = parseInt(process.env.ANIMEPULSE_PUBLIC_PORT || String(PORT + 1), 10); // tunnel-only listener; owner tools are blocked on it
// SHARING IS OFF BY DEFAULT: loopback only, no public tunnel. Opt in explicitly:
//   ANIMEPULSE_SHARE=1 -> public tunnel + LAN reachable (0.0.0.0)
const SHARE_ON = process.env.ANIMEPULSE_SHARE === '1';
const HOST = process.env.ANIMEPULSE_HOST || (SHARE_ON ? '0.0.0.0' : '127.0.0.1');
const TUNNEL_ENABLED = SHARE_ON && process.env.ANIMEPULSE_TUNNEL !== '0';
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const PLAYBACK_FILE = path.join(DATA_DIR, 'playback.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const REMOTE_ACCESS_FILE = path.join(DATA_DIR, 'remote_access.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache for AniList queries (15 min TTL)
const cache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

const CHROME_HISTORY_PATHS = [
  path.join(process.env.HOME || '/home/dev', '.config/google-chrome-animepulse/Default/History'),
  path.join(process.env.HOME || '/home/dev', '.config/google-chrome/Default/History'),
  path.join(process.env.HOME || '/home/dev', '.config/google-chrome-stream/Default/History'),
  path.join(process.env.HOME || '/home/dev', '.config/google-chrome-vaultpulse/Default/History'),
];

let lastBrowserSyncTime = 0;
const BROWSER_SYNC_COOLDOWN_MS = 3000; // at most once every 3s

function extractAnimeProgress(url, pageTitle) {
  let anilistId = null;
  let episode = null;

  const idMatch = url.match(/(?:[?&](?:id|anilist|video_id)=|\/(?:watch|anime|embed\/anime)\/)(\d{4,8})/i);
  if (idMatch) {
    anilistId = parseInt(idMatch[1], 10);
  }

  const epMatch = url.match(/(?:[?&](?:ep|episode|e)=|\/(?:embed\/anime|anime)\/\d+\/|-episode-)(\d{1,4})(?:[^\d]|$)/i);
  if (epMatch) {
    episode = parseInt(epMatch[1], 10);
  }

  let cleanTitle = '';
  if (pageTitle) {
    cleanTitle = pageTitle
      .replace(/^(?:Watch\s+)/i, '')
      .replace(/\s*[-|·•]\s*(?:Miruro|HiAnime|Crunchyroll|Netflix|GogoAnime|Zoro|Google Chrome).*$/i, '')
      .trim();
  }

  return { anilistId, episode, url, cleanTitle };
}

// Read raw history safely
function getHistoryRaw() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading history:', err);
    return [];
  }
}

// Save history safely
// Playback positions: resume where you left off, per anime + episode. Newest 500 kept.
function playbackKey(animeId, episode) {
  const a = String(animeId ?? '').trim();
  const e = parseInt(episode, 10);
  if (!/^\d{1,9}$/.test(a) || !Number.isFinite(e) || e < 1 || e > 5000) return null;
  return `${a}_${e}`;
}
function loadPlayback() {
  try { return JSON.parse(fs.readFileSync(PLAYBACK_FILE, 'utf8')) || {}; } catch { return {}; }
}
function savePlayback(all) {
  const tmp = `${PLAYBACK_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all));
  fs.renameSync(tmp, PLAYBACK_FILE);
}

// ---- Watch status: persistent per-episode state (unlike playback.json, which forgets an episode once it is finished) ----
const WATCH_FILE = path.join(DATA_DIR, 'watch-status.json');
function loadWatch() { try { return JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')) || {}; } catch { return {}; } }
function saveWatch(all) {
  const keys = Object.keys(all);
  if (keys.length > 4000) keys.sort((a, b) => String(all[a].updatedAt).localeCompare(String(all[b].updatedAt))).slice(0, keys.length - 4000).forEach((k) => { delete all[k]; });
  const tmp = `${WATCH_FILE}.tmp`; fs.writeFileSync(tmp, JSON.stringify(all)); fs.renameSync(tmp, WATCH_FILE);
}
// Turn a progress sample into a state. Completed is sticky: re-watching part of it later does not erase it.
function recordWatch(key, position, duration) {
  const pos = Number(position) || 0, dur = Number(duration) || 0;
  if (!key || pos < 0) return null;
  const all = loadWatch(), prev = all[key], now = new Date().toISOString();
  const pct = dur > 0 ? Math.min(1, pos / dur) : 0;
  const done = dur > 0 && (pct >= 0.9 || (dur - pos <= 90 && pct >= 0.5));      // 90% through, or only the credits are left
  let entry = null;
  if (done) entry = { state: 'completed', pct: 1, position: Math.round(pos), duration: Math.round(dur), updatedAt: now };
  else if (pos >= 10 && !(prev && prev.state === 'completed')) entry = { state: 'partial', pct: Math.round(pct * 1000) / 1000, position: Math.round(pos * 10) / 10, duration: Math.round(dur), updatedAt: now };
  if (!entry) return prev || null;
  all[key] = entry; saveWatch(all); return entry;
}
function markWatch(key, state) {
  const all = loadWatch();
  if (state === 'completed') all[key] = { state: 'completed', pct: 1, manual: true, updatedAt: new Date().toISOString() };
  else if (/^\d+_\d+$/.test(key)) all[key] = { state: 'unwatched', manual: true, updatedAt: new Date().toISOString() };   // episode keys: explicit override beats the "earlier than last watched" inference
  else delete all[key];
  saveWatch(all); return all[key] && all[key].state !== 'unwatched' ? all[key] : null;
}

function saveHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, 100), null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving history:', err);
    return false;
  }
}

// Sync watch history against active and recent browser streaming visits
function syncHistoryWithBrowser(force = false) {
  const now = Date.now();
  if (!force && now - lastBrowserSyncTime < BROWSER_SYNC_COOLDOWN_MS) {
    return getHistoryRaw();
  }
  lastBrowserSyncTime = now;

  let history = getHistoryRaw();
  const allVisits = [];

  for (const hp of CHROME_HISTORY_PATHS) {
    if (!fs.existsSync(hp)) continue;
    try {
      const stdout = execFileSync('sqlite3', [
        `file:${hp}?immutable=1`,
        `SELECT url, title, datetime(last_visit_time/1000000-11644473600, 'unixepoch', 'localtime') FROM urls WHERE (url LIKE '%miruro%' OR url LIKE '%vidsrc%' OR url LIKE '%2embed%' OR url LIKE '%multiembed%' OR url LIKE '%hianime%' OR url LIKE '%videasy%' OR url LIKE '%gogoanime%' OR url LIKE '%animepahe%') ORDER BY last_visit_time ASC;`
      ], { encoding: 'utf8', timeout: 4000 });

      for (const line of stdout.trim().split('\n')) {
        if (!line.trim()) continue;
        const [u, t, ts] = line.split('|');
        if (!u) continue;
        const prog = extractAnimeProgress(u, t);
        if (prog.anilistId || prog.episode) {
          allVisits.push({ ...prog, ts: ts || new Date().toISOString() });
        }
      }
    } catch {
      // Chrome history locked or missing table; skip gracefully
    }
  }

  if (allVisits.length === 0) return history;

  let hasChanges = false;
  for (const item of history) {
    const matches = allVisits.filter((v) => {
      if (v.anilistId && item.id && Number(v.anilistId) === Number(item.id)) return true;
      if (v.cleanTitle && item.title && v.cleanTitle.toLowerCase().includes(item.title.toLowerCase())) return true;
      return false;
    });

    if (matches.length > 0) {
      const highestEp = Math.max(...matches.map((m) => m.episode || 1));
      const latestVisit = matches[matches.length - 1];
      if (highestEp > (item.lastEpisodeWatched || 1)) {
        item.lastEpisodeWatched = highestEp;
        item.streamUrl = latestVisit.url;
        item.lastWatchedAt = new Date().toISOString();
        if (item.totalEpisodes && item.lastEpisodeWatched >= item.totalEpisodes) {
          item.status = 'Completed';
        } else if (item.status !== 'Completed') {
          item.status = 'Watching';
        }
        hasChanges = true;
      }
    }
  }

  if (hasChanges) {
    saveHistory(history);
    console.log('[AnimePulse] Watch history auto-synced with browser activity.');
  }

  return history;
}

// Read history with auto-browser sync
function getHistory(syncBrowser = true) {
  if (syncBrowser) {
    return syncHistoryWithBrowser();
  }
  return getHistoryRaw();
}

// Background sync every 30 seconds
setInterval(() => {
  try {
    syncHistoryWithBrowser();
  } catch (e) {
    console.error('Background history sync error:', e);
  }
}, 30000);

// Stats & Remote Viewers Tracking
function getStats() {
  if (!fs.existsSync(STATS_FILE)) {
    return {
      outsideViews: 0,
      totalViews: 0,
      uniqueIps: [],
      streamsLaunched: 0,
      activeTunnelUrl: '',
      lastVisitedAt: null,
    };
  }
  try {
    const raw = fs.readFileSync(STATS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      outsideViews: typeof parsed.outsideViews === 'number' ? parsed.outsideViews : 0,
      totalViews: typeof parsed.totalViews === 'number' ? parsed.totalViews : 0,
      uniqueIps: Array.isArray(parsed.uniqueIps) ? parsed.uniqueIps : [],
      streamsLaunched: typeof parsed.streamsLaunched === 'number' ? parsed.streamsLaunched : 0,
      activeTunnelUrl: typeof parsed.activeTunnelUrl === 'string' ? parsed.activeTunnelUrl : '',
      lastVisitedAt: parsed.lastVisitedAt || null,
    };
  } catch (err) {
    console.error('Error reading stats:', err);
    return { outsideViews: 0, totalViews: 0, uniqueIps: [], streamsLaunched: 0, activeTunnelUrl: '', lastVisitedAt: null };
  }
}

let stats = getStats();
let saveStatsTimeout = null;

function saveStats(s) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving stats:', err);
  }
}

function debouncedSaveStats() {
  if (saveStatsTimeout) return;
  saveStatsTimeout = setTimeout(() => {
    saveStatsTimeout = null;
    saveStats(stats);
  }, 1000);
}

// Remote Access Tunnel Management (HTTPS Port 443 Tunnel)
let tunnelProcess = null;
let activeTunnelUrl = stats.activeTunnelUrl || '';

function startTunnel() {
  stopTunnel();
  console.log(`[AnimePulse Tunnel] Establishing robust remote family sharing tunnel on port ${PORT}...`);

  const args = [
    '-p', '443',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-R0:127.0.0.1:' + PUBLIC_PORT,
    'a.pinggy.io'
  ];

  try {
    tunnelProcess = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const parseOutput = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.free\.pinggy\.net/) ||
                    text.match(/https:\/\/[a-zA-Z0-9.-]+\.pinggy-free\.link/);
      if (match) {
        activeTunnelUrl = match[0];
        stats.activeTunnelUrl = activeTunnelUrl;
        saveStats(stats);
        try {
          fs.writeFileSync(
            REMOTE_ACCESS_FILE,
            JSON.stringify({ remoteUrl: activeTunnelUrl, updated: new Date().toISOString() }, null, 2),
            'utf8'
          );
        } catch {}
        console.log(`[AnimePulse Tunnel] Verified live remote URL: ${activeTunnelUrl}`);
      }
    };

    tunnelProcess.stdout.on('data', parseOutput);
    tunnelProcess.stderr.on('data', parseOutput);

    tunnelProcess.on('exit', (code, signal) => {
      console.log(`[AnimePulse Tunnel] Process exited (code=${code}, signal=${signal}). Reconnecting in 5s...`);
      tunnelProcess = null;
      setTimeout(startTunnel, 5000);
    });

    tunnelProcess.on('error', (err) => {
      console.error('[AnimePulse Tunnel] Error:', err);
    });
  } catch (err) {
    console.error('[AnimePulse Tunnel] Failed to start tunnel:', err);
    setTimeout(startTunnel, 10000);
  }
}

function stopTunnel() {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill('SIGTERM');
    } catch {}
    tunnelProcess = null;
  }
}

process.on('SIGINT', () => {
  stopTunnel();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopTunnel();
  process.exit(0);
});

// Display & Monitor Detection for Desktop Window Pinning
function getMonitors() {
  try {
    const raw = execSync('DISPLAY=:0 xrandr --query 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
    const lines = raw.split('\n');
    const monitors = [];
    const regex = /^(\S+)\s+(connected(?:\s+primary)?)\s+(?:(\d+)x(\d+)\+(\d+)\+(\d+))/;
    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        const id = match[1];
        const status = match[2];
        const width = parseInt(match[3], 10);
        const height = parseInt(match[4], 10);
        const x = parseInt(match[5], 10);
        const y = parseInt(match[6], 10);
        const isPrimary = status.includes('primary');
        const isLaptop = /^eDP|LVDS/i.test(id);
        const name = isLaptop
          ? `💻 Laptop Screen (${id} • ${width}x${height})`
          : (isPrimary
            ? `🖥️ Main External Display (${id} • ${width}x${height})`
            : `🖥️ Display (${id} • ${width}x${height})`);
        monitors.push({ id, name, width, height, x, y, isPrimary, isLaptop });
      }
    }
    return monitors;
  } catch (err) {
    console.error('[AnimePulse Monitors] Failed to query xrandr:', err.message);
    return [];
  }
}

function pinWindowToDisplay(monitorId, mode = 'full', side = 'left') {
  const monitors = getMonitors();
  if (monitors.length === 0) {
    return { success: false, error: 'No physical X11 monitors detected' };
  }

  const target = monitors.find((m) => m.id === monitorId) || monitors[0];
  let targetX = target.x;
  let targetY = target.y;
  let targetW = target.width;
  let targetH = Math.max(400, target.height - 35); // Keep MATE panel visible

  if (mode === 'full') {
    targetX = target.x;
    targetY = target.y;
    targetW = target.width;
    targetH = Math.max(400, target.height - 35);
  } else if (mode === 'partial' || mode === 'half') {
    targetW = Math.round(target.width / 2);
    targetH = Math.max(400, target.height - 35);
    targetX = side === 'right' ? target.x + targetW : target.x;
    targetY = target.y;
  } else if (mode === 'pip' || mode === 'compact') {
    targetW = Math.min(880, Math.round(target.width * 0.55));
    targetH = Math.min(640, Math.round(target.height * 0.65));
    targetX = side === 'right' ? (target.x + target.width - targetW - 20) : (target.x + 20);
    targetY = target.y + 40;
  }

  try {
    let winId = '';
    try {
      winId = execSync('DISPLAY=:0 xdotool search --name "AnimePulse" 2>/dev/null | tail -n 1', { encoding: 'utf8' }).trim();
    } catch {}

    if (winId) {
      execSync(`DISPLAY=:0 wmctrl -i -r ${winId} -b remove,maximized_vert,maximized_horz,fullscreen 2>/dev/null`, { stdio: 'ignore' });
      execSync(`DISPLAY=:0 wmctrl -i -r ${winId} -e 0,${targetX},${targetY},${targetW},${targetH} 2>/dev/null`, { stdio: 'ignore' });
      execSync(`DISPLAY=:0 xdotool windowactivate ${winId} 2>/dev/null`, { stdio: 'ignore' });
    } else {
      execSync('DISPLAY=:0 wmctrl -r "AnimePulse" -b remove,maximized_vert,maximized_horz,fullscreen 2>/dev/null', { stdio: 'ignore' });
      execSync(`DISPLAY=:0 wmctrl -r "AnimePulse" -e 0,${targetX},${targetY},${targetW},${targetH} 2>/dev/null`, { stdio: 'ignore' });
    }

    return {
      success: true,
      monitor: target.name,
      geometry: { x: targetX, y: targetY, width: targetW, height: targetH },
      mode,
      side,
    };
  } catch (err) {
    console.error('[AnimePulse Monitors] Failed to reposition window:', err.message);
    return { success: false, error: err.message };
  }
}

// Compute availability index for an anime title and optional episode
function computeAvailabilityIndex(anime, episodeNumber = 1) {
  const title = anime.title?.english || anime.title?.romaji || 'Anime';
  const cleanTitle = title.replace(/[^\w\s-]/g, '').trim();
  const epSuffix = episodeNumber && episodeNumber > 1 ? ` episode ${episodeNumber}` : '';
  const encodedTitle = encodeURIComponent(`${cleanTitle}${epSuffix}`);

  // Discover official links
  const officialStream = (anime.externalLinks || []).find(
    (l) => l.type === 'STREAMING' || ['Crunchyroll', 'Netflix', 'Hulu', 'HIDIVE'].includes(l.site)
  );

  // Dub availability heuristic: English title exists, popular, or licensed
  const isDubLikely = (anime.popularity > 25000) ||
    (['FINISHED', 'RELEASING'].includes(anime.status) && (anime.averageScore >= 70));

  return {
    selectedEpisode: episodeNumber,
    sub: {
      available: true,
      quality: '1080p / 720p',
      source: 'Multi-Server Fast Streams (Subbed)',
    },
    dub: {
      available: isDubLikely,
      status: isDubLikely ? 'Available / In-Simulcast' : 'Sub-Only or Pending Dub',
      source: isDubLikely ? 'Free Multi-Audio Dub' : 'N/A',
    },
    servers: [
      // -------------------------------------------------------------
      // In-App Embeddable HD Theater Players (Direct Iframe Playback)
      // -------------------------------------------------------------
      {
        name: 'VidSrc Me (In-App HD)',
        tag: 'Fast Direct',
        url: `https://vidsrc.me/embed/anime?anilist=${anime.id}&episode=${episodeNumber}`,
        embeddable: true,
        primary: true,
      },
      {
        name: 'VidSrc PM (In-App Player)',
        tag: 'Native In-App',
        url: `https://vidsrc.pm/embed/anime/${anime.id}/${episodeNumber}`,
        embeddable: true,
        primary: false,
      },
      {
        name: 'MultiEmbed (Multi-Source)',
        tag: 'Global Stream',
        url: `https://multiembed.mov/?video_id=${anime.id}&anilist=1&s=1&e=${episodeNumber}`,
        embeddable: true,
        primary: false,
      },
      {
        name: 'VidSrc SU (In-App Ultra)',
        tag: 'Fast In-App',
        url: `https://vidsrc.su/embed/anime/${anime.id}/${episodeNumber}`,
        embeddable: true,
        primary: false,
      },
      {
        name: '2Embed CC (Multi-Server)',
        tag: 'Backup In-App',
        url: `https://www.2embed.cc/embed/anime/${anime.id}/${episodeNumber}`,
        embeddable: true,
        primary: false,
      },
      // -------------------------------------------------------------
      // External Fast Browser Mirrors (Full Screen External Popouts)
      // -------------------------------------------------------------
      {
        name: 'GogoAnime (Sub & Dub Search)',
        tag: 'Full Catalog',
        url: `https://gogoanime3.co/search.html?keyword=${encodedTitle}`,
        embeddable: false,
        primary: false,
      },
      {
        name: 'YugenAnime (Fast 1080p Mirror)',
        tag: 'HD Mirror',
        url: `https://yugenanime.tv/discover/?q=${encodedTitle}`,
        embeddable: false,
        primary: false,
      },
      {
        name: 'AnimePahe (Direct Ep Mirror)',
        tag: 'Fast Stream',
        url: `https://animepahe.ru`,
        embeddable: false,
        primary: false,
      },
      {
        name: 'AnimePahe (Compact HD)',
        tag: 'Lightweight',
        url: `https://animepahe.su/anime?q=${encodeURIComponent(cleanTitle)}`,
        embeddable: false,
        primary: false,
      },
      {
        name: 'AllManga (Catalog Mirror)',
        tag: 'Multi-Source',
        url: `https://allmanga.to/search?keyword=${encodedTitle}`,
        embeddable: false,
        primary: false,
      },
      ...(officialStream ? [{
        name: `${officialStream.site} (Official Paid)`,
        tag: 'Paid / Trial',
        url: officialStream.url,
        embeddable: false,
        primary: false,
      }] : []),
    ],
  };
}

// One POST to AniList. Transient network failures (connect timeouts, resets, DNS
// hiccups) are retried with backoff so a brief drop doesn't surface as a 500.
const ANILIST_NET_RETRIES = 2;
const ANILIST_TIMEOUT_MS = 20000;
const RETRYABLE_NET_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED']);

async function fetchAniListOnce(query, variables) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'AnimePulse/1.0',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(ANILIST_TIMEOUT_MS),
      });
    } catch (err) {
      const code = err?.cause?.code || err?.code;
      const retryable = err?.name === 'TimeoutError' || RETRYABLE_NET_CODES.has(code);
      if (!retryable || attempt >= ANILIST_NET_RETRIES) throw err;
      const waitMs = 1000 * (attempt + 1);
      console.warn(`[AnimePulse] AniList network error (${code || err.name}); retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${ANILIST_NET_RETRIES})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// AniList GraphQL Fetcher with caching
async function fetchAniList(query, variables = {}) {
  const cacheKey = JSON.stringify({ query, variables });
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // AniList rate-limits (HTTP 429 + Retry-After). Wait it out and retry instead of surfacing a 500.
  const MAX_RATE_LIMIT_RETRIES = 3;
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetchAniListOnce(query, variables);
    if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) break;
    const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
    const waitMs = Math.min(30000, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5 * (attempt + 1)) * 1000);
    await res.text().catch(() => {});
    console.warn(`[AnimePulse] AniList rate limit hit; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`AniList HTTP ${res.status}: ${errorText.slice(0, 100)}`);
  }

  const data = await res.json();
  if (data.errors && data.errors.length > 0) {
    throw new Error(data.errors[0].message || 'AniList GraphQL error');
  }

  // Never cache an empty page for a non-search feed: a transient empty AniList reply
  // would otherwise pin a blank list for the full TTL.
  const mediaList = data?.data?.Page?.media;
  const isEmptyPage = Array.isArray(mediaList) && mediaList.length === 0;
  if (!isEmptyPage) {
    cache.set(cacheKey, { data, timestamp: Date.now() });
  }
  return data;
}

const MEDIA_QUERY = `
query ($page: Int, $perPage: Int, $sort: [MediaSort], $status: MediaStatus, $search: String, $genre: String) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      total
      currentPage
      hasNextPage
    }
    media(sort: $sort, type: ANIME, status: $status, search: $search, genre: $genre) {
      id
      title {
        english
        romaji
        native
      }
      coverImage {
        extraLarge
        large
        color
      }
      bannerImage
      description
      episodes
      nextAiringEpisode {
        episode
        airingAt
        timeUntilAiring
      }
      averageScore
      popularity
      format
      status
      season
      seasonYear
      genres
      studios(isMain: true) {
        nodes {
          name
        }
      }
      trailer {
        id
        site
      }
      externalLinks {
        site
        url
        type
      }
    }
  }
}
`;

// -----------------------------------------------------------------------------
// Franchise chain: walk PREQUEL / SEQUEL links both ways so any later season can
// reach the original in one step. AniList only exposes direct relations, so each
// hop is one (cached) query. Failures never break the details modal.
// -----------------------------------------------------------------------------
const FRANCHISE_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { english romaji }
    format
    status
    episodes
    seasonYear
    averageScore
    coverImage { medium large }
    startDate { year month day }
    relations {
      edges {
        relationType
        node { id type format startDate { year month day } }
      }
    }
  }
}
`;
const CHAIN_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA', 'MOVIE']);
const FRANCHISE_MAX_HOPS = 15;
const FRANCHISE_TTL_MS = 30 * 60 * 1000;
const FRANCHISE_CACHE = new Map(); // id -> { at, data }
const dateKey = (d) => (d && d.year ? d.year * 10000 + (d.month || 1) * 100 + (d.day || 1) : null);

async function fetchFranchiseNode(id) {
  const raw = await fetchAniList(FRANCHISE_QUERY, { id });
  return raw.data?.Media || null;
}

async function walkFranchise(start, relationType) {
  const out = [];
  const seen = new Set([start.id]);
  let cur = start;
  for (let hop = 0; hop < FRANCHISE_MAX_HOPS; hop++) {
    const cands = (cur.relations?.edges || []).filter(
      (e) => e.relationType === relationType && e.node && e.node.type === 'ANIME'
        && CHAIN_FORMATS.has(e.node.format) && !seen.has(e.node.id)
    );
    if (cands.length === 0) break;
    // Several links of the same kind: prefer the closest release date; unknown dates rank last.
    const sorted = cands.slice().sort((a, b) => (relationType === 'PREQUEL'
      ? (dateKey(b.node.startDate) ?? -1) - (dateKey(a.node.startDate) ?? -1)
      : (dateKey(a.node.startDate) ?? Infinity) - (dateKey(b.node.startDate) ?? Infinity)));
    const node = await fetchFranchiseNode(sorted[0].node.id);
    if (!node) break;
    seen.add(node.id);
    out.push(node);
    cur = node;
  }
  return out;
}

async function buildFranchise(id) {
  const hit = FRANCHISE_CACHE.get(id);
  if (hit && Date.now() - hit.at < FRANCHISE_TTL_MS) return hit.data;
  const start = await fetchFranchiseNode(id);
  if (!start) return null;
  const [prequels, sequels] = await Promise.all([
    walkFranchise(start, 'PREQUEL'),
    walkFranchise(start, 'SEQUEL'),
  ]);
  const chain = [...prequels.reverse(), start, ...sequels];
  const items = chain.map((m, i) => ({
    id: m.id,
    title: m.title?.english || m.title?.romaji || 'Untitled',
    format: m.format,
    status: m.status,
    episodes: m.episodes,
    seasonYear: m.seasonYear || m.startDate?.year || null,
    score: m.averageScore,
    coverImage: m.coverImage?.medium || m.coverImage?.large || '',
    position: i + 1,
    current: m.id === id,
  }));
  // "Original" = first real series entry (TV/ONA); a prequel movie or short can sit ahead of it in the chain.
  const root = items.find((x) => ['TV', 'TV_SHORT', 'ONA'].includes(x.format)) || items[0];
  const data = {
    items,
    total: items.length,
    rootId: root.id,
    currentPosition: items.findIndex((x) => x.current) + 1,
  };
  FRANCHISE_CACHE.set(id, { at: Date.now(), data });
  return data;
}

const DETAIL_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title {
      english
      romaji
      native
    }
    coverImage {
      extraLarge
      large
      color
    }
    bannerImage
    description
    episodes
    nextAiringEpisode {
      episode
      airingAt
      timeUntilAiring
    }
    averageScore
    popularity
    format
    status
    season
    seasonYear
    genres
    studios(isMain: true) {
      nodes {
        name
      }
    }
    relations {
      edges {
        relationType
        node {
          id
          title {
            english
            romaji
          }
          format
          status
          episodes
          coverImage {
            medium
            large
          }
          averageScore
          seasonYear
        }
      }
    }
    trailer {
      id
      site
    }
    externalLinks {
      site
      url
      type
    }
  }
}
`;

// Request handler
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const sendJson = (statusCode, obj) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  const sendError = (statusCode, message) => {
    sendJson(statusCode, { success: false, error: message });
  };

  // -------------------------------------------------------------------------
  // Outside Viewers & Metrics Interceptor
  // -------------------------------------------------------------------------
  const isLoopback = (ip) => !ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.');
  const forwarded = req.headers['x-forwarded-for'];
  const cfIp = req.headers['cf-connecting-ip'];
  const clientIp = cfIp || (forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress);
  const isOutside = !isLoopback(clientIp);

  if (pathname === '/' || pathname === '/index.html' || pathname === '/api/feed') {
    stats.totalViews++;
    stats.lastVisitedAt = new Date().toISOString();
    if (isOutside) {
      stats.outsideViews++;
      if (!stats.uniqueIps.includes(clientIp)) {
        stats.uniqueIps.push(clientIp);
      }
    }
    debouncedSaveStats();
  }

  try {
    // -----------------------------------------------------------------------
    // API: GET /api/stats
    // -----------------------------------------------------------------------
    if (pathname === '/api/stats' && req.method === 'GET') {
      sendJson(200, {
        success: true,
        outsideViews: stats.outsideViews,
        totalViews: stats.totalViews,
        uniqueVisitors: stats.uniqueIps.length,
        streamsLaunched: stats.streamsLaunched,
        remoteUrl: activeTunnelUrl || stats.activeTunnelUrl || '',
      });
      return;
    }

    // -----------------------------------------------------------------------
    // API: POST /api/stats/stream
    // -----------------------------------------------------------------------
    if (pathname === '/api/stats/stream' && req.method === 'POST') {
      stats.streamsLaunched++;
      debouncedSaveStats();
      sendJson(200, { success: true, streamsLaunched: stats.streamsLaunched });
      return;
    }

    // -----------------------------------------------------------------------
    // API: GET /api/monitors
    // -----------------------------------------------------------------------
    if (pathname === '/api/monitors' && req.method === 'GET') {
      const monitors = getMonitors();
      sendJson(200, { success: true, monitors });
      return;
    }

    // -----------------------------------------------------------------------
    // API: POST /api/pin-display
    // -----------------------------------------------------------------------
    if (pathname === '/api/pin-display' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let payload = {};
      try { payload = JSON.parse(body); } catch {}
      const monitorId = payload.monitorId;
      const mode = payload.mode || 'full';
      const side = payload.side || 'left';
      const result = pinWindowToDisplay(monitorId, mode, side);
      sendJson(result.success ? 200 : 500, result);
      return;
    }

    // -----------------------------------------------------------------------
    // API: GET /api/feed
    // -----------------------------------------------------------------------
    if (pathname === '/api/feed' && req.method === 'GET') {
      const mode = parsedUrl.searchParams.get('mode') || 'trending';
      const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
      const genre = parsedUrl.searchParams.get('genre') || undefined;

      // POPULARITY_DESC tiebreaker: AniList intermittently returns an empty page
      // for a bare TRENDING_DESC sort, but serves the compound sort reliably.
      let sort = ['TRENDING_DESC', 'POPULARITY_DESC'];
      let status = undefined;

      if (mode === 'popular') {
        sort = ['POPULARITY_DESC'];
      } else if (mode === 'airing') {
        sort = ['POPULARITY_DESC'];
        status = 'RELEASING';
      } else if (mode === 'top') {
        sort = ['SCORE_DESC'];
      }

      const feedGenre = genre && genre !== 'All' ? genre : undefined;
      let rawMedia;
      let pageInfo;

      if (mode === 'popular') {
        // Most Popular is capped at the top 100, served as 4 pages of 25 (ranks 1-100).
        const POPULAR_LIMIT = 100;
        const POPULAR_PAGE_SIZE = 25;
        const lastPage = Math.ceil(POPULAR_LIMIT / POPULAR_PAGE_SIZE);
        const popularPage = Math.min(Math.max(Number.isFinite(page) ? page : 1, 1), lastPage);
        const raw = await fetchAniList(MEDIA_QUERY, {
          page: popularPage,
          perPage: POPULAR_PAGE_SIZE,
          sort,
          status,
          genre: feedGenre,
        });
        rawMedia = raw.data?.Page?.media || [];
        const aniTotal = raw.data?.Page?.pageInfo?.total || 0;
        const total = Math.min(aniTotal, POPULAR_LIMIT);
        const pagesAvailable = Math.max(1, Math.min(lastPage, Math.ceil(total / POPULAR_PAGE_SIZE)));
        pageInfo = {
          total,
          currentPage: popularPage,
          lastPage: pagesAvailable,
          hasNextPage: popularPage < pagesAvailable,
        };
      } else {
        const raw = await fetchAniList(MEDIA_QUERY, {
          page,
          perPage: 24,
          sort,
          status,
          genre: feedGenre,
        });
        rawMedia = raw.data?.Page?.media || [];
        pageInfo = raw.data?.Page?.pageInfo;
      }

      const media = rawMedia.map((anime) => ({
        ...anime,
        availability: computeAvailabilityIndex(anime),
      }));

      sendJson(200, {
        success: true,
        pageInfo,
        media,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // API: GET /api/live/{genres,feed,search,details}  (live-action TV + movies;
    // separate ids and sources from the AniList paths, see live-catalog.mjs)
    // -----------------------------------------------------------------------
    if (pathname.startsWith('/api/live/') && req.method === 'GET') {
      const sp = parsedUrl.searchParams;
      try {
        if (pathname === '/api/live/genres') {
          sendJson(200, { success: true, genres: LIVE_GENRES });
        } else if (pathname === '/api/live/feed') {
          sendJson(200, { success: true, ...(await liveFeed({ kind: sp.get('kind'), genre: sp.get('genre'), page: sp.get('page'), since: sp.get('since') })) });
        } else if (pathname === '/api/live/search') {
          sendJson(200, { success: true, ...(await liveSearch({ kind: sp.get('kind'), q: sp.get('q') })) });
        } else if (pathname === '/api/live/details') {
          sendJson(200, { success: true, item: await liveDetails(sp.get('id')) });
        } else {
          sendError(404, 'Unknown live catalog endpoint');
        }
      } catch (err) {
        console.warn(`[AnimePulse] live catalog ${pathname}: ${err.message}`);
        sendError(err.status || 502, err.message);
      }
      return;
    }

    // -----------------------------------------------------------------------
    // API: GET /api/search
    // -----------------------------------------------------------------------
    if (pathname === '/api/search' && req.method === 'GET') {
      const q = (parsedUrl.searchParams.get('q') || '').trim();
      if (!q) {
        sendJson(200, { success: true, media: [] });
        return;
      }

      const raw = await fetchAniList(MEDIA_QUERY, {
        page: 1,
        perPage: 20,
        search: q,
        sort: ['SEARCH_MATCH'],
      });

      const media = (raw.data?.Page?.media || []).map((anime) => ({
        ...anime,
        availability: computeAvailabilityIndex(anime),
      }));

      sendJson(200, {
        success: true,
        media,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // API: GET /api/details
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // API: GET /api/franchise?id=  (full series in watch order; loaded after the modal opens)
    // -----------------------------------------------------------------------
    if (pathname === '/api/franchise' && req.method === 'GET') {
      const id = parseInt(parsedUrl.searchParams.get('id'), 10);
      if (!id || isNaN(id)) {
        sendError(400, 'Invalid or missing anime id');
        return;
      }
      try {
        const franchise = await buildFranchise(id);
        sendJson(200, { success: true, franchise });
      } catch (err) {
        console.warn('[AnimePulse] franchise lookup failed:', err.message);
        sendJson(200, { success: false, franchise: null, error: err.message });
      }
      return;
    }

    if (pathname === '/api/details' && req.method === 'GET') {
      const id = parseInt(parsedUrl.searchParams.get('id'), 10);
      const ep = Math.max(1, parseInt(parsedUrl.searchParams.get('ep') || '1', 10));

      if (!id || isNaN(id)) {
        sendError(400, 'Invalid or missing anime id');
        return;
      }

      const raw = await fetchAniList(DETAIL_QUERY, { id });
      const anime = raw.data?.Media;
      if (!anime) {
        sendError(404, 'Anime details not found');
        return;
      }

      // Filter and organize anime relations (counterpart seasons, prequels, sequels, movies)
      const validFormats = ['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'];
      const rawRelations = anime.relations?.edges || [];
      const counterparts = rawRelations
        .filter((edge) => edge.node && validFormats.includes(edge.node.format))
        .map((edge) => ({
          id: edge.node.id,
          relationType: edge.relationType,
          title: edge.node.title?.english || edge.node.title?.romaji || 'Untitled',
          format: edge.node.format,
          status: edge.node.status,
          episodes: edge.node.episodes,
          coverImage: edge.node.coverImage?.medium || edge.node.coverImage?.large,
          score: edge.node.averageScore,
          seasonYear: edge.node.seasonYear,
        }));

      const availability = computeAvailabilityIndex(anime, ep);

      sendJson(200, {
        success: true,
        anime: {
          ...anime,
          counterparts,
          availability,
        },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // API: GET /api/validate-stream
    // -----------------------------------------------------------------------
    if (pathname === '/api/validate-stream' && req.method === 'GET') {
      const targetUrl = parsedUrl.searchParams.get('url');
      if (!targetUrl) {
        sendError(400, 'Missing url query param');
        return;
      }

      const cacheKey = `val_${targetUrl}`;
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 300000) {
        sendJson(200, { success: true, ...cached.data });
        return;
      }

      const startTime = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);

        const response = await fetch(targetUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
        });
        clearTimeout(timeout);

        const latencyMs = Date.now() - startTime;
        const finalUrl = response.url || targetUrl;
        const isSurveyTrap = /survey-smiles|adcash|monetag|deloplen/i.test(finalUrl);
        const isDead = response.status === 521 || response.status === 502 || response.status === 503 || response.status === 504 || response.status === 404 || isSurveyTrap;

        const result = {
          valid: !isDead,
          status: response.status,
          latencyMs,
          finalUrl,
          reason: isDead ? (isSurveyTrap ? 'Ad Trap Redirect' : `HTTP ${response.status} Error`) : 'Operational',
        };

        cache.set(cacheKey, { data: result, timestamp: Date.now() });
        sendJson(200, { success: true, ...result });
        return;
      } catch (err) {
        const latencyMs = Date.now() - startTime;
        const isTimeout = err.name === 'AbortError' || /timeout/i.test(err.message);
        const result = {
          valid: false,
          status: 0,
          latencyMs,
          reason: isTimeout ? 'Connection Timeout' : 'Network/DNS Unreachable',
        };
        cache.set(cacheKey, { data: result, timestamp: Date.now() });
        sendJson(200, { success: true, ...result });
        return;
      }
    }

    // Owner-only in-window console (never for tunnel visitors)
    if (pathname.startsWith('/api/console')) {
      const h = req.headers;
      const hn = String(h.host || '').replace(/:\d+$/, '');
      const ownerOk = !req.isPublic && !(h['x-forwarded-for'] || h['x-forwarded-host'] || h['cf-connecting-ip'] || h['x-real-ip'] || h['forwarded'])
        && /^(127\.0\.0\.1|localhost|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(hn);
      if (!ownerOk) { sendError(403, 'Console is local-only'); return; }
      if (pathname === '/api/console' && req.method === 'GET') { sendJson(200, { success: true, lines: getLines(parseInt(parsedUrl.searchParams.get('since') || '0', 10)) }); return; }
      if (pathname === '/api/console/clear' && req.method === 'POST') { clearLines(); sendJson(200, { success: true }); return; }
      if (pathname === '/api/console/client' && req.method === 'POST') {
        let b = ''; for await (const c of req) { b += c; if (b.length > 8192) break; }
        try { const j = JSON.parse(b); addLine(['warn', 'error'].includes(j.level) ? j.level : 'log', j.msg, 'browser'); } catch {}
        sendJson(200, { success: true }); return;
      }
    }

    // -----------------------------------------------------------------------
    // API: General media downloader (yt-dlp, any URL)
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // API: Downloads view (read-only file tree). Owner-only: never served through the public tunnel / a proxy.
    // -----------------------------------------------------------------------
    if (pathname === '/api/files/categories' || pathname === '/api/files/tree' || pathname === '/api/files/stream' || pathname === '/api/files/progress' || pathname === '/api/watch-status' || pathname === '/api/watch-mark') {
      const h = req.headers;
      const hostName = String(h.host || '').replace(/:\d+$/, '');
      const viaProxy = h['x-forwarded-for'] || h['x-forwarded-host'] || h['cf-connecting-ip'] || h['x-real-ip'] || h['forwarded'];
      const localHost = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(hostName);
      if (req.isPublic || viaProxy || !localHost) { sendError(403, 'File view is local-only'); return; }
      const postOnly = pathname === '/api/files/progress' || pathname === '/api/watch-mark';
      if (req.method !== (postOnly ? 'POST' : 'GET')) { sendError(405, postOnly ? 'POST only' : 'GET only'); return; }
      const readBody = async () => { let b = ''; for await (const c of req) { b += c; if (b.length > 4096) break; } try { return JSON.parse(b || '{}'); } catch { return null; } };
      try {
        if (pathname === '/api/watch-status') {                           // episode -> {state, pct} for one show
          const id = String(parsedUrl.searchParams.get('animeId') || '').trim();
          if (!/^\d{1,9}$/.test(id)) { sendError(400, 'Invalid animeId'); return; }
          const out = {}, blocked = new Set();
          for (const [k, v] of Object.entries(loadWatch())) {
            if (!k.startsWith(id + '_')) continue;
            const tail = k.slice(id.length + 1); if (!/^\d+$/.test(tail)) continue;
            const ep = parseInt(tail, 10);
            if (v.state === 'unwatched') { blocked.add(ep); continue; }
            out[ep] = { state: v.state, pct: v.pct, manual: !!v.manual, inferred: false };
          }
          // Outside-player history: episodes before the last one you opened are assumed watched (you can undo with a right-click).
          let current = null;
          const h0 = getHistoryRaw().find((x) => String(x.id) === id);
          const last = h0 ? Math.min(parseInt(h0.lastEpisodeWatched, 10) || 0, 2000) : 0;
          if (last >= 1) {
            for (let e = 1; e < last; e++) if (!out[e] && !blocked.has(e)) out[e] = { state: 'completed', pct: 1, manual: false, inferred: true };
            if (!out[last] && !blocked.has(last)) out[last] = { state: 'opened', pct: null, manual: false, inferred: true };
            current = out[last] && out[last].state === 'completed' ? last + 1 : last;     // finished the last one -> next up; else continue it
          }
          sendJson(200, { success: true, statuses: out, current }); return;
        }
        if (pathname === '/api/watch-mark') {                             // manual: mark an episode completed, or clear it
          const b = await readBody(); if (!b) { sendError(400, 'Invalid JSON body'); return; }
          const key = b.cat ? watchKeyForFile(String(b.cat), String(b.path || '')) : playbackKey(b.animeId, b.episode);
          if (!key || !['completed', 'clear'].includes(b.state)) { sendError(400, 'Invalid mark'); return; }
          const e = markWatch(key, b.state); sendJson(200, { success: true, state: e ? e.state : 'none', pct: e ? e.pct : 0 }); return;
        }
        if (pathname === '/api/files/progress') {                         // progress from the Downloads player
          const b = await readBody(); if (!b) { sendError(400, 'Invalid JSON body'); return; }
          openFile(String(b.cat || ''), String(b.path || ''));            // validates category + path + type
          const key = watchKeyForFile(String(b.cat), String(b.path));
          const e = recordWatch(key, b.position, b.duration); sendJson(200, { success: true, state: e ? e.state : 'none', pct: e ? e.pct : 0, position: e ? (e.position || 0) : 0 }); return;
        }
        if (pathname === '/api/files/stream') {                              // range-capable streaming so the player can seek
          const f = openFile(parsedUrl.searchParams.get('cat') || '', parsedUrl.searchParams.get('path') || '');
          const hdr = { 'Content-Type': f.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
          let start = 0, end = f.size - 1, code = 200;
          const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
          if (m && (m[1] !== '' || m[2] !== '')) {
            if (m[1] === '') { start = Math.max(0, f.size - parseInt(m[2], 10)); }
            else { start = parseInt(m[1], 10); if (m[2] !== '') end = Math.min(end, parseInt(m[2], 10)); }
            if (!(start <= end) || start >= f.size) { res.writeHead(416, { 'Content-Range': `bytes */${f.size}` }); res.end(); return; }
            code = 206; hdr['Content-Range'] = `bytes ${start}-${end}/${f.size}`;
          }
          hdr['Content-Length'] = f.size === 0 ? 0 : end - start + 1;
          res.writeHead(code, hdr);
          if (f.size === 0) { res.end(); return; }
          const rs = fs.createReadStream(f.real, { start, end });
          rs.on('error', () => res.destroy()); res.on('close', () => rs.destroy()); rs.pipe(res);
          return;
        }
        if (pathname === '/api/files/categories') { sendJson(200, { success: true, categories: listCategories() }); return; }
        sendJson(200, { success: true, ...listDir(parsedUrl.searchParams.get('cat') || '', parsedUrl.searchParams.get('path') || '') }); return;
      } catch (err) {
        const code = err.status || (err.code === 'ENOENT' ? 404 : err.code === 'ENOTDIR' ? 400 : 500);
        sendError(code, err.status ? err.message : (code === 404 ? 'Not found' : code === 400 ? 'Not a folder' : 'Could not read folder')); return;
      }
    }

    if (pathname.startsWith('/api/media/')) {
      // Owner-only: block anything that arrived through the public tunnel / a proxy
      const h = req.headers;
      const hostName = String(h.host || '').replace(/:\d+$/, '');
      const viaProxy = h['x-forwarded-for'] || h['x-forwarded-host'] || h['cf-connecting-ip'] || h['x-real-ip'] || h['forwarded'];
      const localHost = /^(127\.0\.0\.1|localhost|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(hostName);
      if (req.isPublic || viaProxy || !localHost) { sendError(403, 'Media downloader is local-only'); return; }
      const readJson = async () => { let b = ''; for await (const c of req) b += c; return JSON.parse(b || '{}'); };
      try {
        if (pathname === '/api/media/start' && req.method === 'POST') { sendJson(200, { success: true, job: startMediaDownload(await readJson()) }); return; }
        if (pathname === '/api/media/jobs' && req.method === 'GET') { sendJson(200, { success: true, jobs: listJobs(), tools: checkTools(), dir: getMediaDir() }); return; }
        if (pathname === '/api/media/action' && req.method === 'POST') { sendJson(200, mediaAction(await readJson())); return; }
        if (pathname === '/api/media/file' && req.method === 'GET') { streamMediaFile(req, res, parsedUrl.searchParams.get('id'), parsedUrl.searchParams.get('i') || 0); return; }
      } catch (err) { sendError(400, err.message); return; }
    }

    // -----------------------------------------------------------------------
    // API: Download & Buffer Engine
    // -----------------------------------------------------------------------
    if (pathname === '/api/download/start' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body);
        const result = startDownload(payload);
        sendJson(200, result);
      } catch (err) {
        sendError(400, err.message);
      }
      return;
    }

    if (pathname === '/api/download/status' && req.method === 'GET') {
      const animeId = parsedUrl.searchParams.get('animeId');
      const ep = parsedUrl.searchParams.get('episode') || '1';
      if (!animeId) {
        sendError(400, 'Missing animeId parameter');
        return;
      }
      const status = getDownloadStatus(animeId, ep);
      sendJson(200, { success: true, ...status });
      return;
    }

    if (pathname === '/api/download/action' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body);
        const result = handleAction(payload);
        sendJson(200, result);
      } catch (err) {
        sendError(400, err.message);
      }
      return;
    }

    if (pathname === '/api/files/identify' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) break; }
      let p = {};
      try { p = body ? JSON.parse(body) : {}; } catch { sendError(400, 'Invalid JSON body'); return; }
      try {
        const all = await scanUnlabeled();
        const ready = all.filter((x) => x.to);
        const unresolved = all.filter((x) => !x.to).map(({ category, from, unresolved: reason }) => ({ category, from, reason }));
        const strip = ({ root, ...rest }) => rest;
        if (p.apply === true) {
          const res = applyRenames(ready);
          sendJson(200, { success: true, applied: true, done: res.done, failed: res.failed, unresolved });
        } else {
          sendJson(200, { success: true, applied: false, proposals: ready.map(strip), unresolved });
        }
      } catch (err) { sendError(500, err.message); }
      return;
    }

    if (pathname === '/api/download/purge-watched' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) break; }
      let p = {};
      try { p = body ? JSON.parse(body) : {}; } catch { sendError(400, 'Invalid JSON body'); return; }
      sendJson(200, purgeWatchedCache({ watch: loadWatch(), threshold: 0.95, dryRun: p.dryRun !== false }));
      return;
    }

    if (pathname === '/api/download/library' && req.method === 'GET') {
      const library = getLibraryList();
      sendJson(200, { success: true, library });
      return;
    }

    if (pathname === '/api/download/stream' && req.method === 'GET') {
      const animeId = parsedUrl.searchParams.get('animeId');
      const ep = parsedUrl.searchParams.get('episode') || '1';
      streamVideoFile(req, res, animeId, ep);
      return;
    }

    if (pathname === '/api/download/subtitle' && req.method === 'GET') {
      const animeId = parsedUrl.searchParams.get('animeId');
      const ep = parsedUrl.searchParams.get('episode') || '1';
      streamSubtitleFile(req, res, animeId, ep);
      return;
    }

    // -----------------------------------------------------------------------
    // API: GET /api/history
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // API: playback positions (resume where you left off)
    // -----------------------------------------------------------------------
    if (pathname === '/api/playback' && req.method === 'GET') {
      const key = playbackKey(parsedUrl.searchParams.get('animeId'), parsedUrl.searchParams.get('episode'));
      if (!key) {
        sendError(400, 'Invalid animeId or episode');
        return;
      }
      const entry = loadPlayback()[key];
      sendJson(200, {
        success: true,
        position: entry ? entry.position : 0,
        duration: entry ? entry.duration : 0,
        updatedAt: entry ? entry.updatedAt : null,
      });
      return;
    }

    if (pathname === '/api/playback' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) break;
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        sendError(400, 'Invalid JSON body');
        return;
      }
      const key = playbackKey(payload.animeId, payload.episode);
      const position = Number(payload.position);
      const duration = Number(payload.duration) || 0;
      if (!key || !Number.isFinite(position) || position < 0 || position > 86400) {
        sendError(400, 'Invalid playback payload');
        return;
      }
      recordWatch(key, position, duration);        // persistent watched / partial / completed label
      const all = loadPlayback();
      // Not really started, or finished (within 15s of the end): forget it so the next play starts at 0.
      const finished = duration > 0 && position > duration - 15;
      if (position < 5 || finished) {
        delete all[key];
      } else {
        all[key] = { position: Math.round(position * 10) / 10, duration: Math.round(duration), updatedAt: new Date().toISOString() };
      }
      const keys = Object.keys(all);
      if (keys.length > 500) {
        keys.sort((a, b) => String(all[a].updatedAt).localeCompare(String(all[b].updatedAt)))
          .slice(0, keys.length - 500).forEach((k) => { delete all[k]; });
      }
      savePlayback(all);
      sendJson(200, { success: true, saved: !!all[key] });
      return;
    }

    if (pathname === '/api/history' && req.method === 'GET') {
      const history = getHistory(true);
      sendJson(200, { success: true, history });
      return;
    }

    // -----------------------------------------------------------------------
    // API: POST /api/history/sync
    // -----------------------------------------------------------------------
    if (pathname === '/api/history/sync' && req.method === 'POST') {
      const history = syncHistoryWithBrowser(true);
      sendJson(200, { success: true, history });
      return;
    }

    // -----------------------------------------------------------------------
    // API: POST /api/history
    // -----------------------------------------------------------------------
    if (pathname === '/api/history' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch {
        sendError(400, 'Invalid JSON body');
        return;
      }

      if (!payload.id || !payload.title) {
        sendError(400, 'Missing anime id or title');
        return;
      }

      let history = getHistory(false);
      // Remove existing entry if present
      history = history.filter((item) => String(item.id) !== String(payload.id));

      const epWatched = parseInt(payload.lastEpisodeWatched, 10) || 1;
      const totalEps = payload.totalEpisodes ? parseInt(payload.totalEpisodes, 10) : null;
      let finalStatus = payload.status || 'Watching';
      if (totalEps && epWatched >= totalEps && finalStatus === 'Watching') {
        finalStatus = 'Completed';
      }

      const entry = {
        id: payload.id,
        title: payload.title,
        coverImage: payload.coverImage,
        lastEpisodeWatched: epWatched,
        totalEpisodes: totalEps,
        status: finalStatus,
        lastWatchedAt: new Date().toISOString(),
        streamUrl: payload.streamUrl || `https://vidsrc.pm/embed/anime/${payload.id}/${epWatched}`,
      };

      history.unshift(entry);
      saveHistory(history);

      sendJson(200, { success: true, entry, history });
      return;
    }

    // -----------------------------------------------------------------------
    // API: DELETE /api/history
    // -----------------------------------------------------------------------
    if (pathname === '/api/history' && req.method === 'DELETE') {
      const id = parsedUrl.searchParams.get('id');
      let history = getHistory();
      if (id === 'all') {
        history = [];
      } else if (id) {
        history = history.filter((item) => String(item.id) !== String(id));
      }
      saveHistory(history);
      sendJson(200, { success: true, history });
      return;
    }

    // -----------------------------------------------------------------------
    // API: POST /api/launch
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // API: POST /api/close-window  (closes this app's standalone Chrome window;
    // works without a window manager. The server itself keeps running.)
    // -----------------------------------------------------------------------
    if (pathname === '/api/close-window' && req.method === 'POST') {
      if (isOutside) {
        sendError(403, 'Loopback only');
        return;
      }
      if (req.headers['x-animepulse'] !== '1') {
        sendError(403, 'Missing X-AnimePulse header');
        return;
      }
      const profileDir = process.env.ANIMEPULSE_PROFILE
        || path.join(process.env.HOME || '/home/dev', '.config/google-chrome-animepulse-standalone');
      let pids = [];
      try {
        pids = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
          .split('\n')
          .filter((l) => l.includes(`--user-data-dir=${profileDir}`) && l.includes('--app=') && !l.includes('--type='))
          .map((l) => parseInt(l.trim().split(/\s+/)[0], 10))
          .filter((n) => Number.isFinite(n) && n !== process.pid);
      } catch (err) {
        sendError(500, `Could not list processes: ${err.message}`);
        return;
      }
      if (pids.length === 0) {
        sendError(404, 'No standalone AnimePulse window found');
        return;
      }
      sendJson(200, { success: true, closing: pids });
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
        // Chrome can ignore SIGTERM when hung; escalate if it is still alive.
        setTimeout(() => {
          try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {}
        }, 4000).unref();
      }
      return;
    }

    if (pathname === '/api/launch' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let payload = {};
      try { payload = JSON.parse(body); } catch {}

      const urlToOpen = payload.url;
      if (!urlToOpen) {
        sendError(400, 'Missing url');
        return;
      }

      let safeUrl;
      try {
        const u = new URL(String(urlToOpen));
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
        safeUrl = u.href;
      } catch {
        sendError(400, 'Invalid url (http/https only)');
        return;
      }
      // No shell: argv only, so a crafted URL cannot inject commands
      const chrome = spawn('google-chrome', [safeUrl], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
      });
      chrome.on('error', (err) => console.error('Error launching stream:', err));
      chrome.unref();

      sendJson(200, { success: true, message: `Opened stream: ${urlToOpen}` });
      return;
    }

    // -----------------------------------------------------------------------
    // Static Files Serving
    // -----------------------------------------------------------------------
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendError(403, 'Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    sendError(404, 'File not found');
  } catch (err) {
    console.error('Server error:', err);
    sendError(500, err.message || 'Internal server error');
  }
});

// Second listener: same app, but flagged public. Only the tunnel points here, so
// tunnel visitors can never be mistaken for the owner (headers can be forged; ports can't).
if (TUNNEL_ENABLED) http.createServer((req, res) => { req.isPublic = true; server.emit('request', req, res); }).listen(PUBLIC_PORT, '127.0.0.1');

server.listen(PORT, HOST, () => {
  cleanupOrphanedParts();
  console.log(`[AnimePulse] Server running at http://${HOST}:${PORT}`);
  if (TUNNEL_ENABLED) startTunnel();
  else console.log('[AnimePulse] Sharing is OFF (loopback only, no tunnel). Set ANIMEPULSE_SHARE=1 to enable.');
  prewarmLiveCatalog();
});
