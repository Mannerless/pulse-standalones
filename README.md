# Pulse standalones

Two self-contained local apps. Each is a small Node.js server that listens on `127.0.0.1` only,
plus a Chrome app-mode window. Nothing here is a hosted service.

## AnimePulse (`animepulse/`)
Anime discovery and watch tracker built on AniList.
- Tabs: Trending, Most Popular (top 100, paged), Currently Airing, Top Rated. Search, genre filter, pagination.
- Full-series view for any title: prequel and sequel chain in watch order with a one-click jump to the original.
- Watch history, episode downloads (uses `ani-cli`), in-app **Close** button (handy with no window manager).
- Launch: `animepulse/launch.sh` (port 7888). Needs `node`, `google-chrome`, `ss`; `ani-cli` for downloads.

## VaultPulse (`vaultpulse/`)
Private, PIN-locked media catalog (18+, personal use).
- Vault encrypted at rest (AES-256-GCM, PBKDF2). Locked by default; every content endpoint needs an unlocked vault.
  Idle auto-lock wipes the key and decrypted data from memory; closing the window locks it.
- All outbound traffic goes through a private, RAM-only Tor instance and **fails closed**: the server refuses to start
  without the proxy, and the launcher aborts if Tor cannot bootstrap. No direct fallback.
- `killswitch.sh` (also the in-app button) locks, closes the window, stops the server and Tor, destroys the RAM
  profile and Tor state, then relaunches fresh. The encrypted vault on disk is never touched.
- An exit watchdog shuts the server and Tor down as soon as the window goes away.
- Guest sharing is off by default (`VAULTPULSE_SHARE=1` to enable).
- Launch: `vaultpulse/launch.sh` (port 7899). Needs `node`, `google-chrome`, `ss`, `tor`
  (`sudo apt install tor`, then `sudo systemctl disable --now tor`; VaultPulse runs its own instance).

## Setup
```
cd animepulse && npm install
cd ../vaultpulse && npm install
```

## Deliberately not in this repo
- `data/` (vault, watch history, downloads, caches), `*.enc`, logs, backups.
- `node_modules/`, `.venv/`.
- `extensions/`: both launchers load uBlock Origin Lite from `extensions/ubolite`. Download the Chromium (MV3) build
  from its GitHub releases and unpack it there. If the folder is missing, Chrome just skips it.
