// Resolves an episode's HLS stream on hianime.at without needing ani-cli's (outdated) player decoder.
// The site's current player encrypts its source list, so a real headless Chrome loads the player page and we
// capture the .m3u8 request it makes after decrypting. English dub is always tried first.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer-core';

const run = promisify(execFile);
const BASE = 'https://hianime.at';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';

async function curl(url, referer = `${BASE}/`) {
  const { stdout } = await run('curl', ['-sL', '--max-time', '20', '-A', UA, '-e', referer, '-H', 'X-Requested-With: XMLHttpRequest', url], { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}
const decodeEntities = (s) => s.replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function searchAnime(query) {
  const html = await curl(`${BASE}/search?keyword=${encodeURIComponent(query)}`);
  if (/<title>Just a moment/i.test(html)) throw new Error('Blocked by Cloudflare');
  const main = html.split('id="main-sidebar"')[0].replace(/\n/g, ' ');
  const out = [];
  const re = /<h3 class="film-name">\s*<a href="[^"]*\/([^"\/]*)"\s*title="([^"]*)"/g;
  let m;
  while ((m = re.exec(main))) out.push({ slug: m[1], title: decodeEntities(m[2]) });
  return out;
}

export async function listEpisodes(slug) {
  const raw = await curl(`${BASE}/api/theme/episode/list/${slug.split('-').pop()}`);
  const html = raw.replace(/\\/g, '').replace(/ep-item/g, '\nep-item');
  const map = new Map();
  for (const line of html.split('\n')) {
    const m = /data-number="([^"]*)".*data-id="(\d+)".*\/watch\/([^"?]*)/.exec(line);
    if (m && m[3] === slug) map.set(String(m[1]), m[2]);
  }
  return map; // episode number -> episode id
}

export async function listServers(epId) {
  const raw = await curl(`${BASE}/api/theme/episode/servers?episodeId=${epId}`);
  const html = raw.replace(/\\"/g, '"').replace(/server-item/g, '\nserver-item');
  const servers = [];
  for (const line of html.split('\n')) {
    const m = /data-type="(sub|dub)".*?data-server-name="([^"]*)".*?data-hash="([^"]*)"/s.exec(line);
    if (m) servers.push({ type: m[1], name: m[2], embed: Buffer.from(m[3], 'base64').toString('utf8') });
  }
  return servers;
}

// Load the player in headless Chrome and capture the stream + subtitle URLs the player requests.
async function captureStream(embedUrl, timeoutMs = 35000) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-features=Translate'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ Referer: `${BASE}/` });
    let m3u8 = null; let vtt = null; let m3u8Headers = null;
    page.on('request', (r) => {
      const u = r.url();
      if (!m3u8 && /\.m3u8(\?|$)/.test(u)) { m3u8 = u; m3u8Headers = r.headers(); }
    });
    page.on('response', async (r) => {
      const u = r.url();
      try {
        if (/getSources/.test(u)) {
          const j = JSON.parse(await r.text());
          const t = (j.tracks || []).find((x) => x.kind === 'captions' && /english/i.test(x.label || '')) || (j.tracks || []).find((x) => x.kind === 'captions');
          if (t && t.file) vtt = t.file;
        }
      } catch { /* not JSON */ }
    });
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 30000, referer: `${BASE}/` }).catch(() => {});
    const t0 = Date.now();
    let clicked = 0;
    while (!m3u8 && Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 700));
      if (!m3u8 && clicked < 4 && Date.now() - t0 > 2500 * (clicked + 1)) { // nudge the player if it waits for a gesture
        clicked++;
        try { await page.mouse.click(320, 200); } catch {}
      }
    }
    if (!m3u8) throw new Error('Player did not request a stream (no .m3u8 seen)');
    return { m3u8, vtt, headers: m3u8Headers || {} };
  } finally {
    await browser.close().catch(() => {});
  }
}

// mode: 'dub' | 'sub'. Returns { m3u8, referer, vtt, server, type, slug, title }
export async function resolveEpisode({ titles, episode, mode }) {
  const tries = [];
  for (const q of titles.filter(Boolean)) {
    let results;
    try { results = await searchAnime(q); } catch (e) { tries.push(`search "${q}": ${e.message}`); continue; }
    if (!results.length) { tries.push(`search "${q}": no results`); continue; }
    // prefer an exact title match, otherwise the first result (same as ani-cli -S 1)
    const hit = results.find((r) => norm(r.title) === norm(q)) || results[0];
    const eps = await listEpisodes(hit.slug);
    const epId = eps.get(String(episode));
    if (!epId) { tries.push(`"${hit.title}": episode ${episode} not listed`); continue; }
    const servers = (await listServers(epId)).filter((s) => s.type === mode);
    if (!servers.length) { tries.push(`"${hit.title}" ep ${episode}: no ${mode} servers`); continue; }
    servers.sort((a, b) => (a.name === 'HD-2' ? -1 : 0) - (b.name === 'HD-2' ? -1 : 0));
    for (const s of servers) {
      try {
        const cap = await captureStream(s.embed);
        return { m3u8: cap.m3u8, referer: `${new URL(s.embed).origin}/`, vtt: cap.vtt, server: s.name, type: mode, slug: hit.slug, title: hit.title };
      } catch (e) { tries.push(`"${hit.title}" ep ${episode} ${mode} ${s.name}: ${e.message}`); }
    }
  }
  const err = new Error(`No ${mode} stream found. ${tries.join(' | ')}`);
  err.tries = tries;
  throw err;
}

// CLI: node hianime-resolver.mjs "<title>" <episode> <dub|sub> ["alt title"]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [title, ep, mode = 'dub', alt] = process.argv.slice(2);
  resolveEpisode({ titles: [title, alt], episode: ep, mode })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
