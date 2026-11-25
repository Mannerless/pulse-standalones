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
- [x] Step 3: Details screen
- [x] Step 4: MediaPlayer playback of cached episode URLs (built, not yet verified on the TV)
- Stopped at: step 4 tested on the Fire TV (details, cached playback, pause/resume, BACK). TV left on the native Trending grid with playback stopped. Small bugfixes committed (D-pad item click, cover reload, TextureView player).

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

- Step 3 (2026-11-25 ~3:34 AM America/New_York): DetailsActivity loads `/api/details` (banner, meta, synopsis, episode row). Cached tab lists `/api/download/library` titles with covers. Cached episode buttons are marked; playback still a stub until step 4.

- Step 4 (2026-11-25 ~3:39 AM America/New_York): PlayerActivity plays `/api/download/stream?animeId=&episode=` with MediaPlayer, sending `X-AnimePulse-Token` as a request header (never logged, never in the URI). Cached episode buttons on the details screen start the player. APK builds and is signed. **Not installed over the step-3 APK yet** — after the step-3 install, `com.amazon.firebat` (Prime Video / IgnitionActivity) was in the foreground, so install/launch/keyevents were stopped to avoid interrupting that video.
- TV verification still needed when the Fire TV is free:
  1. `./scripts/install.sh` (install -r; does not touch the wrapper).
  2. Open a trending title and screencap the details screen (`16-native-details.png`).
  3. Open the Cached tab, open the cached title, play the cached episode, screencap a few seconds apart (`16-native-playback-1.png`, `16-native-playback-2.png`).
  4. SELECT should pause/resume; BACK should return to details.

- Testing (2026-11-25 ~3:50–4:05 AM America/New_York): Step-4 APK installed with `install -r`. D-pad SELECT initially did not open details (GridView had no OnItemClickListener); fixed and reinstalled. Cover grid went blank when selection called `notifyDataSetChanged` (rebind); fixed by restyling in place. SurfaceView playback was confirmed via dumpsys (H.264 1920x1080, AAC, audio started, pause froze frame count, resume advanced it) but screencaps were black because of the hardware overlay; switched player to TextureView and recaptured real frames. Cached tab played Daemons of the Shadow Realm ep 14. BACK returned to details, then home. Playback stopped. TV left on the Trending grid.
