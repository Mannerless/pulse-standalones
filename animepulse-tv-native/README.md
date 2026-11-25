# Anime Pulse native Android TV app

Standalone Fire TV / Android TV client that talks to the Anime Pulse `/api` endpoints directly.
This is **not** the WebView wrapper (`com.masumane.animepulse.tvwrapper`); the packages are distinct
and this app will not replace the working wrapper.

- Package: `com.masumane.animepulse.tvnative`
- minSdk 22, targetSdk 28
- Leanback launcher entry + banner
- Server: `http://100.118.77.78:7888/` (laptop Tailscale address)

## Progress (update this when work stops)

- [x] Step 1: Leanback launcher + HttpURLConnection client for `/api/health` and `/api/feed`
- [x] Step 2: Browse grid with covers
- [ ] Step 3: Details screen
- [ ] Step 4: MediaPlayer playback of cached episode URLs
- Stopped at: step 2 buildable (cover grid). Installing on the Fire TV to verify.

## Token handling (do not print, do not commit)

Same safer path as the wrapper: the share token is **not** baked into the APK and is **not** in this repo.

`scripts/install-token.sh` writes `/home/dev/.config/animepulse/share_token` into the app-private
`files/share_token` via `adb shell run-as` (base64 stdin pipe; nothing left under `/data/local/tmp`).
The APK is debuggable so `run-as` works. `ApiClient` sends it as the `X-AnimePulse-Token` header only.
The app never logs the token or a tokened URL.

Signing keystore (outside the repo, mode 600): `~/.android/animepulse-tv.keystore`.

## Build

```bash
./build.sh
```

Do not install on the Fire TV until step 2 shows a cover grid.
Fire TV serial is `10.146.65.136:5555` only. Do not target other devices.

If Patrick wants this native app removed later (and only then):

```bash
adb -s 10.146.65.136:5555 uninstall com.masumane.animepulse.tvnative
```

Do not uninstall the wrapper or anything else.


## Stop notes

- Step 1 (2026-11-25 ~3:29 AM America/New_York): buildable APK `build/animepulse-tv-native.apk`. Leanback launcher, TokenStore, ApiClient for `/api/health` and `/api/feed`. MainActivity shows health status and trending titles in a ListView. Not installed on the Fire TV (wait for the cover grid in step 2).

- Step 2 (2026-11-25 ~3:32 AM America/New_York): 5-column cover grid with Trending/Popular/Airing/Top Rated modes, ImageLoader (memory + disk cache), D-pad focus rings. Buildable APK. About to install alongside the wrapper (distinct package) and verify with screencaps.
