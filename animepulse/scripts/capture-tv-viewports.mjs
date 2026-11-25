// Capture TV-listener layout at 1920x1080 and 1920x960. Never logs the token or a tokened URL.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer-core';

const prefix = process.argv[2]; // e.g. 12-before or 13-after
const OUT_DIR = process.argv[3] || path.join(os.homedir(), 'animepulse-tv-caps');
if (!prefix) { console.error('usage: capture-tv-viewports.mjs <name-prefix> [outdir]'); process.exit(1); }

const TOKEN_FILE = process.env.ANIMEPULSE_SHARE_TOKEN_FILE
  || path.join(os.homedir(), '.config/animepulse/share_token');
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
if (!token) { console.error('token file empty'); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-first-run', '--hide-scrollbars', '--window-size=1920,1080'],
  defaultViewport: null,
});

async function settle(page) {
  await page.waitForSelector('.navbar', { timeout: 20000 });
  await page.waitForSelector('.anime-card, .hero-spotlight', { timeout: 25000 });
  await new Promise((r) => setTimeout(r, 1600));
}

async function measures(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { h: Math.round(r.height), w: Math.round(r.width), y: Math.round(r.top), bottom: Math.round(r.bottom), visible: cs.display !== 'none' && r.height > 0, font: cs.fontSize };
    };
    const hero = document.querySelector('.hero-spotlight');
    const cards = [...document.querySelectorAll('.anime-card')];
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const rows = [];
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.height < 8) continue;
      const mid = Math.round(r.top + r.height / 2);
      let row = rows.find((x) => Math.abs(x.mid - mid) < 40);
      if (!row) { row = { mid, cards: 0, top: r.top, bottom: r.bottom, fullyVisible: false }; rows.push(row); }
      row.cards += 1;
      row.top = Math.min(row.top, r.top);
      row.bottom = Math.max(row.bottom, r.bottom);
    }
    rows.sort((a, b) => a.top - b.top);
    const rowInfo = rows.map((r, i) => ({
      i,
      cards: r.cards,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.bottom - r.top),
      fullyVisible: r.top >= -1 && r.bottom <= vh + 1,
      peekPx: r.top < vh ? Math.round(Math.min(r.bottom, vh) - Math.max(r.top, 0)) : 0,
    }));
    const firstFull = rowInfo[0] ? rowInfo[0].fullyVisible : false;
    return {
      viewport: { w: vw, h: vh },
      tvMode: document.documentElement.classList.contains('tv-mode'),
      badge: box(document.getElementById('outside-viewers-badge')),
      tab: box(document.querySelector('.tab-btn')),
      chip: box(document.querySelector('.genre-chip')),
      search: box(document.getElementById('search-input')),
      hero: box(hero),
      card: box(cards[0]),
      rows: rowInfo,
      firstRowFullyVisible: firstFull,
      secondRowPeek: rowInfo[1] ? rowInfo[1].peekPx : 0,
    };
  });
}

const report = {};
try {
  for (const h of [1080, 960]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: h, deviceScaleFactor: 1 });
    await page.goto('http://100.118.77.78:7888/?token=' + encodeURIComponent(token), {
      waitUntil: 'networkidle2', timeout: 30000,
    });
    await settle(page);
    const file = path.join(OUT_DIR, `${prefix}-${h}.png`);
    await page.screenshot({ path: file, fullPage: false });
    report[String(h)] = { file, tokenInUrl: /[?&]token=/.test(page.url()), ...await measures(page) };
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
