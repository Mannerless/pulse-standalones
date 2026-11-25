# Anime Pulse TV Wrapper

Fullscreen Android TV / Fire TV WebView wrapper for Anime Pulse.

- Package: `com.masumane.animepulse.tvwrapper`
- minSdk 22, targetSdk 28
- Leanback launcher entry + banner
- Loads `http://100.118.77.78:7888/` (laptop Tailscale address)
- Forces a 1920 CSS-px viewport so the existing TV-mode layout shows many cover columns
  (Fire TV density 320 would otherwise be a 960x540 CSS viewport, which only fits 3 columns)

## Token handling (do not print, do not commit)

The share token is **not** baked into the APK and is **not** in this repo.

Safer path used by `scripts/install-token.sh`:

1. Build and sign a *debuggable* APK (needed so `adb run-as` can write app-private files).
2. `adb install -r` the APK (does not uninstall other apps).
3. After install, write `/home/dev/.config/animepulse/share_token` into the app's
   private `files/share_token` via `adb shell run-as` (stdin pipe; nothing is left
   under `/data/local/tmp`).
4. The app reads that file at startup, loads `/?token=...` once, and the page's
   existing `replaceState` plus HttpOnly cookie take over.

If `run-as` ever fails on a given device, `scripts/bake-token.sh` can generate a
gitignored `assets/share_token` and rebuild. That copies the token into the APK,
so prefer the run-as path. Never commit the baked file.

The app never logs the token or the tokened URL.

## Build / install / rollback

```bash
./build.sh
./scripts/install.sh          # adb install -r, then inject token, then launch
```

Fire TV serial is hardcoded as `10.146.65.136:5555`. Do not target other devices.

If Patrick wants the wrapper removed later (and only then):

```bash
adb -s 10.146.65.136:5555 uninstall com.masumane.animepulse.tvwrapper
```

Signing keystore: `~/.android/animepulse-tv.keystore` (mode 600), created by `build.sh` if missing.
Password file: `~/.android/animepulse-tv.keystore.pass` (mode 600). Neither belongs in git.
