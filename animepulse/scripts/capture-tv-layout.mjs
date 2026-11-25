// Headless 1920x1080 captures of loopback desktop vs TV-listener layout.
// Reads the share token from the mode-600 file. Never logs it or a tokened URL.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer-core';

const TOKEN_FILE = process.env.ANIMEPULSE_SHARE_TOKEN_FILE
  || path.join(os.homedir(), '.config/animepulse/share_token');
const OUT_DIR = process.argv[2] || path.join(os.homedir(), 'animepulse-tv-caps');
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
if (!token) {
  console.error('capture-tv-layout: token file missing or empty (path not printed)');
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-first-run', '--hide-scrollbars', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});

async function settle(page) {
  await page.waitForSelector('.navbar', { timeout: 20000 });
  await page.waitForFunction(() => {
    return document.querySelector('.anime-card, .hero-spotlight, #results-grid, .results-grid');
  }, { timeout: 25000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
}

function measures(page) {
  return page.evaluate(() => {
    const badge = document.getElementById('outside-viewers-badge');
    const share = document.getElementById('btn-share-link');
    const close = document.getElementById('btn-close-window');
    const hero = document.querySelector('.hero-spotlight');
    const card = document.querySelector('.anime-card');
    const tab = document.querySelector('.tab-btn');
    const chip = document.querySelector('.genre-chip');
    const search = document.getElementById('search-input');
    const panel = document.getElementById('viewers-panel');
    const firstCard = card && card.getBoundingClientRect();
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        h: Math.round(r.height),
        w: Math.round(r.width),
        visible: cs.display !== 'none' && r.height > 0,
        font: cs.fontSize,
      };
    };
    return {
      tvModeHtml: document.documentElement.classList.contains('tv-mode'),
      tvModeBody: document.body.classList.contains('tv-mode'),
      badge: box(badge),
      shareVisible: !!(share && getComputedStyle(share).display !== 'none' && share.getBoundingClientRect().height > 0),
      closeVisible: !!(close && getComputedStyle(close).display !== 'none' && close.getBoundingClientRect().height > 0),
      displayVisible: !!(document.getElementById('btn-display-pin') && getComputedStyle(document.getElementById('btn-display-pin')).display !== 'none'),
      mediaVisible: !!(document.getElementById('btn-media-dl') && getComputedStyle(document.getElementById('btn-media-dl')).display !== 'none'),
      hero: hero ? Math.round(hero.getBoundingClientRect().height) : null,
      tab: box(tab),
      chip: box(chip),
      search: box(search),
      card: box(card),
      firstCardBottom: firstCard ? Math.round(firstCard.bottom) : null,
      viewportH: window.innerHeight,
      firstCardOnScreen: firstCard ? firstCard.top < window.innerHeight && firstCard.bottom > 0 : null,
      panelOpen: !!(panel && !panel.hidden),
      panelTitle: panel && !panel.hidden ? (document.getElementById('viewers-panel-title') || {}).textContent : null,
    };
  });
}

const report = {};
try {
  const desktop = await browser.newPage();
  await desktop.goto('http://127.0.0.1:7888/', { waitUntil: 'networkidle2', timeout: 30000 });
  await settle(desktop);
  const deskPath = path.join(OUT_DIR, '07-desktop-loopback.png');
  await desktop.screenshot({ path: deskPath, fullPage: false });
  report.desktop = { file: deskPath, ...await measures(desktop) };
  await desktop.close();

  const tv = await browser.newPage();
  // Token is passed only to goto; it must never be logged.
  await tv.goto('http://100.118.77.78:7888/?token=' + encodeURIComponent(token), {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  await settle(tv);
  // Confirm the address bar was stripped
  const tvUrl = tv.url();
  if (/[?&]token=/.test(tvUrl)) report.tokenStillInUrl = true;
  else report.tokenStripped = true;
  const tvPath = path.join(OUT_DIR, '08-tv-layout.png');
  await tv.screenshot({ path: tvPath, fullPage: false });
  report.tv = { file: tvPath, ...await measures(tv) };

  await tv.click('#outside-viewers-badge');
  await tv.waitForFunction(() => {
    const p = document.getElementById('viewers-panel');
    return p && !p.hidden;
  }, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));
  const panelPath = path.join(OUT_DIR, '09-viewers-panel.png');
  await tv.screenshot({ path: panelPath, fullPage: false });
  report.panel = { file: panelPath, ...await measures(tv) };
  await tv.close();
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
