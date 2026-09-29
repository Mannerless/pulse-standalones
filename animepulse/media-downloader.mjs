// General media downloader (yt-dlp): any URL -> video / audio, queue, progress, library.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_FILE = path.join(__dirname, 'data', 'media_jobs.json');
const MAX_CONCURRENT = 2;
const LOCAL_YTDLP = path.join(__dirname, '.venv', 'bin', 'yt-dlp');
const YTDLP = fs.existsSync(LOCAL_YTDLP) ? LOCAL_YTDLP : 'yt-dlp'; // venv copy is newer than the distro package
const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.opus', '.ogg', '.flac', '.wav']);
const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.wav': 'audio/wav' };

export function getMediaDir() {
  if (process.env.MEDIA_DIR) return process.env.MEDIA_DIR;
  if (fs.existsSync('/media/dev/PHONE_3D')) return '/media/dev/PHONE_3D/Media';
  return path.join(__dirname, 'data', 'media');
}

const jobs = new Map();      // id -> job
const procs = new Map();     // id -> child process
let queueRunning = 0;

function save() {
  try {
    fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
    fs.writeFileSync(JOBS_FILE, JSON.stringify([...jobs.values()], null, 2));
  } catch (e) { console.error('[Media] persist failed:', e.message); }
}

function load() {
  try {
    for (const j of JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'))) {
      if (j.status === 'downloading' || j.status === 'queued') { j.status = 'failed'; j.error = 'Interrupted by restart'; }
      jobs.set(j.id, j);
    }
  } catch { /* first run */ }
}
load();

export function checkTools() {
  const out = {};
  for (const b of [YTDLP, 'ffmpeg']) {
    try { execFileSync(b, ['-version'], { stdio: 'ignore' }); out[path.basename(b)] = true; }
    catch { try { execFileSync(b, ['--version'], { stdio: 'ignore' }); out[path.basename(b)] = true; } catch { out[path.basename(b)] = false; } }
  }
  return out;
}

function parseUrl(raw) {
  const u = new URL(String(raw).trim());
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http/https URLs are supported');
  return u.href;
}

export function startMediaDownload({ url, mode = 'video', quality = 'best', playlist = false, subs = false }) {
  const safeUrl = parseUrl(url);
  if (!['video', 'audio'].includes(mode)) throw new Error('mode must be video or audio');
  if (!['best', '1080', '720', '480'].includes(String(quality))) throw new Error('bad quality');
  if (!checkTools()['yt-dlp']) throw new Error('yt-dlp is not installed');
  const id = crypto.randomBytes(6).toString('hex');
  const job = {
    id, url: safeUrl, mode, quality: String(quality), playlist: !!playlist, subs: !!subs,
    status: 'queued', percent: 0, speed: '', eta: '', title: safeUrl, files: [], error: '',
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job); save(); pump();
  return job;
}

function pump() {
  if (queueRunning >= MAX_CONCURRENT) return;
  const next = [...jobs.values()].find(j => j.status === 'queued');
  if (!next) return;
  queueRunning++;
  run(next).finally(() => { queueRunning--; pump(); });
  pump();
}

function run(job) {
  return new Promise((resolve) => {
    const dir = path.join(getMediaDir(), job.mode === 'audio' ? 'Audio' : 'Video');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
      job.status = 'failed'; job.error = `Cannot create ${dir}: ${e.message}`; save(); return resolve();
    }
    const h = job.quality === 'best' ? '' : `[height<=${job.quality}]`;
    const args = ['--newline', '--no-colors', '--restrict-filenames', '--windows-filenames', '-c',
      '--progress-template', 'download:PROG %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--print', 'before_dl:TITLE %(title)s', '--print', 'after_move:FILE %(filepath)s',
      '-o', path.join(dir, '%(title).150B [%(id)s].%(ext)s'),
      job.playlist ? '--yes-playlist' : '--no-playlist'];
    if (job.mode === 'audio') args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    else args.push('-f', `bv*${h}+ba/b${h}`, '--merge-output-format', 'mp4');
    if (job.subs && job.mode === 'video') args.push('--write-subs', '--write-auto-subs', '--sub-langs', 'en.*', '--convert-subs', 'srt');
    args.push('--', job.url);

    job.status = 'downloading'; job.files = []; save();
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    procs.set(job.id, child);
    let errTail = '';
    let buf = '';
    const onLine = (line) => {
      if (line.startsWith('PROG ')) {
        const [p, s, e] = line.slice(5).split('|').map(x => x.trim());
        job.percent = parseFloat(p) || job.percent; job.speed = s; job.eta = e;
      } else if (line.startsWith('TITLE ')) job.title = line.slice(6).trim();
      else if (line.startsWith('FILE ')) job.files.push(line.slice(5).trim());
    };
    child.stdout.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(onLine); });
    child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-800); });
    child.on('error', (e) => { job.status = 'failed'; job.error = e.message; save(); procs.delete(job.id); resolve(); });
    child.on('close', (code, sig) => {
      procs.delete(job.id);
      if (job.status === 'cancelled') { /* keep */ }
      else if (code === 0) { job.status = 'done'; job.percent = 100; job.speed = ''; job.eta = ''; }
      else { job.status = 'failed'; job.error = (errTail.trim().split('\n').pop() || `yt-dlp exited ${code ?? sig}`); }
      save(); resolve();
    });
  });
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(j => ({
    ...j, files: j.files.map(f => path.basename(f)),
  }));
}

export function mediaAction({ id, action }) {
  const job = jobs.get(id);
  if (!job) throw new Error('Unknown job');
  if (action === 'cancel') {
    if (job.status === 'downloading' || job.status === 'queued') {
      job.status = 'cancelled';
      const c = procs.get(id); if (c) c.kill('SIGTERM');
    }
  } else if (action === 'retry') {
    if (job.status === 'failed' || job.status === 'cancelled') { job.status = 'queued'; job.error = ''; job.percent = 0; pump(); }
  } else if (action === 'remove') {          // remove from list only
    if (procs.has(id)) throw new Error('Cancel first');
    jobs.delete(id);
  } else if (action === 'delete') {          // remove list entry + files
    if (procs.has(id)) throw new Error('Cancel first');
    const root = path.resolve(getMediaDir()) + path.sep;
    for (const f of job.files) {
      const r = path.resolve(f);
      if (r.startsWith(root)) { try { fs.rmSync(r, { force: true }); } catch {} }
    }
    jobs.delete(id);
  } else throw new Error('Unknown action');
  save();
  return { success: true };
}

export function streamMediaFile(req, res, id, index = 0) {
  const job = jobs.get(id);
  const f = job && job.files[Number(index) || 0];
  const root = path.resolve(getMediaDir()) + path.sep;
  const abs = f && path.resolve(f);
  if (!abs || !abs.startsWith(root) || !fs.existsSync(abs)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'File not available' }));
  }
  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const size = fs.statSync(abs).size;
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (start >= size || end >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': type });
    fs.createReadStream(abs, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': type, 'Accept-Ranges': 'bytes',
      ...(req.url.includes('dl=1') ? { 'Content-Disposition': `attachment; filename="${path.basename(abs)}"` } : {}) });
    fs.createReadStream(abs).pipe(res);
  }
}

export { VIDEO_EXT, AUDIO_EXT };
