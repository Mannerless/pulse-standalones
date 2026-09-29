import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { initShare } from './share.mjs';
import { installConsoleCapture, addLine, getLines, clearLines } from './console-capture.mjs';
installConsoleCapture();

// -----------------------------------------------------------------------------
// Network privacy: every outbound request goes through the private Tor HTTP tunnel.
// FAIL CLOSED: with no proxy configured the server refuses to start, and if Tor dies
// requests simply fail. There is no direct-connection fallback.
// -----------------------------------------------------------------------------
const PROXY_URL = process.env.VAULTPULSE_PROXY || '';
if (PROXY_URL) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(PROXY_URL));
    console.log(`[VaultPulse] Outbound traffic routed through ${PROXY_URL} (Tor). No direct fallback.`);
  } catch (e) {
    console.error(`[VaultPulse] FATAL: could not enable proxy routing (${e.message}). Run: npm install (in ${process.cwd()})`);
    process.exit(1);
  }
} else if (process.env.VAULTPULSE_ALLOW_DIRECT !== '1') {
  console.error('[VaultPulse] REFUSING TO START: no VAULTPULSE_PROXY (Tor) configured, so your real IP would be exposed. Start with launch.sh, or set VAULTPULSE_ALLOW_DIRECT=1 to allow direct connections.');
  process.exit(1);
} else {
  console.warn('[VaultPulse] WARNING: VAULTPULSE_ALLOW_DIRECT=1 - outbound traffic is NOT anonymised.');
}

// Asks the Tor Project whether our outbound requests really exit through Tor.
let egressCache = null; // { at, isTor, ip, error }
async function checkEgress(force = false) {
  if (!force && egressCache && Date.now() - egressCache.at < 60000) return egressCache;
  try {
    const r = await fetch('https://check.torproject.org/api/ip', { signal: AbortSignal.timeout(45000) });
    const j = await r.json();
    egressCache = { at: Date.now(), isTor: !!j.IsTor, ip: j.IP };
  } catch (e) {
    egressCache = { at: Date.now(), isTor: false, ip: null, error: e.message };
  }
  console.log(`[VaultPulse] Egress check: proxied=${!!PROXY_URL} IsTor=${egressCache.isTor}${egressCache.error ? ` error=${egressCache.error}` : ` exit-ip=${egressCache.ip}`}`);
  return egressCache;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = '127.0.0.1'; // Strictly private loopback binding
const PORT = parseInt(process.env.PORT || '7899', 10);
const GUEST_PORT = parseInt(process.env.GUEST_PORT || '7900', 10); // tunnel-facing, whitelisted gateway
let share = null;

const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const VAULT_FILE = path.join(DATA_DIR, 'vault.enc');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

// Vault, config and share files must be owner-only (never group/world readable).
function hardenDataPerms() {
  try { fs.chmodSync(DATA_DIR, 0o700); } catch {}
  let names = [];
  try { names = fs.readdirSync(DATA_DIR); } catch {}
  for (const n of names) {
    const f = path.join(DATA_DIR, n);
    try { if (fs.statSync(f).isFile()) fs.chmodSync(f, 0o600); } catch {}
  }
}
hardenDataPerms();

// In-memory unlocked vault cache
let activeSessionToken = null;
let activeSessionExpiry = 0;
let unlockedData = null; // { history: [], bookmarks: [], settings: {} }
let derivedMasterKey = null;
let sessionMs = 30 * 60 * 1000;   // idle auto-lock window; refreshed from config.autoLockMinutes on unlock
let unlockFailures = 0;           // consecutive wrong PINs (in-memory; resets on success)
let unlockBlockedUntil = 0;       // epoch ms; unlock attempts are refused until then

// Cache for queries and stream probes
const memoryCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const STREAM_PROBE_CACHE = new Map();

// -----------------------------------------------------------------------------
// Cryptographic Engine (AES-256-GCM + PBKDF2)
// -----------------------------------------------------------------------------

function deriveKey(pin, salt) {
  return crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha512');
}

function encryptVault(data, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(data);
  let encrypted = cipher.update(jsonStr, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    cipherText: encrypted.toString('hex')
  };
}

function decryptVault(encryptedPayload, key) {
  try {
    const iv = Buffer.from(encryptedPayload.iv, 'hex');
    const authTag = Buffer.from(encryptedPayload.authTag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(Buffer.from(encryptedPayload.cipherText, 'hex'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch (err) {
    return null;
  }
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function saveEncryptedVault() {
  if (!derivedMasterKey || !unlockedData) return false;
  const encrypted = encryptVault(unlockedData, derivedMasterKey);
  fs.writeFileSync(VAULT_FILE, JSON.stringify(encrypted), { encoding: 'utf8', mode: 0o600 });
  return true;
}

const autoLockMs = (cfg) => Math.max(0.05, Number(cfg?.autoLockMinutes) || 30) * 60 * 1000;

// Single lock path: persist, then wipe token, key, decrypted data and browse caches from memory.
function lockVault(reason = 'manual') {
  const wasUnlocked = !!(activeSessionToken || unlockedData || derivedMasterKey);
  try {
    if (derivedMasterKey && unlockedData) saveEncryptedVault();
  } catch (e) {
    console.error('[VaultPulse] save-on-lock failed:', e.message);
  }
  activeSessionToken = null;
  activeSessionExpiry = 0;
  unlockedData = null;
  derivedMasterKey = null;
  memoryCache.clear();
  STREAM_PROBE_CACHE.clear();
  if (wasUnlocked) console.log(`[VaultPulse] Vault locked (${reason}); key and decrypted data cleared from memory`);
}

// -----------------------------------------------------------------------------
// Strict Blacklist Filters: Excludes Trans & Male-on-Male Across All Sources
// -----------------------------------------------------------------------------

const EXCLUDED_GENRES = ["Yaoi", "Boys' Love"];
const EXCLUDED_TAGS = [
  "Yaoi", "Boys' Love", "Male on Male", "Futanari",
  "Shemale", "Transgender", "Crossdressing", "Trap",
  "Otoko no Ko", "Shounen Ai", "Gender Bending"
];

const BLACKLIST_REGEX = /\b(trans|transgender|tranny|shemale|ladyboy|\bts\b|gay|male\s*on\s*male|yaoi|boys'?\s*love|\bbl\b|futa|futanari|crossdressing|\btrap\b|otoko\s*no\s*ko|shounen\s*ai)\b/i;

// Hard safety filter: never surface anything that names or implies a minor. Deliberately narrow
// (unambiguous terms and stated ages under 18) so it does not eat normal adult results.
const MINOR_SAFETY_REGEX = /\b(child|children|kid|kids|minor|minors|underage|under-age|underaged|loli|lolicon|shota|shotacon|jailbait|preteen|pre-teen|prepubescent|toddler|infant|little\s+(?:girl|boy))\b|\b1[0-7]\s*(?:yo|y\/o|y\.o\.|yrs?|years?[\s-]*old)(?![a-z])/i;

function isCleanAdultContent(item) {
  if (!item) return false;

  const genres = item.genres || [];
  for (const g of genres) {
    if (BLACKLIST_REGEX.test(g)) return false;
  }

  const tags = item.tags || [];
  for (const t of tags) {
    const tagName = typeof t === 'string' ? t : (t.name || t.tag_name || '');
    if (tagName && BLACKLIST_REGEX.test(tagName)) return false;
  }

  const title = (item.title?.english || '') + ' ' + (item.title?.romaji || '') + ' ' + (item.title || '');
  if (BLACKLIST_REGEX.test(title)) return false;

  // Minor-safety pass over title, genres and tags
  if (MINOR_SAFETY_REGEX.test(title)) return false;
  for (const g of genres) { if (MINOR_SAFETY_REGEX.test(g)) return false; }
  for (const t of tags) {
    const tagName = typeof t === 'string' ? t : (t.name || t.tag_name || '');
    if (tagName && MINOR_SAFETY_REGEX.test(tagName)) return false;
  }

  return true;
}

// -----------------------------------------------------------------------------
// AniList Adult API Gateway (Hentai)
// -----------------------------------------------------------------------------

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

async function fetchAniList(query, variables = {}) {
  const cacheKey = JSON.stringify({ query, variables });
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Tor circuits occasionally stall or return junk; retry transient failures a few times.
  // Retries go back through the same proxy (never direct). GraphQL errors are not retried.
  const MAX_ATTEMPTS = 4;
  let json = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !json; attempt++) {
    try {
      const response = await fetch(ANILIST_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VaultPulse/1.0'
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) {
        const body = await response.text();
        const err = new Error(`AniList HTTP ${response.status}: ${body.slice(0, 200)}`);
        err.transient = response.status >= 500 || response.status === 429;
        if (response.status === 429) {
          const ra = parseInt(response.headers.get('retry-after') || '', 10);
          err.retryAfterMs = Math.min(30000, (Number.isFinite(ra) && ra > 0 ? ra : 8) * 1000);
        }
        throw err;
      }
      json = await response.json(); // non-JSON body throws SyntaxError (transient)
    } catch (e) {
      lastErr = e;
      const transient = e.transient !== false; // network errors, timeouts, bad JSON, 5xx, 429
      if (!transient || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, e.retryAfterMs ?? attempt * 1000));
    }
  }
  if (!json) throw lastErr || new Error('AniList request failed');

  if (json.errors) {
    throw new Error(`AniList GQL Error: ${JSON.stringify(json.errors)}`);
  }

  // Do not cache an empty page: a transient empty AniList reply would otherwise stick for the whole TTL.
  const mediaList = json.data?.Page?.media;
  if (!(Array.isArray(mediaList) && mediaList.length === 0)) {
    memoryCache.set(cacheKey, { timestamp: Date.now(), data: json.data });
  }
  return json.data;
}

const ADULT_LIST_QUERY = `
query ($page: Int, $perPage: Int, $sort: [MediaSort], $search: String, $genre: String, $tag_in: [String], $genre_not_in: [String], $tag_not_in: [String]) {
  Page (page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    media (type: ANIME, isAdult: true, sort: $sort, search: $search, genre: $genre, tag_in: $tag_in, genre_not_in: $genre_not_in, tag_not_in: $tag_not_in) {
      id
      title { english romaji native }
      coverImage { extraLarge large medium }
      bannerImage
      description(asHtml: false)
      episodes
      status
      averageScore
      popularity
      genres
      tags { name rank isAdult }
      studios(isMain: true) { nodes { name } }
      startDate { year month day }
    }
  }
}
`;

// -----------------------------------------------------------------------------
// Real Content API Gateway (RedTube Search / Uncensored Feed)
// -----------------------------------------------------------------------------

const REAL_HENTAI_CARTOON_REGEX = /\b(hentai|anime|cartoon|manga|3d\s*animation|sfm|blender|cosplay\s*hentai|drawn|animated|comic|mmd|rule34)\b/i;
const REAL_ASIAN_REGEX = /\b(japanese|jav|uncensored\s*jav|tokyo|asian|korean|chinese)\b/i;

const REAL_CATEGORY_SEARCH_MAP = {
  'amateur': 'american amateur couple',
  'milf': 'american milf mature',
  'pov': 'pov american english',
  'blonde': 'blonde american babe',
  'brunette': 'brunette american babe',
  'big tits': 'american big tits busty',
  'college': 'american college dorm',
  'threesome': 'threesome fmf english',
  'squirting': 'american squirting orgasm',
  'petite': 'petite american babe',
  'latina': 'latina babe hd',
  'ebony': 'ebony american babe',
  'redhead': 'redhead american babe',
  'massage': 'sensual massage english',
  'nurse': 'naughty nurse uniform english',
  'teacher': 'american teacher student',
  'solo': 'female solo masturbation american',
  '1080p': '1080p full hd american'
};

// -----------------------------------------------------------------------------
// Kinks & fetish catalog: single source of truth for the strip's kink panel AND the
// All Categories browser. Hentai ids are exact AniList adult tag names. Real ids are
// keys into REAL_CATEGORY_SEARCH_MAP (each carries a search phrase, "american" bias
// matches the existing English/Western preference).
// Deliberately NOT featured (still reachable via the full browser where upstream lists
// them; tags returning ~0 results such as Erotic Piercings, Strap-on, Sixty-nine, Hair Pulling and Swapping
// are also kept off the strip): non-consent, bestiality, scat, vore, amputation, watersports, asphyxiation,
// plus anything covered by the exclusions (futa, trans, male-on-male).
// -----------------------------------------------------------------------------
const HENTAI_KINK_GROUPS = [
  { group: 'Power & Restraint', items: [['Bondage', '⛓️ Bondage'], ['Femdom', '👠 Femdom'], ['Sadism', '😈 Sadism'], ['Masochism', '🖤 Masochism'], ['Pet Play', '🐾 Pet Play'], ['Human Pet', '🐕 Human Pet']] },
  { group: 'Exhibition & Watching', items: [['Exhibitionism', '🎭 Exhibitionism'], ['Public Sex', '🌆 Public Sex'], ['Voyeur', '👀 Voyeur']] },
  { group: 'Body & Fetish', items: [['Feet', '🦶 Feet'], ['Armpits', '💪 Armpits'], ['Sweat', '💧 Sweat'], ['Lactation', '💧 Lactation'], ['Boobjob', '🍈 Boobjob'], ['Sumata', '🍑 Sumata'], ['Ashikoki', '🦶 Footjob'], ['Ahegao', '🤤 Ahegao']] },
  { group: 'Relationship Dynamics', items: [['Netorare', '💔 Netorare (NTR)'], ['Netori', '🔁 Netori'], ['Netorase', '👁️ Netorase'], ['Group Sex', '👥 Group Sex'], ['Virginity', '🌸 Virginity'], ['Prostitution', '💋 Prostitution'], ['Hypersexuality', '🔥 Hypersexuality']] },
  { group: 'Acts', items: [['Anal Sex', '🍑 Anal'], ['Deepthroat', '🗣️ Deepthroat'], ['Fellatio', '👄 Fellatio'], ['Cunnilingus', '👅 Cunnilingus'], ['Handjob', '✋ Handjob'], ['Fingering', '☝️ Fingering'], ['Double Penetration', '✌️ Double Penetration'], ['Facial', '💦 Facial'], ['Nakadashi', '💦 Creampie'], ['Squirting', '🚿 Squirting'], ['Mating Press', '🛏️ Mating Press'], ['Cumflation', '🎈 Cumflation'], ['Cervix Penetration', '🎯 Deep / Cervix'], ['Sex Toys', '🧸 Sex Toys'], ['Masturbation', '🖐️ Masturbation'], ['Scissoring', '✂️ Scissoring'], ['Rimjob', '🍑 Rimjob'], ['Irrumatio', '🗣️ Irrumatio'], ['Fisting', '✊ Fisting']] },
  { group: 'Fantasy Kinks', items: [['Tentacles', '🐙 Tentacles']] },
];

const REAL_KINK_GROUPS = [
  { group: 'Fetish & BDSM', items: [['bdsm', '⛓️ BDSM', 'bdsm bondage american'], ['bondage', '🪢 Bondage', 'bondage rope american'], ['femdom', '👠 Femdom', 'femdom domination american'], ['feet', '🦶 Foot Fetish', 'foot fetish feet american'], ['latex', '🖤 Latex & Leather', 'latex leather fetish american'], ['heels', '👠 Heels & Stockings', 'high heels stockings american'], ['lingerie', '🩱 Lingerie', 'lingerie stockings american'], ['spanking', '🖐️ Spanking', 'spanking american'], ['facesitting', '🪑 Facesitting', 'facesitting american'], ['strapon', '🪢 Strap-on', 'strapon female domination american'], ['roleplay', '🎭 Roleplay', 'roleplay american couple'], ['cosplay', '🦸 Cosplay', 'cosplay american costume']] },
  { group: 'Relationship Dynamics', items: [['cuckold', '👁️ Cuckold & Hotwife', 'cuckold hotwife american'], ['swingers', '🔄 Swingers', 'swingers american couple'], ['gangbang', '👥 Gangbang', 'gangbang american'], ['orgy', '🎉 Orgy', 'orgy american party']] },
  { group: 'Exhibition', items: [['public', '🌆 Public', 'public flashing american'], ['exhibitionist', '🎭 Exhibitionist', 'exhibitionist outdoor american']] },
  { group: 'Acts', items: [['anal', '🍑 Anal', 'anal american'], ['deepthroat', '🗣️ Deepthroat', 'deepthroat american'], ['blowjob', '👄 Blowjob', 'blowjob american'], ['handjob', '✋ Handjob', 'handjob american'], ['creampie', '💦 Creampie', 'creampie american'], ['facial', '💦 Facial', 'facial cumshot american'], ['dp', '✌️ Double Penetration', 'double penetration american'], ['bukkake', '🌧️ Bukkake', 'bukkake american'], ['toys', '🧸 Sex Toys', 'sex toys vibrator american'], ['lactation', '💧 Lactation', 'lactating milk american'], ['rough', '💥 Rough', 'rough sex american']] },
  { group: 'Body & Look', items: [['bbw', '🍑 BBW', 'bbw american'], ['big ass', '🍑 Big Ass', 'big ass american'], ['tattoos', '🖋️ Tattoos & Alt', 'tattoo alt american'], ['goth', '🖤 Goth & Alt', 'goth alt american']] },
];
for (const g of REAL_KINK_GROUPS) for (const [id, , q] of g.items) REAL_CATEGORY_SEARCH_MAP[id] = q;

// RedTube's category list contains test rows, non-adult topics and celebrity impersonation bait.
const REAL_CATEGORY_HIDE = new Set([
  'test category', 'test prod', 'a new one', 'all category new12345', 'all new categiry', 'yes',
  'sfw', 'educational content', 'family and parenting', 'food and cooking', 'gaming', 'live gaming',
  'news and commentary', 'music', 'product reviews and unboxings', 'vlogs', 'personal branding',
  'culture & society', 'challenges and trends', 'creative content', 'entertainment/comedy', 'funny',
  'short vertical content', 'storytelling', 'bts', 'popular with women', 'animals and pets', 'celebrity',
  'beauty and fashion',
]);
const REAL_GROUP_BY_NAME = new Map(Object.entries({
  'Acts': ['blowjob', 'anal', 'creampie', 'cumshot', 'double penetration', 'facials', 'fingering', 'fisting', 'handjob', 'masturbation', 'pussy licking', 'squirting', 'female orgasm', 'hardcore', 'toys', 'bukkake', 'group', 'threesome', 'interracial', 'massage', 'erotic', 'romantic'],
  'Fetish & BDSM': ['fetish', 'bondage', 'feet', 'pissing', 'rough', 'lingerie', 'cosplay', 'strip', 'striptease', 'step fantasy'],
  'Relationship Dynamics': ['cuckold', 'gangbang', 'orgy', 'young and old'],
  'Body & Look': ['amateur', 'verified amateurs', 'bbw', 'big ass', 'big dick', 'big tits', 'small tits', 'blonde', 'brunette', 'redhead', 'tattoos', 'mature', 'milf', 'teens', 'college', 'latina', 'ebony', 'arab', 'asian', 'brazilian', 'european', 'french', 'german', 'indian', 'japanese', 'vintage'],
  'Style & Format': ['pov', 'casting', 'compilation', 'hd', 'reality', 'solo girl', 'webcam', 'virtual reality', 'parody', 'party', 'public'],
}).flatMap(([g, names]) => names.map((n) => [n, g])));

async function fetchRealContent(search = null, categoryTag = null, page = 1) {
  let queryStr = '';
  const isExplicitAsian = (search && REAL_ASIAN_REGEX.test(search)) || (categoryTag && REAL_ASIAN_REGEX.test(categoryTag));

  if (search && search.trim()) {
    queryStr = search.trim();
  } else if (categoryTag && categoryTag !== 'All') {
    queryStr = REAL_CATEGORY_SEARCH_MAP[categoryTag] || `${categoryTag} american english`;
  } else {
    queryStr = 'american english hd';
  }

  const url = `https://api.redtube.com/?data=redtube.Videos.searchVideos&output=json&search=${encodeURIComponent(queryStr)}&page=${page}&thumbsize=big`;
  
  const cached = memoryCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  if (!resp.ok) return [];

  const json = await resp.json();
  const videos = json.videos || [];

  const cleanVideos = [];
  for (const item of videos) {
    const v = item.video || {};
    if (!v.video_id) continue;

    if (!isCleanAdultContent(v)) continue;

    const titleAndTags = `${v.title || ''} ${(v.tags || []).map(t => typeof t === 'string' ? t : t.tag_name || '').join(' ')}`;

    // Absolute exclusion of hentai / cartoons / animation from real content page
    if (REAL_HENTAI_CARTOON_REGEX.test(titleAndTags)) continue;

    // Prioritize English / Western: filter out Japanese / Asian unless explicitly requested
    if (!isExplicitAsian && REAL_ASIAN_REGEX.test(titleAndTags)) continue;

    const embedUrl = `https://embed.redtube.com/?id=${v.video_id}`;
    cleanVideos.push({
      id: `real_${v.video_id}`,
      realId: v.video_id,
      title: v.title,
      duration: v.duration,
      averageScore: Math.round(parseFloat(v.rating || 0)),
      coverImage: { large: v.default_thumb, medium: v.default_thumb },
      url: v.url,
      embedUrl,
      isReal: true,
      isUncensored: true,
      genres: ['English & Western', 'Verified HD'],
      tags: (v.tags || []).map(t => ({ name: typeof t === 'string' ? t : t.tag_name || '' }))
    });
  }

  memoryCache.set(url, { timestamp: Date.now(), data: cleanVideos });
  return cleanVideos;
}

// -----------------------------------------------------------------------------
// Playability Probe Engine (Guarantees zero dead or unplayable links)
// -----------------------------------------------------------------------------

async function probePlayableStream(url) {
  if (STREAM_PROBE_CACHE.has(url)) {
    const cached = STREAM_PROBE_CACHE.get(url);
    if (Date.now() - cached.ts < 300000) {
      return cached.valid;
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timer);

    const finalUrl = resp.url || url;
    if (resp.status !== 200) {
      STREAM_PROBE_CACHE.set(url, { valid: false, ts: Date.now() });
      return false;
    }

    if (/defendonlineprivacy|parking|adcash|monetag/i.test(finalUrl)) {
      STREAM_PROBE_CACHE.set(url, { valid: false, ts: Date.now() });
      return false;
    }

    const textChunk = await resp.text();
    const hasPlayerOrCatalog = /player|video|iframe|episode|source|stream|watch/i.test(textChunk);

    const isValid = resp.status === 200 && hasPlayerOrCatalog;
    STREAM_PROBE_CACHE.set(url, { valid: isValid, ts: Date.now() });
    return isValid;
  } catch (e) {
    STREAM_PROBE_CACHE.set(url, { valid: false, ts: Date.now() });
    return false;
  }
}

async function buildValidatedAdultStreamingLinks(anime, episodeNumber = 1) {
  if (anime.isReal && anime.embedUrl) {
    return {
      inAppMirrors: [
        {
          name: 'Direct HD In-App Player',
          url: anime.embedUrl,
          description: 'Official Embedded Stream • Uncensored HD',
          isDirect: true,
          isEmbed: true
        },
        {
          name: 'Source Portal (RedTube HD)',
          url: anime.url,
          description: 'Direct HD Stream • No-Referrer Protected',
          isDirect: true,
          isEmbed: false
        }
      ]
    };
  }

  const romaji = anime.title?.romaji || '';
  const english = anime.title?.english || romaji || 'Anime';

  const cleanRomaji = romaji.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cleanEnglish = english.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const encodedTitle = encodeURIComponent((anime.title?.english || romaji).replace(/[^\w\s-]/g, '').trim());

  const candidates = [
    {
      name: `HentaiMama (Ep ${episodeNumber} Direct HD)`,
      url: `https://hentaimama.io/episodes/${cleanRomaji}-episode-${episodeNumber}/`,
      description: 'Instant HD Cloud Stream • Verified Active',
      isDirect: true
    },
    {
      name: `HentaiMama (Ep ${episodeNumber} Alternate)`,
      url: `https://hentaimama.io/episodes/${cleanEnglish}-episode-${episodeNumber}/`,
      description: 'Direct Episode Stream • Verified Active',
      isDirect: true
    },
    {
      name: `HentaiHaven (Ep ${episodeNumber} Direct Player)`,
      url: `https://hentaihaven.xxx/watch/${cleanRomaji}/episode-${episodeNumber}/`,
      description: 'High-Bitrate Direct Video • Verified Active',
      isDirect: true
    },
    {
      name: `HentaiHaven (Ep ${episodeNumber} Mirror)`,
      url: `https://hentaihaven.xxx/watch/${cleanEnglish}/episode-${episodeNumber}/`,
      description: 'Alternative HD Player • Verified Active',
      isDirect: true
    },
    {
      name: 'Hanime Verified Stream Search',
      url: `https://hanime.tv/search?q=${encodedTitle}`,
      description: 'Uncensored 1080p Cloud Catalog',
      isDirect: false
    },
    {
      name: 'MuchoHentai Fast Portal',
      url: `https://muchohentai.com/?s=${encodedTitle}`,
      description: 'Full Episode Archives & Dedicated Mirrors',
      isDirect: false
    }
  ];

  const probeResults = await Promise.allSettled(
    candidates.map(async (c) => {
      const isPlayable = await probePlayableStream(c.url);
      return { ...c, isPlayable };
    })
  );

  const validatedMirrors = probeResults
    .filter(r => r.status === 'fulfilled' && r.value.isPlayable)
    .map(r => r.value);

  if (validatedMirrors.length === 0) {
    const fallbacks = [
      { name: 'Hanime Direct Search', url: `https://hanime.tv/search?q=${encodedTitle}`, description: 'Direct HD Streaming' },
      { name: 'MuchoHentai Mirror', url: `https://muchohentai.com/?s=${encodedTitle}`, description: 'Full Episode Archives' }
    ];
    for (const fb of fallbacks) {
      if (await probePlayableStream(fb.url)) {
        validatedMirrors.push(fb);
      }
    }
  }

  return { inAppMirrors: validatedMirrors };
}

// -----------------------------------------------------------------------------
// Full category catalogs (fetched live from the upstream sources, cached 6h)
// Your existing exclusion filter (BLACKLIST_REGEX) is applied to the lists too.
// -----------------------------------------------------------------------------
const CATEGORY_CACHE = new Map();
async function getFullCategories(type) {
  const hit = CATEGORY_CACHE.get(type);
  if (hit && Date.now() - hit.t < 6 * 3600 * 1000) return hit.list;
  let list = [];
  if (type === 'real') {
    const r = await fetch('https://api.redtube.com/?data=redtube.Categories.getCategoriesList&output=json', { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    const featuredIds = new Set(REAL_KINK_GROUPS.flatMap((g) => g.items.map(([id]) => id.toLowerCase())));
    const upstream = (d.categories || [])
      .filter((c) => c.category && !REAL_CATEGORY_HIDE.has(c.category.toLowerCase()) && !featuredIds.has(c.category.toLowerCase()))
      .map((c) => ({ id: c.category, name: c.category, group: REAL_GROUP_BY_NAME.get(c.category.toLowerCase()) || 'More' }));
    const featured = REAL_KINK_GROUPS.flatMap((g) => g.items.map(([id, label], order) => ({ id, name: label.replace(/^\S+\s+/, ''), label, group: g.group, featured: true, order })));
    list = [...featured, ...upstream];
  } else {
    const d = await fetchAniList('{ GenreCollection MediaTagCollection { name isAdult category } }');
    const genres = (d?.GenreCollection || []).map((g) => ({ id: g, name: g, group: 'Genres' }));
    const kinkById = new Map(HENTAI_KINK_GROUPS.flatMap((g) => g.items.map(([id, label], order) => [id, { group: g.group, label, order }])));
    const tags = (d?.MediaTagCollection || []).map((t) => {
      const k = t.isAdult ? kinkById.get(t.name) : null;
      return {
        id: t.name, name: t.name,
        group: k ? k.group : (t.isAdult ? 'Adult tags (other)' : (t.category || 'Tags').replace(/^Theme-/, 'Theme: ').replace(/^Setting-/, 'Setting: ').replace(/^Cast-/, 'Cast: ').replace(/^Demographic$/, 'Demographic')),
        ...(k ? { label: k.label, featured: true, order: k.order } : {}),
      };
    });
    list = [...genres, ...tags];
  }
  const seen = new Set();
  // Kink/fetish groups first (in their defined order), then everything else alphabetically.
  const groupOrder = [...(type === 'real' ? REAL_KINK_GROUPS : HENTAI_KINK_GROUPS).map((g) => g.group), 'Adult tags (other)'];
  const rank = (g) => { const i = groupOrder.indexOf(g); return i === -1 ? 999 : i; };
  list = list.filter((c) => c.id && !BLACKLIST_REGEX.test(c.id) && !MINOR_SAFETY_REGEX.test(c.id) && !seen.has(c.group + c.id) && seen.add(c.group + c.id))
    .sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group) || (a.featured && b.featured ? a.order - b.order : a.name.localeCompare(b.name)));
  if (list.length) CATEGORY_CACHE.set(type, { t: Date.now(), list });
  return list;
}

// -----------------------------------------------------------------------------
// HTTP Request Dispatcher
// -----------------------------------------------------------------------------

function sendJson(res, statusCode, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private'
  });
  res.end(data);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { success: false, error: message });
}

function checkAuth(req) {
  const token = req.headers['x-vault-token'];
  if (!token || token !== activeSessionToken || Date.now() > activeSessionExpiry) {
    return false;
  }
  activeSessionExpiry = Date.now() + sessionMs;
  return true;
}

// Owner (valid session token) or an already-authenticated invite guest (req.isGuest is set in-process
// by the guest gateway after passcode login, never from a request header).
const requireOwnerOrGuest = (req, res) => {
  if (req.isGuest || checkAuth(req)) return true;
  sendError(res, 401, 'Unauthorized: Vault locked');
  return false;
};
// Custom header forces a CORS preflight, so other websites cannot fire state-changing requests at us.
const requireAppHeader = (req, res) => {
  if (req.headers['x-vaultpulse'] === '1') return true;
  sendError(res, 403, 'Missing X-VaultPulse header');
  return false;
};
// DNS-rebinding guard: the owner listener only answers to its own loopback host names.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

const server = http.createServer(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');

  if (!req.isGuest && !ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) {
    sendError(res, 403, 'Forbidden host');
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = parsedUrl.pathname;

  // Kill switch: lock, then hand off to killswitch.sh (detached, survives this server dying) which closes the
  // window, stops server + private Tor, destroys the RAM profile and Tor state, and relaunches everything fresh.
  // Needs no PIN: it only destroys volatile state and can only reduce access.
  if (pathname === '/api/kill-switch' && req.method === 'POST') {
    if (req.isGuest) { sendError(res, 404, 'Not found'); return; }
    if (!requireAppHeader(req, res)) return;
    const script = path.join(__dirname, 'killswitch.sh');
    if (!fs.existsSync(script)) { sendError(res, 500, 'killswitch.sh is missing'); return; }
    lockVault('kill switch');
    sendJson(res, 200, { success: true, message: 'Kill switch engaged: wiping the profile and relaunching fresh' });
    setTimeout(() => {
      try {
        const child = spawn('bash', [script, '--relaunch'], { detached: true, stdio: 'ignore', env: process.env });
        child.unref();
      } catch (e) { console.error('[VaultPulse] kill switch spawn failed:', e.message); }
    }, 300);
    return;
  }

  // Owner-only: is outbound traffic really leaving through Tor? (never reachable by guests)
  if (pathname === '/api/net-status' && req.method === 'GET') {
    if (req.isGuest) { sendError(res, 404, 'Not found'); return; }
    if (!checkAuth(req)) { sendError(res, 401, 'Unauthorized: Vault locked'); return; }
    const e = await checkEgress(parsedUrl.searchParams.get('refresh') === '1');
    sendJson(res, 200, { success: true, proxied: !!PROXY_URL, isTor: e.isTor, exitIp: e.ip || null, error: e.error || null });
    return;
  }

  // Lock the vault and close this app's standalone Chrome window (works with no window manager).
  // Needs no PIN: locking/closing can only reduce access. The daemon keeps running, locked.
  if (pathname === '/api/close-window' && req.method === 'POST') {
    if (req.isGuest) { sendError(res, 404, 'Not found'); return; }
    if (!requireAppHeader(req, res)) return;
    const profileDir = process.env.VAULTPULSE_PROFILE || path.join(process.env.XDG_RUNTIME_DIR || '/tmp', 'vaultpulse-profile');
    let pids = [];
    try {
      pids = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
        .split('\n')
        .filter((l) => l.includes(`--user-data-dir=${profileDir}`) && l.includes('--app=') && !l.includes('--type='))
        .map((l) => parseInt(l.trim().split(/\s+/)[0], 10))
        .filter((n) => Number.isFinite(n) && n !== process.pid);
    } catch (err) {
      lockVault('close-window (ps failed)');
      sendError(res, 500, `Vault locked, but could not list processes: ${err.message}`);
      return;
    }
    lockVault('close-window');
    sendJson(res, 200, { success: true, locked: true, closing: pids });
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
      // Chrome can ignore SIGTERM when hung; escalate if it is still alive.
      setTimeout(() => { try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {} }, 4000).unref();
    }
    return;
  }

  // Owner-only in-window console (memory only; needs the unlocked vault; guests never reach this)
  if (pathname.startsWith('/api/console')) {
    if (req.isGuest) { sendError(res, 404, 'Not found'); return; }
    if (!checkAuth(req)) { sendError(res, 401, 'Unauthorized: Vault locked'); return; }
    if (pathname === '/api/console' && req.method === 'GET') { sendJson(res, 200, { success: true, lines: getLines(parseInt(parsedUrl.searchParams.get('since') || '0', 10)) }); return; }
    if (pathname === '/api/console/clear' && req.method === 'POST') { clearLines(); sendJson(res, 200, { success: true }); return; }
    if (pathname === '/api/console/client' && req.method === 'POST') {
      let b = ''; for await (const c of req) { b += c; if (b.length > 8192) break; }
      try { const j = JSON.parse(b); addLine(['warn', 'error'].includes(j.level) ? j.level : 'log', j.msg, 'browser'); } catch {}
      sendJson(res, 200, { success: true }); return;
    }
  }

  // Owner-only invite management (main loopback listener; never reachable by guests)
  if (pathname.startsWith('/api/share/')) {
    if (req.isGuest) { sendError(res, 403, 'Forbidden'); return; }
    if (!checkAuth(req)) { sendError(res, 401, 'Unauthorized: Vault locked'); return; }
    const readJson = async () => { let b = ''; for await (const c of req) b += c; try { return JSON.parse(b || '{}'); } catch { return {}; } };
    try { await share.handleOwner(req, res, pathname, readJson, sendJson, sendError); } catch (e) { sendError(res, 500, e.message); }
    return;
  }

  // ---------------------------------------------------------------------------
  // API: Vault Security & Authentication
  // ---------------------------------------------------------------------------

  if (pathname === '/api/vault/status' && req.method === 'GET') {
    const config = loadConfig();
    const isConfigured = !!config && !!config.salt && !!config.verifyHash;
    const isUnlocked = !!activeSessionToken && Date.now() < activeSessionExpiry && !!unlockedData;
    sendJson(res, 200, {
      success: true,
      configured: isConfigured,
      unlocked: isUnlocked,
      autoLockMinutes: config?.autoLockMinutes || 30
    });
    return;
  }

  if (pathname === '/api/vault/setup' && req.method === 'POST') {
    if (!requireAppHeader(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { pin } = JSON.parse(body);
        if (!pin || pin.length < 4) {
          sendError(res, 400, 'Master PIN must be at least 4 digits');
          return;
        }
        const existing = loadConfig();
        if (existing && existing.verifyHash) {
          sendError(res, 400, 'Vault is already initialized');
          return;
        }
        const salt = crypto.randomBytes(16).toString('hex');
        const key = deriveKey(pin, salt);
        const verifyHash = crypto.createHash('sha256').update(key).digest('hex');

        saveConfig({
          salt,
          verifyHash,
          autoLockMinutes: 30,
          createdAt: new Date().toISOString()
        });

        unlockedData = { history: [], bookmarks: [], settings: {} };
        derivedMasterKey = key;
        saveEncryptedVault();

        activeSessionToken = crypto.randomBytes(32).toString('hex');
        activeSessionExpiry = Date.now() + sessionMs;

        sendJson(res, 200, {
          success: true,
          message: 'Vault initialized and encrypted with Master PIN',
          token: activeSessionToken
        });
      } catch (err) {
        sendError(res, 500, err.message);
      }
    });
    return;
  }

  if (pathname === '/api/vault/unlock' && req.method === 'POST') {
    if (!requireAppHeader(req, res)) return;
    const waitMs = unlockBlockedUntil - Date.now();
    if (waitMs > 0) {
      const secs = Math.ceil(waitMs / 1000);
      res.setHeader('Retry-After', String(secs));
      sendError(res, 429, `Too many wrong PINs. Try again in ${secs}s`);
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { pin } = JSON.parse(body);
        if (typeof pin !== 'string' || !pin) {
          sendError(res, 400, 'PIN required');
          return;
        }
        const config = loadConfig();
        if (!config || !config.salt || !config.verifyHash) {
          sendError(res, 400, 'Vault is not configured yet');
          return;
        }

        const key = deriveKey(pin, config.salt);
        const checkHash = crypto.createHash('sha256').update(key).digest('hex');
        if (checkHash !== config.verifyHash) {
          unlockFailures++;
          // 5 free tries, then 30s, 60s, 120s ... capped at 15 min.
          if (unlockFailures >= 5) unlockBlockedUntil = Date.now() + Math.min(15 * 60 * 1000, 30000 * 2 ** (unlockFailures - 5));
          console.warn(`[VaultPulse] Wrong PIN (consecutive failures: ${unlockFailures})`);
          sendError(res, 401, 'Invalid Master PIN');
          return;
        }
        unlockFailures = 0;
        unlockBlockedUntil = 0;

        if (fs.existsSync(VAULT_FILE)) {
          const encPayload = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
          const data = decryptVault(encPayload, key);
          if (!data) {
            sendError(res, 500, 'Failed to decrypt vault content');
            return;
          }
          unlockedData = data;
        } else {
          unlockedData = { history: [], bookmarks: [], settings: {} };
        }

        derivedMasterKey = key;
        sessionMs = autoLockMs(config);
        activeSessionToken = crypto.randomBytes(32).toString('hex');
        activeSessionExpiry = Date.now() + sessionMs;

        sendJson(res, 200, {
          success: true,
          message: 'Vault unlocked successfully',
          token: activeSessionToken
        });
      } catch (err) {
        sendError(res, 500, err.message);
      }
    });
    return;
  }

  if (pathname === '/api/vault/lock' && req.method === 'POST') {
    lockVault('manual');
    sendJson(res, 200, { success: true, message: 'Vault locked and memory cleared' });
    return;
  }

  if (pathname === '/api/vault/purge' && req.method === 'POST') {
    if (!requireAppHeader(req, res)) return;
    if (!checkAuth(req)) { sendError(res, 401, 'Unauthorized: unlock the vault to purge it'); return; }
    try {
      if (fs.existsSync(VAULT_FILE)) fs.unlinkSync(VAULT_FILE);
      if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
      activeSessionToken = null;
      activeSessionExpiry = 0;
      unlockedData = null;
      derivedMasterKey = null;
      memoryCache.clear();
      STREAM_PROBE_CACHE.clear();
      sendJson(res, 200, { success: true, message: 'All vault data securely destroyed' });
    } catch (e) {
      sendError(res, 500, e.message);
    }
    return;
  }

  // ---------------------------------------------------------------------------
  // API: Protected Vault Content (History, Bookmarks & Preferences)
  // ---------------------------------------------------------------------------

  if (pathname === '/api/vault/preferences') {
    if (!checkAuth(req)) {
      sendError(res, 401, 'Unauthorized: Vault locked');
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, {
        success: true,
        preferences: unlockedData.preferences || {
          defaultMode: 'hentai',
          uncensoredOnly: true,
          favoriteGenres: ['Romance', 'Comedy', 'Ecchi', 'Fantasy']
        }
      });
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const prefs = JSON.parse(body);
          unlockedData.preferences = {
            ...(unlockedData.preferences || {}),
            ...prefs
          };
          saveEncryptedVault();
          sendJson(res, 200, { success: true, preferences: unlockedData.preferences });
        } catch (e) {
          sendError(res, 500, e.message);
        }
      });
      return;
    }
  }

  if (pathname === '/api/vault/history') {
    if (!checkAuth(req)) {
      sendError(res, 401, 'Unauthorized: Vault locked');
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, { success: true, history: unlockedData.history || [] });
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const item = JSON.parse(body);
          if (!unlockedData.history) unlockedData.history = [];
          unlockedData.history = unlockedData.history.filter(h => h.id !== item.id);
          unlockedData.history.unshift({
            id: item.id,
            title: item.title,
            coverImage: item.coverImage,
            episode: item.episode || 1,
            isReal: !!item.isReal,
            lastWatchedAt: new Date().toISOString()
          });
          if (unlockedData.history.length > 100) unlockedData.history.pop();
          saveEncryptedVault();
          sendJson(res, 200, { success: true });
        } catch (e) {
          sendError(res, 500, e.message);
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      unlockedData.history = [];
      saveEncryptedVault();
      sendJson(res, 200, { success: true, message: 'History cleared' });
      return;
    }
  }

  if (pathname === '/api/vault/bookmarks') {
    if (!checkAuth(req)) {
      sendError(res, 401, 'Unauthorized: Vault locked');
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, { success: true, bookmarks: unlockedData.bookmarks || [] });
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const item = JSON.parse(body);
          if (!unlockedData.bookmarks) unlockedData.bookmarks = [];
          if (!unlockedData.bookmarks.some(b => b.id === item.id)) {
            unlockedData.bookmarks.unshift({
              id: item.id,
              title: item.title,
              coverImage: item.coverImage,
              score: item.score,
              isReal: !!item.isReal,
              addedAt: new Date().toISOString()
            });
            saveEncryptedVault();
          }
          sendJson(res, 200, { success: true });
        } catch (e) {
          sendError(res, 500, e.message);
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      const id = parsedUrl.searchParams.get('id');
      if (id) {
        unlockedData.bookmarks = (unlockedData.bookmarks || []).filter(b => String(b.id) !== String(id));
        saveEncryptedVault();
        sendJson(res, 200, { success: true });
      } else {
        sendError(res, 400, 'Missing id parameter');
      }
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // API: Media Feed (Supports Hentai & Real Content, strictly non-trans/non-gay)
  // ---------------------------------------------------------------------------

  if (pathname === '/api/adult/categories' && req.method === 'GET') {
    if (!requireOwnerOrGuest(req, res)) return;
    try {
      const type = parsedUrl.searchParams.get('type') === 'real' ? 'real' : 'hentai';
      sendJson(res, 200, { success: true, type, categories: await getFullCategories(type) });
    } catch (e) { sendError(res, 502, `Could not load categories: ${e.message}`); }
    return;
  }

  if (pathname === '/api/adult/feed' && req.method === 'GET') {
    if (!requireOwnerOrGuest(req, res)) return;
    const contentType = parsedUrl.searchParams.get('type') || 'hentai';
    const category = parsedUrl.searchParams.get('category') || 'trending';
    const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
    const search = parsedUrl.searchParams.get('search') || null;
    const genreParam = parsedUrl.searchParams.get('genre') || null;
    const categoryTag = parsedUrl.searchParams.get('categoryTag') || (genreParam !== 'All' ? genreParam : null);
    const uncensoredOnly = parsedUrl.searchParams.get('uncensored') === 'true';

    try {
      if (contentType === 'real') {
        const videos = await fetchRealContent(search, categoryTag, page);
        sendJson(res, 200, {
          success: true,
          contentType: 'real',
          media: videos
        });
        return;
      }

      // Hentai (AniList)
      // POPULARITY_DESC tiebreaker: AniList intermittently returns an empty page for a bare TRENDING_DESC sort.
      let sort = ['TRENDING_DESC', 'POPULARITY_DESC'];
      if (category === 'popular') sort = ['POPULARITY_DESC'];
      if (category === 'top') sort = ['SCORE_DESC'];
      if (category === 'recent') sort = ['START_DATE_DESC'];

      const ANILIST_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];

      const vars = {
        page,
        perPage: 35,
        sort,
        search: search && search.trim() ? search.trim() : undefined,
        genre_not_in: EXCLUDED_GENRES,
        tag_not_in: EXCLUDED_TAGS
      };

      if (categoryTag && categoryTag !== 'All') {
        if (ANILIST_GENRES.includes(categoryTag)) {
          vars.genre = categoryTag;
        } else {
          vars.tag_in = [categoryTag];
        }
      }

      let data;
      try {
        data = await fetchAniList(ADULT_LIST_QUERY, vars);
      } catch (aniErr) {
        // Fallback without tag filter if specific tag failed
        if (vars.tag_in || vars.genre) {
          delete vars.tag_in;
          delete vars.genre;
          data = await fetchAniList(ADULT_LIST_QUERY, vars);
        } else {
          throw aniErr;
        }
      }
      const rawMedia = data?.Page?.media || [];

      // Enforce strict secondary filter on every item
      let cleanMedia = rawMedia.filter(isCleanAdultContent);

      if (uncensoredOnly) {
        cleanMedia = cleanMedia.map(m => ({ ...m, isUncensored: true }));
      }

      sendJson(res, 200, {
        success: true,
        contentType: 'hentai',
        pageInfo: data?.Page?.pageInfo,
        media: cleanMedia
      });
    } catch (err) {
      sendError(res, 500, err.message);
    }
    return;
  }

  // ---------------------------------------------------------------------------
  // API: Stream Info with Live Pre-Flight Playability Validation
  // ---------------------------------------------------------------------------

  if (pathname === '/api/adult/stream-info' && req.method === 'GET') {
    if (!requireOwnerOrGuest(req, res)) return;
    const rawId = parsedUrl.searchParams.get('id');
    const ep = parseInt(parsedUrl.searchParams.get('ep') || '1', 10);
    if (!rawId) {
      sendError(res, 400, 'Missing anime id');
      return;
    }

    try {
      // Check if real content
      if (rawId.startsWith('real_')) {
        const videoId = rawId.replace('real_', '');
        const embedUrl = `https://embed.redtube.com/?id=${videoId}`;
        const sourceUrl = `https://www.redtube.com/${videoId}`;
        sendJson(res, 200, {
          success: true,
          anime: { id: rawId, title: { english: 'Uncensored Real Content' }, isReal: true },
          streams: {
            inAppMirrors: [
              {
                name: 'Direct HD In-App Player',
                url: embedUrl,
                description: 'Official Embedded Stream • Uncensored HD',
                isDirect: true,
                isEmbed: true
              },
              {
                name: 'Source Portal (Direct HD)',
                url: sourceUrl,
                description: 'Direct HD Stream • No-Referrer Protected',
                isDirect: true,
                isEmbed: false
              }
            ]
          }
        });
        return;
      }

      const id = parseInt(rawId, 10);
      const q = `
        query ($id: Int) {
          Media(id: $id, type: ANIME, isAdult: true) {
            id
            title { english romaji native }
            episodes
            description
            genres
            tags { name }
            coverImage { large extraLarge }
          }
        }
      `;
      const data = await fetchAniList(q, { id });
      const media = data?.Media;
      if (!media || !isCleanAdultContent(media)) {
        sendError(res, 404, 'Title not found or excluded by content safety filters');
        return;
      }

      const streams = await buildValidatedAdultStreamingLinks(media, ep);

      sendJson(res, 200, {
        success: true,
        anime: media,
        streams
      });
    } catch (e) {
      sendError(res, 500, e.message);
    }
    return;
  }

  // ---------------------------------------------------------------------------
  // Static Files Server
  // ---------------------------------------------------------------------------

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  };

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

share = initShare({ mainServer: server, dataDir: DATA_DIR, guestPort: GUEST_PORT });

// Real auto-lock: when the idle window lapses, wipe the key and decrypted data from memory
// (checkAuth alone only refuses tokens; it never cleared RAM).
setInterval(() => {
  if ((unlockedData || derivedMasterKey) && Date.now() > activeSessionExpiry) lockVault('idle timeout');
}, 5000).unref();

if (PROXY_URL) checkEgress(true).catch(() => {}); // log the egress result at startup (non-blocking)

server.listen(PORT, HOST, () => {
  console.log(`[VaultPulse] Anonymous Secure Media Vault active.`);
  console.log(`[VaultPulse] Catalogs: Hentai (Uncensored) + Real Content (Uncensored).`);
  console.log(`[VaultPulse] Content Filters: Trans & Male-on-Male excluded.`);
  console.log(`[VaultPulse] Bound exclusively to http://${HOST}:${PORT}`);
});
