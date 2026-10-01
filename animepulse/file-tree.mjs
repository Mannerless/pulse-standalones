// file-tree.mjs: read-only directory tree for the Downloads view.
// Categories are fixed storage roots; callers pass a category id + relative path, never an absolute path.
// Every resolved path (after realpath) must stay inside its category root, so ".." and symlinks cannot escape.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { isMounted, EXTERNAL_ROOT } from './mounts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const MAX_ENTRIES = 500;
const VIDEO = new Set(['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi']);
const AUDIO = new Set(['.mp3', '.m4a', '.opus', '.ogg', '.flac', '.wav']);
const SUBS = new Set(['.vtt', '.srt', '.ass']);

export const CATEGORIES = [
  { id: 'anime', icon: '🎌', label: 'Anime library', note: 'Saved episodes on the external drive', root: path.join(EXTERNAL_ROOT, 'Anime'), external: true },
  { id: 'media', icon: '🎧', label: 'Media downloads', note: 'Video and audio downloads on the external drive', root: path.join(EXTERNAL_ROOT, 'Media'), external: true },
  { id: 'cache', icon: '⏳', label: 'Downloading / cache', note: 'Temporary episodes on the internal disk (not yet saved to the drive)', root: path.join(__dirname, 'data', 'cache'), external: false },
  { id: 'local', icon: '💽', label: 'Local library', note: 'Saved episodes kept on the internal disk', root: path.join(__dirname, 'data', 'library'), external: false },
  { id: 'legacy', icon: '📦', label: 'Legacy library', note: 'Older AnimePulse install on the internal disk', root: path.join(HOME, 'anime-pulse', 'data', 'library'), external: false },
];

const byId = (id) => CATEGORIES.find((c) => c.id === id);
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function status(cat) {
  if (cat.external && !isMounted(EXTERNAL_ROOT)) return { state: 'locked', message: 'External drive is not mounted (locked). Unlock it, then refresh.' };
  if (!fs.existsSync(cat.root)) return { state: 'empty', message: 'Folder not created yet: it appears after the first download.' };
  return { state: 'ready', message: '' };
}

export function listCategories() {
  return CATEGORIES.map((c) => {
    const st = status(c);
    let items = null;
    if (st.state === 'ready') { try { items = fs.readdirSync(c.root).filter((n) => !n.startsWith('.')).length; } catch (_) {} }
    return { id: c.id, icon: c.icon, label: c.label, note: c.note, root: c.root, external: c.external, state: st.state, message: st.message, items };
  });
}

// Resolve `rel` inside the category root, refusing anything that escapes it.
function safeResolve(cat, rel) {
  const base = fs.realpathSync(cat.root);
  const target = path.resolve(base, String(rel || '').replace(/^[/\\]+/, ''));
  const real = fs.realpathSync(target);
  if (real !== base && !real.startsWith(base + path.sep)) { const e = new Error('Path outside category'); e.status = 403; throw e; }
  return { base, real };
}

function episodeNumber(name) {
  const m = name.match(/(?:episode|ep|e)[ _-]*0*(\d{1,4})/i) || name.match(/(?:^|[^\d])0*(\d{1,4})\.[a-z0-9]{2,4}$/i);
  return m ? parseInt(m[1], 10) : null;
}

export function listDir(catId, rel = '') {
  const cat = byId(catId);
  if (!cat) { const e = new Error('Unknown category'); e.status = 404; throw e; }
  const st = status(cat);
  if (st.state !== 'ready') return { category: cat.id, path: '', state: st.state, message: st.message, entries: [] };
  const { base, real } = safeResolve(cat, rel);
  let names = fs.readdirSync(real, { withFileTypes: true });
  const total = names.length;
  names = names.filter((d) => !d.name.startsWith('.') && !/\.part(-Frag\d+)?$|\.ytdl$|\.tmp$/i.test(d.name));   // hide partial-download fragments
  const entries = [];
  for (const d of names.slice(0, MAX_ENTRIES * 2)) {
    const full = path.join(real, d.name);
    let stt; try { stt = fs.statSync(full); } catch (_) { continue; }        // follows symlinks; broken links are skipped
    const relPath = path.relative(base, full);
    if (stt.isDirectory()) {
      let items = null, kids = [];
      try { kids = fs.readdirSync(full).filter((n) => !n.startsWith('.')); items = kids.length; } catch (_) {}
      let label = null;
      const mf = path.join(full, 'meta.json');                               // cache task folders carry the real title
      if (items !== null && items < 50 && fs.existsSync(mf)) {
        try { const m = JSON.parse(fs.readFileSync(mf, 'utf8')); label = m.title ? `${m.title}${m.episode ? ' · Ep ' + m.episode : ''}` : null; } catch (_) {}
      }
      if (!label && kids.length) {                                            // else name it after the video inside: "Show Name Episode 7"
        const v = kids.find((n) => /\.(mp4|mkv|webm|m4v)(\.|$)/i.test(n));
        if (v) label = v.replace(/\.(mp4|mkv|webm|m4v)(\..*)?$/i, '').replace(/_/g, ':').slice(0, 120);
      }
      entries.push({ name: d.name, label, type: 'dir', path: relPath, items, mtime: stt.mtimeMs });
    } else if (stt.isFile()) {
      const ext = path.extname(d.name).toLowerCase();
      entries.push({ name: d.name, type: 'file', path: relPath, size: stt.size, mtime: stt.mtimeMs, ext,
        kind: VIDEO.has(ext) ? 'video' : AUDIO.has(ext) ? 'audio' : SUBS.has(ext) ? 'subs' : 'other', episode: episodeNumber(d.name) });
    }
  }
  const watchAll = readJson(WATCH_FILE, {}), savedLib = readJson(SAVED_FILE, []);
  for (const en of entries) {                                              // watched / partial / completed label for playable files
    if (en.type === 'file' && (en.kind === 'video' || en.kind === 'audio')) {
      const w = watchAll[watchKeyForFile(cat.id, en.path, savedLib)];
      if (w && w.state !== 'unwatched') en.watch = { state: w.state, pct: w.pct, position: w.position || 0 };
    }
  }
  entries.sort((a, b) => (a.type === b.type ? natural.compare(a.label || a.name, b.label || b.name) : a.type === 'dir' ? -1 : 1));
  return { category: cat.id, path: path.relative(base, real), state: 'ready', message: '', truncated: entries.length > MAX_ENTRIES || total > MAX_ENTRIES * 2,
    entries: entries.slice(0, MAX_ENTRIES) };
}

// ---- playback: resolve one media/subtitle file inside a category (same path guard as listDir) ----
const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.vtt': 'text/vtt; charset=utf-8' };

export function openFile(catId, rel) {
  const cat = byId(catId);
  if (!cat) { const e = new Error('Unknown category'); e.status = 404; throw e; }
  const st = status(cat);
  if (st.state !== 'ready') { const e = new Error(st.message); e.status = 409; throw e; }
  const { real } = safeResolve(cat, rel);
  const stt = fs.statSync(real);
  if (!stt.isFile()) { const e = new Error('Not a file'); e.status = 400; throw e; }
  if (path.basename(real).startsWith('.')) { const e = new Error('Not allowed'); e.status = 403; throw e; }
  const mime = MIME[path.extname(real).toLowerCase()];
  if (!mime) { const e = new Error('File type not playable'); e.status = 415; throw e; }
  return { real, size: stt.size, mime };
}

// ---- watch-status join: which episode/file does this path correspond to? ----
const WATCH_FILE = path.join(__dirname, 'data', 'watch-status.json');
const SAVED_FILE = path.join(__dirname, 'data', 'saved_library.json');
function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } }

// Same key the episode grid uses ("<animeId>_<episode>") when we can tell which episode a file is; else a per-file key.
export function watchKeyForFile(catId, rel, saved = null) {
  const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (catId === 'cache') { const m = /^(\d{1,9})_ep(\d{1,4})(?:\/|$)/.exec(r); if (m) return `${m[1]}_${parseInt(m[2], 10)}`; }
  const lib = saved || readJson(SAVED_FILE, []);
  const hit = Array.isArray(lib) ? lib.find((e) => e && e.filePath && e.filePath.replace(/\\/g, '/').endsWith('/' + r) && /^\d{1,9}$/.test(String(e.animeId)) && Number(e.episode) >= 1) : null;
  if (hit) return `${hit.animeId}_${parseInt(hit.episode, 10)}`;
  return `f:${catId}:${r}`.slice(0, 300);
}
