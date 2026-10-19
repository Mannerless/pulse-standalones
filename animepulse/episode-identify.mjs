// episode-identify.mjs: find video files whose names don't identify the show/episode, work out
// what they are (filename parsing + folder name + embedded tags, confirmed against AniList), and
// rename them to the library layout "<Show Title>/Episode_<N>.<ext>" (subtitle sidecars follow).
// Safe by design: scans fixed category roots only, never overwrites, dry-run first.
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CATEGORIES } from './file-tree.mjs';
import { isMounted, EXTERNAL_ROOT } from './mounts.mjs';

const execFileAsync = promisify(execFile);
const VIDEO_RE = /\.(mp4|m4v|mkv|webm|mov|avi)$/i;
const SIDECAR_EXT = ['.vtt', '.srt', '.ass'];
const SCAN_CATS = ['anime', 'media', 'local', 'legacy'];       // never the cache: its id-named folders carry meta.json
const MAX_DEPTH = 4;
const MAX_FILES = 2000;

const stripJunk = (s) => s
  .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')                                                   // [Group] (1080p) (BD)
  .replace(/\b(2160p|1080p|720p|480p|x26[45]|h\.?26[45]|hevc|av1|10bit|8bit|aac|flac|ac3|dual[ ._-]?audio|multi[ ._-]?sub|web[ ._-]?dl|web[ ._-]?rip|bluray|bd(?:rip)?|hd(?:tv)?|sub(?:bed)?|dub(?:bed)?|eng(?:lish)?|jpn|nf|amzn|cr|hidive)\b/gi, ' ')
  .replace(/[._]+/g, ' ')
  .replace(/\s+/g, ' ').trim();

// Directory name that is already a decent show title (not a bare number / id / junk).
const looksLikeTitle = (s) => /[A-Za-z]{3}/.test(s) && !/^(downloads?|videos?|anime|media|library|season \d+|s\d+|temp|new folder)$/i.test(s.trim());

// Parse a filename (+ parent folder) into { title, episode, season }.
export function parseName(fileName, parentDir = '') {
  const base = fileName.replace(/\.[^.]+$/, '');
  let ep = null, season = null, titlePart = base, m;
  if ((m = /\bS(\d{1,2})[ ._-]*E(\d{1,4})\b/i.exec(base))) { season = +m[1]; ep = +m[2]; titlePart = base.slice(0, m.index); }
  else if ((m = /\b(?:episode|ep|e)[ ._-]*0*(\d{1,4})(?:v\d)?\b/i.exec(base))) { ep = +m[1]; titlePart = base.slice(0, m.index); }
  else if ((m = /\s-\s*0*(\d{1,4})(?:v\d)?(?=\s|$|\[|\()/.exec(base))) { ep = +m[1]; titlePart = base.slice(0, m.index); }
  else if ((m = /(?:^|[ ._-])0*(\d{1,3})(?:v\d)?$/.exec(stripJunk(base)))) { ep = +m[1]; titlePart = stripJunk(base).slice(0, m.index); }
  else if (/^0*(\d{1,3})$/.test(base.trim())) { ep = +base.trim(); titlePart = ''; }
  let title = stripJunk(titlePart).replace(/[-–:\s]+$/, '').trim();
  if (!title || !looksLikeTitle(title)) title = looksLikeTitle(path.basename(parentDir)) ? stripJunk(path.basename(parentDir)) : '';
  return { title, episode: ep, season };
}

// Already labeled the way AnimePulse writes it (and the title isn't junk).
function isProperlyLabeled(rel) {
  const parts = rel.split(path.sep);
  const file = parts[parts.length - 1];
  if (parts.length >= 2 && /^Episode_\d{1,4}\.[a-z0-9]+$/i.test(file) && looksLikeTitle(parts[parts.length - 2])) return true;
  const m = /^(.{3,}) Episode (\d{1,4})\.[a-z0-9]+$/i.exec(file);
  return !!(m && looksLikeTitle(m[1]) && !/[\[\]_]/.test(m[1]));
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function similarity(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size);
}

const aniCache = new Map();
async function aniListLookup(query) {
  const key = norm(query);
  if (aniCache.has(key)) return aniCache.get(key);
  let result = null;
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: 'query($q:String){Page(perPage:5){media(search:$q,type:ANIME){id episodes title{romaji english} synonyms}}}', variables: { q: query } }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      const media = (await r.json())?.data?.Page?.media || [];
      let best = null, bestScore = 0;
      for (const md of media) {
        const names = [md.title?.romaji, md.title?.english, ...(md.synonyms || [])].filter(Boolean);
        const score = Math.max(0, ...names.map((n) => similarity(query, n)));
        if (score > bestScore) { bestScore = score; best = md; }
      }
      if (best && bestScore >= 0.6) result = { id: best.id, title: best.title.english || best.title.romaji, episodes: best.episodes || null, score: bestScore };
    }
  } catch { /* offline / rate-limited: fall back to the parsed title */ }
  aniCache.set(key, result);
  return result;
}

async function embeddedTitle(file) {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=title,show,episode_id', '-of', 'json', file], { timeout: 15000 });
    const t = JSON.parse(stdout)?.format?.tags || {};
    return { title: t.show || t.title || '', episode: t.episode_id ? parseInt(t.episode_id, 10) || null : null };
  } catch { return { title: '', episode: null }; }
}

function walk(root, depth, out) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let ents; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const d of ents) {
    if (d.name.startsWith('.') || /\.part(-Frag\d+)?$|\.ytdl$|\.tmp$/i.test(d.name)) continue;
    const full = path.join(root, d.name);
    if (d.isDirectory()) walk(full, depth + 1, out);
    else if (d.isFile() && VIDEO_RE.test(d.name)) out.push(full);
  }
}

const safeTitle = (t) => t.replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim();

// Build rename proposals. Each: { category, from, to, title, episode, confidence } or { ..., unresolved: reason }.
export async function scanUnlabeled() {
  const proposals = [];
  const claimed = new Set();
  for (const id of SCAN_CATS) {
    const cat = CATEGORIES.find((c) => c.id === id);
    if (!cat || !fs.existsSync(cat.root)) continue;
    if (cat.external && !isMounted(EXTERNAL_ROOT)) continue;
    const root = fs.realpathSync(cat.root);
    const files = []; walk(root, 0, files);
    for (const file of files) {
      const rel = path.relative(root, file);
      if (isProperlyLabeled(rel)) continue;
      const parsed = parseName(path.basename(file), path.dirname(file));
      const emb = (!parsed.title || parsed.episode == null) ? await embeddedTitle(file) : { title: '', episode: null };
      let title = parsed.title || stripJunk(emb.title || '');
      let episode = parsed.episode ?? emb.episode;
      const item = { category: id, root, from: rel };
      if (!title || episode == null) { proposals.push({ ...item, unresolved: !title ? 'could not determine the anime title' : 'could not determine the episode number', guess: { title, episode } }); continue; }
      const hit = await aniListLookup(title);
      if (!hit) { proposals.push({ ...item, unresolved: `no AniList match for "${title}" (or AniList unreachable)`, guess: { title, episode } }); continue; }
      const confidence = 'verified';
      title = hit.title; if (hit.episodes && episode > hit.episodes) { proposals.push({ ...item, unresolved: `episode ${episode} exceeds the ${hit.episodes} episodes of "${hit.title}"`, guess: { title, episode } }); continue; }
      const folder = safeTitle(title);
      if (!folder) { proposals.push({ ...item, unresolved: 'title has no usable characters', guess: { title, episode } }); continue; }
      const ext = path.extname(file).toLowerCase();
      const toRel = path.join(folder, `Episode_${episode}${ext}`);
      if (toRel === rel) continue;
      const toAbs = path.join(root, toRel);
      if (fs.existsSync(toAbs) || claimed.has(toAbs)) { proposals.push({ ...item, unresolved: `target already exists: ${toRel}`, guess: { title, episode } }); continue; }
      claimed.add(toAbs);
      proposals.push({ ...item, to: toRel, title, episode, confidence });
    }
  }
  return proposals;
}

// Apply proposals previously returned by scanUnlabeled (re-validated; paths must stay inside the root).
export function applyRenames(proposals) {
  const done = [], failed = [];
  for (const p of proposals) {
    try {
      const cat = CATEGORIES.find((c) => c.id === p.category);
      if (!cat || !SCAN_CATS.includes(cat.id) || !p.from || !p.to) throw new Error('invalid proposal');
      const root = fs.realpathSync(cat.root);
      const src = path.resolve(root, p.from), dst = path.resolve(root, p.to);
      if (!src.startsWith(root + path.sep) || !dst.startsWith(root + path.sep)) throw new Error('path outside category');
      if (!VIDEO_RE.test(src) || !fs.existsSync(src)) throw new Error('source missing');
      if (fs.existsSync(dst)) throw new Error('target exists');
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
      const sb = src.replace(/\.[^.]+$/, ''), db = dst.replace(/\.[^.]+$/, '');
      for (const e of SIDECAR_EXT) if (fs.existsSync(sb + e) && !fs.existsSync(db + e)) fs.renameSync(sb + e, db + e);
      // tidy: remove the old folder only if it is now empty and not the root
      const oldDir = path.dirname(src);
      if (oldDir !== root && oldDir !== path.dirname(dst)) { try { if (!fs.readdirSync(oldDir).length) fs.rmdirSync(oldDir); } catch {} }
      done.push({ from: p.from, to: p.to });
    } catch (e) { failed.push({ from: p.from, error: e.message }); }
  }
  return { done, failed };
}
