// live-catalog.mjs: live-action TV series and movies from keyless public sources.
// Kept fully separate from the AniList/anime paths (own ids, endpoints and modal).
//   TV browse     : iTunes "top TV seasons" RSS (US), one card per show, Animation dropped.
//   TV search     : TVmaze /search/shows (type Animation dropped).
//   TV details    : TVmaze show + seasons + cast; iTunes season ids are mapped to TVmaze by name.
//   Movie browse  : iTunes "top movies" RSS (US), Anime genre dropped.
//   Movie search  : IMDb suggestion JSON (unofficial; fails soft to cached iTunes titles).
//   Movie details : iTunes lookup (with trailer), or Wikidata + Wikipedia summary for IMDb hits.
// "Where to watch" is legal links only: official site, Apple TV, JustWatch, free ad-supported services, IMDb.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const TVMAP_FILE = path.join(DATA_DIR, 'live-tvmaze-map.json');

const UA = 'AnimePulse/1.0 (personal local app)';
const PAGE_SIZE = 24;
const FEED_TTL_MS = 60 * 60 * 1000;
const DETAIL_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_TTL_MS = 30 * 60 * 1000;
const MAP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAP_MISS_TTL_MS = 24 * 60 * 60 * 1000;
const TV_MAP_BUDGET_MS = 6000;   // how long a feed request waits for uncached TVmaze lookups
const TIMEOUT_MS = 15000;
const NET_RETRIES = 2;
const RETRYABLE_NET_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED']);
const MEMO_MAX = 500;

// Genre ids verified against each feed's category label (2026-10-02).
export const LIVE_GENRES = {
  tv: [
    { key: 'All', id: null },
    { key: 'Drama', id: 4001 },
    { key: 'Comedy', id: 4000 },
    { key: 'Sci-Fi & Fantasy', id: 4008 },
    { key: 'Reality & Nonfiction', id: 4007 },
  ],
  movie: [
    { key: 'All', id: null },
    { key: 'Action & Adventure', id: 4401 },
    { key: 'Comedy', id: 4404 },
    { key: 'Drama', id: 4406 },
    { key: 'Thriller', id: 4416 },
    { key: 'Horror', id: 4408 },
    { key: 'Romance', id: 4412 },
    { key: 'Sci-Fi & Fantasy', id: 4413 },
    { key: 'Kids & Family', id: 4410 },
    { key: 'Documentary', id: 4405 },
  ],
};
const TV_ANIMATION_GENRE = 'Animation';
const MOVIE_ANIME_GENRE = 'Anime';

class LiveError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const hostOf = (url) => { try { return new URL(url).host; } catch (_) { return 'source'; } };
const normName = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const yearOf = (s) => { const m = String(s || '').match(/\b(18|19|20)\d{2}\b/); return m ? parseInt(m[0], 10) : null; };
const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const isHttpUrl = (u) => { try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch (_) { return false; } };

// Apple art URLs end in "/<w>x<h>bb.<ext>"; any size can be requested.
function appleArt(url, w, h) {
  if (!url) return '';
  return /\/\d+x\d+bb\.(png|jpe?g|webp)$/i.test(url) ? url.replace(/\/\d+x\d+bb\.(png|jpe?g|webp)$/i, `/${w}x${h}bb.jpg`) : url;
}
// IMDb (Amazon) images accept a resize token after "._V1_".
function imdbArt(url, w) {
  if (!url) return '';
  return /\._V1_.*\.jpg$/i.test(url) ? url.replace(/\._V1_.*\.jpg$/i, `._V1_UX${w}_.jpg`) : url;
}

// -----------------------------------------------------------------------------
// HTTP: timeout, retry on transient network errors and 429, 404 -> null.
// -----------------------------------------------------------------------------
async function fetchJson(url, { limiter = null } = {}) {
  for (let attempt = 0; ; attempt++) {
    if (limiter) await limiter();
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const code = err?.cause?.code || err?.code;
      const retryable = err?.name === 'TimeoutError' || RETRYABLE_NET_CODES.has(code);
      if (!retryable || attempt >= NET_RETRIES) throw new LiveError(502, `${hostOf(url)} unreachable (${code || err?.name || 'network error'})`);
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 && attempt <= NET_RETRIES) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
      await res.text().catch(() => {});
      await sleep(Math.min(15000, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 3 * (attempt + 1)) * 1000));
      continue;
    }
    if (res.status === 404) { await res.text().catch(() => {}); return null; }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LiveError(502, `${hostOf(url)} HTTP ${res.status}${text ? `: ${text.slice(0, 80)}` : ''}`);
    }
    try { return await res.json(); } catch (_) { throw new LiveError(502, `${hostOf(url)} returned invalid JSON`); }
  }
}

// TVmaze allows ~20 calls per 10s per IP; stay under it.
const tvmazeStamps = [];
async function tvmazeLimiter() {
  for (;;) {
    const now = Date.now();
    while (tvmazeStamps.length && now - tvmazeStamps[0] >= 10000) tvmazeStamps.shift();
    if (tvmazeStamps.length < 18) { tvmazeStamps.push(now); return; }
    await sleep(10000 - (now - tvmazeStamps[0]) + 25);
  }
}

// In-memory TTL cache; concurrent callers share one request; stale data is served if a refresh fails.
const memo = new Map();
async function cached(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && hit.value !== undefined && Date.now() - hit.at < ttl) return hit.value;
  if (hit && hit.pending) return hit.pending;
  const pending = fn();
  memo.set(key, { at: hit?.at || 0, value: hit?.value, pending });
  try {
    const value = await pending;
    memo.delete(key);
    memo.set(key, { at: Date.now(), value });
    while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
    return value;
  } catch (err) {
    if (hit && hit.value !== undefined) { memo.set(key, { at: hit.at, value: hit.value }); return hit.value; }
    memo.delete(key);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Persistent show-name -> TVmaze summary map (posters, ratings, Animation filter).
// -----------------------------------------------------------------------------
let tvMap = {};
try {
  const raw = JSON.parse(fs.readFileSync(TVMAP_FILE, 'utf8'));
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) tvMap = raw;
} catch (err) {
  if (err.code !== 'ENOENT') console.warn(`[AnimePulse] live: ignoring unreadable ${path.basename(TVMAP_FILE)} (${err.message})`);
}
let tvMapSaveTimer = null;
function saveTvMapSoon() {
  clearTimeout(tvMapSaveTimer);
  tvMapSaveTimer = setTimeout(() => {
    const tmp = `${TVMAP_FILE}.tmp`;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(tvMap));
      fs.renameSync(tmp, TVMAP_FILE);
    } catch (err) {
      console.warn(`[AnimePulse] live: could not save TVmaze map (${err.message})`);
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  }, 2000);
  tvMapSaveTimer.unref?.();
}

function tvMapGet(name) {
  const hit = tvMap[normName(name)];
  if (!hit) return undefined;
  const fresh = Date.now() - (hit.at || 0) < (hit.id ? MAP_TTL_MS : MAP_MISS_TTL_MS);
  return fresh ? hit : undefined;
}

function tvmazeSummary(s) {
  return {
    id: s.id,
    name: s.name,
    type: s.type || '',
    poster: s.image?.medium || s.image?.original || '',
    rating: s.rating?.average ?? null,
    status: s.status || '',
    network: s.network?.name || s.webChannel?.name || '',
    genres: Array.isArray(s.genres) ? s.genres : [],
    premiered: s.premiered || '',
  };
}

const tvResolveInflight = new Map();
async function resolveTvmaze(name, yearHint) {
  const key = normName(name);
  if (!key) return null;
  const hit = tvMapGet(name);
  if (hit) return hit.id ? hit : null;
  if (tvResolveInflight.has(key)) return tvResolveInflight.get(key);
  const job = (async () => {
    const results = asArray(await fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(name)}`, { limiter: tvmazeLimiter }));
    const shows = results.map((r) => r?.show).filter((s) => s && s.id);
    // A later season can't predate the show; allow a year of slack for release-date skew.
    const plausible = (s) => !yearHint || !s.premiered || yearOf(s.premiered) <= yearHint + 1;
    const exact = shows.filter((s) => normName(s.name) === key);
    const loose = shows.filter((s) => { const n = normName(s.name); return n.startsWith(key) || key.startsWith(n); });
    const pick = exact.find(plausible) || exact[0] || loose.find(plausible) || null;
    tvMap[key] = pick ? { ...tvmazeSummary(pick), at: Date.now() } : { id: null, at: Date.now() };
    saveTvMapSoon();
    return pick ? tvMap[key] : null;
  })();
  tvResolveInflight.set(key, job);
  try { return await job; } finally { tvResolveInflight.delete(key); }
}

// -----------------------------------------------------------------------------
// iTunes feeds + lookup
// -----------------------------------------------------------------------------
function rssImage(entry) {
  const imgs = asArray(entry?.['im:image']);
  return imgs.length ? imgs[imgs.length - 1]?.label || '' : '';
}

function seasonLabel(seasonTitle, show) {
  const t = String(seasonTitle || '').trim();
  const prefix = `${show}, `;
  return t.toLowerCase().startsWith(prefix.toLowerCase()) ? t.slice(prefix.length) : t;
}

function genreId(kind, key) {
  const g = LIVE_GENRES[kind].find((x) => x.key === (key || 'All'));
  if (!g) throw new LiveError(400, `Unknown ${kind === 'tv' ? 'TV' : 'movie'} genre: ${key}`);
  return g.id;
}

async function topTvShows(gid) {
  return cached(`feed:tv:${gid || 'all'}`, FEED_TTL_MS, async () => {
    const url = `https://itunes.apple.com/us/rss/toptvseasons/limit=100${gid ? `/genre=${gid}` : ''}/json`;
    const data = await fetchJson(url);
    const seen = new Set();
    const out = [];
    for (const e of asArray(data?.feed?.entry)) {
      const genre = e?.category?.attributes?.label || '';
      if (genre === TV_ANIMATION_GENRE) continue;
      const id = e?.id?.attributes?.['im:id'];
      const seasonTitle = e?.['im:name']?.label || '';
      const show = String(e?.['im:artist']?.label || '').trim()
        || seasonTitle.replace(/,\s*(Season\s+\d+.*|The Complete Series.*)$/i, '').trim();
      const key = normName(show);
      if (!id || !/^\d+$/.test(id) || !key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        liveId: `itunes-tv:${id}`,
        kind: 'tv',
        title: show,
        subtitle: seasonLabel(seasonTitle, show),
        year: yearOf(e?.['im:releaseDate']?.label),
        poster: appleArt(rssImage(e), 600, 600),
        genres: genre ? [genre] : [],
        rating: null,
        status: '',
        network: '',
        summary: stripHtml(e?.summary?.label || ''),
      });
    }
    if (!out.length) throw new LiveError(502, 'iTunes TV chart returned no titles');
    return out;
  });
}

async function topMovies(gid) {
  return cached(`feed:movie:${gid || 'all'}`, FEED_TTL_MS, async () => {
    const url = `https://itunes.apple.com/us/rss/topmovies/limit=100${gid ? `/genre=${gid}` : ''}/json`;
    const data = await fetchJson(url);
    const seen = new Set();
    const out = [];
    for (const e of asArray(data?.feed?.entry)) {
      const genre = e?.category?.attributes?.label || '';
      if (genre === MOVIE_ANIME_GENRE) continue;
      const id = e?.id?.attributes?.['im:id'];
      if (!id || !/^\d+$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      const trailer = asArray(e?.link).map((l) => l?.attributes).find((a) => a?.rel === 'enclosure' && isHttpUrl(a?.href));
      out.push({
        liveId: `itunes:${id}`,
        kind: 'movie',
        title: e?.['im:name']?.label || 'Untitled',
        subtitle: e?.['im:artist']?.label ? `Dir. ${e['im:artist'].label}` : '',
        year: yearOf(e?.['im:releaseDate']?.attributes?.label || e?.['im:releaseDate']?.label),
        poster: appleArt(rssImage(e), 400, 600),
        genres: genre ? [genre] : [],
        rating: null,
        status: '',
        network: '',
        summary: stripHtml(e?.summary?.label || ''),
        trailer: trailer ? trailer.href : '',
      });
    }
    if (!out.length) throw new LiveError(502, 'iTunes movie chart returned no titles');
    return out;
  });
}

async function itunesLookup(id) {
  return cached(`itlookup:${id}`, DETAIL_TTL_MS, async () => {
    const data = await fetchJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&country=US`);
    return asArray(data?.results)[0] || null;
  });
}

// -----------------------------------------------------------------------------
// TV
// -----------------------------------------------------------------------------
function applyTvMap(item) {
  const m = tvMapGet(item.title);
  if (!m || !m.id) return item;
  if (m.type === TV_ANIMATION_GENRE) return null;
  return {
    ...item,
    tvmazeId: m.id,
    poster: m.poster || item.poster,
    rating: m.rating ?? null,
    status: m.status || '',
    network: m.network || '',
    genres: m.genres?.length ? m.genres : item.genres,
  };
}

function tvmazeToItem(s) {
  const sum = tvmazeSummary(s);
  return {
    liveId: `tvmaze:${s.id}`,
    kind: 'tv',
    title: s.name || 'Untitled',
    subtitle: sum.network,
    year: yearOf(s.premiered),
    poster: sum.poster,
    genres: sum.genres,
    rating: sum.rating,
    status: sum.status,
    network: sum.network,
    summary: stripHtml(s.summary),
    tvmazeId: s.id,
  };
}

async function tvmazeShow(id) {
  return cached(`tvshow:${id}`, DETAIL_TTL_MS, () =>
    fetchJson(`https://api.tvmaze.com/shows/${id}?embed[]=seasons&embed[]=cast`, { limiter: tvmazeLimiter }));
}

async function tvDetails(type, rawId) {
  let itunes = null;
  let tvmazeId = null;
  if (type === 'tvmaze') {
    tvmazeId = parseInt(rawId, 10);
  } else {
    itunes = await itunesLookup(rawId);
    if (itunes) {
      const m = await resolveTvmaze(itunes.artistName || '', yearOf(itunes.releaseDate)).catch((err) => {
        console.warn(`[AnimePulse] live: TVmaze match failed for "${itunes.artistName}": ${err.message}`);
        return null;
      });
      tvmazeId = m?.id || null;
    }
  }
  let show = null;
  if (tvmazeId) {
    try { show = await tvmazeShow(tvmazeId); } catch (err) {
      if (!itunes) throw err;
      console.warn(`[AnimePulse] live: TVmaze show ${tvmazeId} unavailable: ${err.message}`);
    }
  }
  if (!show && !itunes) throw new LiveError(404, 'Title not found');

  const title = show?.name || itunes?.artistName || itunes?.collectionName || 'Untitled';
  const seasons = asArray(show?._embedded?.seasons).map((s) => ({
    number: s.number,
    name: s.name || '',
    episodes: s.episodeOrder ?? null,
    premiere: s.premiereDate || '',
    end: s.endDate || '',
  })).filter((s) => Number.isFinite(s.number));
  const cast = asArray(show?._embedded?.cast).slice(0, 12).map((c) => ({
    name: c?.person?.name || '',
    character: c?.character?.name || '',
    image: c?.person?.image?.medium || '',
  })).filter((c) => c.name);
  const network = show?.network?.name || show?.webChannel?.name || '';
  const year = yearOf(show?.premiered) || yearOf(itunes?.releaseDate);
  const imdb = show?.externals?.imdb && /^tt\d+$/.test(show.externals.imdb) ? show.externals.imdb : '';
  const officialSite = [show?.officialSite, show?.webChannel?.officialSite, show?.network?.officialSite].find(isHttpUrl) || '';

  return {
    liveId: `${type}:${rawId}`,
    kind: 'tv',
    title,
    subtitle: itunes ? seasonLabel(itunes.collectionName, itunes.artistName || title) : network,
    year,
    poster: show?.image?.original || show?.image?.medium || appleArt(itunes?.artworkUrl100, 600, 600),
    genres: show?.genres?.length ? show.genres : (itunes?.primaryGenreName ? [itunes.primaryGenreName] : []),
    rating: show?.rating?.average ?? null,
    status: show?.status || '',
    network,
    runtime: show?.averageRuntime || show?.runtime || null,
    premiered: show?.premiered || '',
    ended: show?.ended || '',
    contentRating: itunes?.contentAdvisoryRating || '',
    summary: stripHtml(show?.summary) || stripHtml(itunes?.longDescription),
    seasons,
    cast,
    trailer: '',
    imdb,
    source: show ? (itunes ? 'TVmaze + iTunes' : 'TVmaze') : 'iTunes',
    links: watchLinks({ title, year, kind: 'tv', officialSite, networkName: network, appleUrl: itunes?.collectionViewUrl, imdb }),
  };
}

// -----------------------------------------------------------------------------
// Movies
// -----------------------------------------------------------------------------
function imdbToItem(d) {
  return {
    liveId: `imdb:${d.id}`,
    kind: 'movie',
    title: d.l || 'Untitled',
    subtitle: d.s || '',
    year: Number.isFinite(d.y) ? d.y : null,
    poster: imdbArt(d.i?.imageUrl, 400),
    genres: [],
    rating: null,
    status: '',
    network: '',
    summary: '',
    imdb: d.id,
  };
}

async function imdbSuggest(q) {
  const first = (q.trim()[0] || 'x').toLowerCase();
  const bucket = /[a-z0-9]/.test(first) ? first : 'x';
  const data = await fetchJson(`https://v3.sg.media-imdb.com/suggestion/${bucket}/${encodeURIComponent(q.trim().toLowerCase().slice(0, 80))}.json`);
  return asArray(data?.d);
}

async function wikidataByImdb(tt) {
  const search = await fetchJson(`https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P345=${tt}`)}&srlimit=1&format=json`);
  const qid = asArray(search?.query?.search)[0]?.title;
  if (!qid || !/^Q\d+$/.test(qid)) return null;
  const ent = (await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels|descriptions|claims|sitelinks&languages=en&sitefilter=enwiki&format=json`))?.entities?.[qid];
  if (!ent) return null;
  const ids = (prop, n) => asArray(ent.claims?.[prop]).map((c) => c?.mainsnak?.datavalue?.value?.id).filter((x) => /^Q\d+$/.test(x || '')).slice(0, n);
  const directors = ids('P57', 3);
  const genres = ids('P136', 6);
  const cast = ids('P161', 10);
  const rating = ids('P1657', 1);
  const want = [...new Set([...directors, ...genres, ...cast, ...rating])];
  let labels = {};
  if (want.length) {
    const lab = await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${want.join('|')}&props=labels&languages=en&format=json`).catch(() => null);
    for (const [id, e] of Object.entries(lab?.entities || {})) labels[id] = e?.labels?.en?.value || '';
  }
  const name = (id) => labels[id] || '';
  const minutes = parseFloat(asArray(ent.claims?.P2047)[0]?.mainsnak?.datavalue?.value?.amount);
  return {
    label: ent.labels?.en?.value || '',
    description: ent.descriptions?.en?.value || '',
    wiki: ent.sitelinks?.enwiki?.title || '',
    year: yearOf(asArray(ent.claims?.P577)[0]?.mainsnak?.datavalue?.value?.time),
    runtime: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null,
    directors: directors.map(name).filter(Boolean),
    genres: genres.map(name).filter(Boolean).map((g) => g.replace(/\s+film$/i, '')),
    cast: cast.map(name).filter(Boolean),
    contentRating: rating.map(name).filter(Boolean)[0] || '',
  };
}

async function wikipediaSummary(title) {
  const data = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  return data ? { extract: data.extract || '', image: data.originalimage?.source || data.thumbnail?.source || '' } : null;
}

async function movieDetailsItunes(rawId) {
  const r = await itunesLookup(rawId);
  if (!r) {
    // Pulled from the store since the chart was cached: fall back to the chart entry.
    for (const [key, entry] of memo) {
      if (!key.startsWith('feed:movie:') || !Array.isArray(entry.value)) continue;
      const item = entry.value.find((x) => x.liveId === `itunes:${rawId}`);
      if (item) return { ...item, cast: [], seasons: [], runtime: null, contentRating: '', source: 'iTunes chart', links: watchLinks({ title: item.title, year: item.year, kind: 'movie' }) };
    }
    throw new LiveError(404, 'Movie not found');
  }
  const title = r.trackName || 'Untitled';
  const year = yearOf(r.releaseDate);
  return {
    liveId: `itunes:${rawId}`,
    kind: 'movie',
    title,
    subtitle: r.artistName ? `Dir. ${r.artistName}` : '',
    year,
    poster: appleArt(r.artworkUrl100, 600, 900),
    genres: r.primaryGenreName ? [r.primaryGenreName] : [],
    rating: null,
    status: '',
    network: '',
    runtime: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 60000) : null,
    contentRating: r.contentAdvisoryRating || '',
    summary: stripHtml(r.longDescription || r.shortDescription || ''),
    seasons: [],
    cast: [],
    directors: r.artistName ? [r.artistName] : [],
    trailer: isHttpUrl(r.previewUrl) ? r.previewUrl : '',
    imdb: '',
    source: 'iTunes',
    links: watchLinks({ title, year, kind: 'movie', appleUrl: r.trackViewUrl }),
  };
}

async function movieDetailsImdb(tt) {
  const [sug, wd] = await Promise.allSettled([
    cached(`imdbid:${tt}`, DETAIL_TTL_MS, async () => asArray((await fetchJson(`https://v3.sg.media-imdb.com/suggestion/t/${tt}.json`))?.d).find((d) => d?.id === tt) || null),
    cached(`wikidata:${tt}`, DETAIL_TTL_MS, () => wikidataByImdb(tt)),
  ]);
  const s = sug.status === 'fulfilled' ? sug.value : null;
  const w = wd.status === 'fulfilled' ? wd.value : null;
  let wiki = null;
  if (w?.wiki) wiki = await cached(`wikipedia:${w.wiki}`, DETAIL_TTL_MS, () => wikipediaSummary(w.wiki)).catch(() => null);
  if (!s && !w) {
    const reason = [sug, wd].find((x) => x.status === 'rejected')?.reason?.message;
    throw new LiveError(reason ? 502 : 404, reason || 'Movie not found');
  }
  const title = s?.l || w?.label || 'Untitled';
  const year = (Number.isFinite(s?.y) ? s.y : null) || w?.year || null;
  return {
    liveId: `imdb:${tt}`,
    kind: 'movie',
    title,
    subtitle: w?.directors?.length ? `Dir. ${w.directors.join(', ')}` : (s?.s || ''),
    year,
    poster: imdbArt(s?.i?.imageUrl, 600) || wiki?.image || '',
    genres: w?.genres || [],
    rating: null,
    status: '',
    network: '',
    runtime: w?.runtime || null,
    contentRating: w?.contentRating || '',
    summary: wiki?.extract || w?.description || '',
    seasons: [],
    cast: (w?.cast?.length ? w.cast : String(s?.s || '').split(',').map((x) => x.trim()).filter(Boolean)).map((n) => ({ name: n, character: '', image: '' })),
    directors: w?.directors || [],
    trailer: '',
    imdb: tt,
    source: [s && 'IMDb', w && 'Wikidata', wiki && 'Wikipedia'].filter(Boolean).join(' + '),
    links: watchLinks({ title, year, kind: 'movie', imdb: tt }),
  };
}

// -----------------------------------------------------------------------------
// Where to watch (legal sources only)
// -----------------------------------------------------------------------------
function watchLinks({ title, year, kind, officialSite = '', networkName = '', appleUrl = '', imdb = '' }) {
  const q = encodeURIComponent(title);
  const links = [];
  if (isHttpUrl(officialSite)) links.push({ name: networkName ? `${networkName} (Official)` : 'Official Site', tag: 'Official', url: officialSite });
  if (isHttpUrl(appleUrl)) links.push({ name: 'Apple TV', tag: 'Buy / Rent', url: appleUrl });
  links.push({ name: 'JustWatch', tag: 'Every Service', url: `https://www.justwatch.com/us/search?q=${q}` });
  links.push({ name: 'Tubi', tag: 'Free', url: `https://tubitv.com/search/${q}` });
  links.push({ name: 'The Roku Channel', tag: 'Free', url: `https://therokuchannel.roku.com/search/${q}` });
  links.push({ name: 'Plex', tag: 'Free', url: `https://watch.plex.tv/search?q=${q}` });
  links.push({
    name: 'IMDb',
    tag: 'Info',
    url: imdb ? `https://www.imdb.com/title/${imdb}/` : `https://www.imdb.com/find/?q=${encodeURIComponent(year ? `${title} ${year}` : title)}`,
  });
  const trailerQuery = [title, year, kind === 'tv' ? 'series' : 'movie', 'trailer'].filter(Boolean).join(' ');
  links.push({ name: 'YouTube', tag: 'Trailer', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(trailerQuery)}` });
  return links;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------
function checkKind(kind) {
  if (kind !== 'tv' && kind !== 'movie') throw new LiveError(400, 'kind must be "tv" or "movie"');
  return kind;
}

function paginate(list, page) {
  const lastPage = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(Math.max(Number.isFinite(page) ? page : 1, 1), lastPage);
  return {
    media: list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    pageInfo: { total: list.length, currentPage: current, lastPage, hasNextPage: current < lastPage },
  };
}

// "since" keeps titles released in/after that year. A TV show also stays if it is still
// running (its newest season is current even when the show premiered earlier).
function parseSince(since) {
  if (since == null || since === '') return null;
  const y = parseInt(since, 10);
  if (!Number.isFinite(y) || y < 1900 || y > 2100) throw new LiveError(400, 'since must be a year between 1900 and 2100');
  return y;
}
const isRecent = (item, since) => since == null
  || (Number.isFinite(item.year) && item.year >= since)
  || (item.kind === 'tv' && item.status === 'Running');

export async function liveFeed({ kind, genre, page, since }) {
  checkKind(kind);
  const gid = genreId(kind, genre);
  const sinceYear = parseSince(since);
  const pageNum = parseInt(page || '1', 10);
  if (kind === 'movie') return paginate((await topMovies(gid)).filter((m) => isRecent(m, sinceYear)), pageNum);

  const shows = await topTvShows(gid);
  const build = () => paginate(shows.map(applyTvMap).filter((i) => i && isRecent(i, sinceYear)), pageNum);
  let result = build();
  // Look up unmapped shows on this page (posters/ratings) and, with a year filter, older-season
  // shows too: only TVmaze knows whether they are still running.
  const onPage = new Set(result.media.map((i) => i.liveId));
  const unmapped = shows.filter((i) => tvMapGet(i.title) === undefined
    && (onPage.has(i.liveId) || (sinceYear != null && !isRecent(i, sinceYear))));
  if (unmapped.length) {
    // Wait briefly for posters/ratings; anything slower finishes in the background for the next load.
    const job = Promise.allSettled(unmapped.map((i) => resolveTvmaze(i.title, i.year)));
    await Promise.race([job, sleep(TV_MAP_BUDGET_MS)]);
    result = build();
  }
  return result;
}

export async function liveSearch({ kind, q }) {
  checkKind(kind);
  const query = String(q || '').trim().slice(0, 100);
  if (!query) return { media: [] };
  if (kind === 'tv') {
    const media = await cached(`search:tv:${query.toLowerCase()}`, SEARCH_TTL_MS, async () =>
      asArray(await fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, { limiter: tvmazeLimiter }))
        .map((r) => r?.show).filter((s) => s && s.id && s.type !== TV_ANIMATION_GENRE).map(tvmazeToItem));
    return { media };
  }
  try {
    const media = await cached(`search:movie:${query.toLowerCase()}`, SEARCH_TTL_MS, async () =>
      (await imdbSuggest(query)).filter((d) => /^tt\d+$/.test(d?.id || '') && (d.qid === 'movie' || d.qid === 'tvMovie')).map(imdbToItem));
    return { media };
  } catch (err) {
    // IMDb's suggestion feed is unofficial; fall back to titles already in the cached charts.
    console.warn(`[AnimePulse] live: movie search source failed: ${err.message}`);
    const needle = normName(query);
    const local = [];
    const seen = new Set();
    for (const [key, entry] of memo) {
      if (!key.startsWith('feed:movie:') || !Array.isArray(entry.value)) continue;
      for (const item of entry.value) {
        if (!seen.has(item.liveId) && normName(item.title).includes(needle)) { seen.add(item.liveId); local.push(item); }
      }
    }
    return { media: local, notice: 'Movie search source is unavailable right now; showing matches from the current charts only.' };
  }
}

export async function liveDetails(liveId) {
  const m = String(liveId || '').match(/^(tvmaze|itunes-tv|itunes|imdb):(\d+|tt\d+)$/);
  if (!m || (m[1] === 'imdb') !== m[2].startsWith('tt')) throw new LiveError(400, 'Invalid live title id');
  const [, type, rawId] = m;
  if (type === 'tvmaze' || type === 'itunes-tv') return tvDetails(type, rawId);
  if (type === 'itunes') return movieDetailsItunes(rawId);
  return movieDetailsImdb(rawId);
}

// Warm the charts and the TVmaze map at startup so the first visit has posters and ratings.
export function prewarmLiveCatalog() {
  const t = setTimeout(async () => {
    try {
      await topMovies(null);
      const shows = await topTvShows(null);
      const pending = shows.filter((s) => tvMapGet(s.title) === undefined);
      await Promise.allSettled(pending.map((s) => resolveTvmaze(s.title, s.year)));
      console.log(`[AnimePulse] live catalog warmed (${shows.length} shows, ${pending.length} newly matched on TVmaze)`);
    } catch (err) {
      console.warn(`[AnimePulse] live catalog prewarm failed: ${err.message}`);
    }
  }, 3000);
  t.unref?.();
}
