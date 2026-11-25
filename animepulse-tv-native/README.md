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
- [x] Step 4: MediaPlayer playback of cached episode URLs (verified on the Fire TV: details, cached playback, pause/resume, BACK)
- [x] Cached-tab blank cover fix (commit 7326da8)
- [x] Episode list when AniList omits the count (commit 1b9fe1d)
- [x] Tab bar can be reached from the grid; tabs are switchable both ways
- Stopped at: both follow-up fixes are committed on `release/animepulse-tv-apps`. The fixed APK was installed with `install -r`. On-TV UI verification of the two fixes was blocked: the TV could not reach the API (`patricks-tv` was offline on the tailnet; hotspot ICMP to 10.146.65.53 works but TCP 7888 times out, likely UFW on wlo1). After the failed Cached load, the Amazon launcher took the foreground, so no further keypresses were sent.

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

- Follow-up fixes (2026-11-25 ~7:27 AM America/New_York): two open issues from the step-4 test were fixed on `release/animepulse-tv-apps` (never on main).

  1. Cached-tab covers often blank. Root cause: `/api/download/library` has no cover field (no server change was made). The client already fills covers from `/api/details`, but a failed first image fetch left the ImageView tagged so `getView` never rebound, and ImageLoader did not retry. Fix in 7326da8: ImageLoader retries a fetch up to three times with 400ms/800ms backoff; `getView` rebinds if the poster URL changed or the drawable is empty; Cached tab prefers cover `large` then `extraLarge`/`medium`, then the banner if the cover is missing.

  2. Shows with no AniList episode count (e.g. Black Clover Season 2, id 195604, `episodes` is null) showed no episode list. Fix in 1b9fe1d: `resolveEpisodeCount` uses AniList `episodes` when present, otherwise falls back in order to (1) the highest cached/downloaded episode for the title, (2) the provider/`streamingEpisodes` list length, (3) `nextAiringEpisode.episode - 1` (or 1 if the next episode is 1), (4) a 12-episode cour as a last-resort manual list. A short status note explains which fallback was used. For Black Clover Season 2 this should list 8 aired episodes (next airing is ep 9).

  The fixed APK was built and installed with `./scripts/install.sh` (`install -r`, token via `run-as`, wrapper left in place). After `adb connect 10.146.65.136:5555`, the native app was launched and the Cached tab was opened with foreground checks before every key. `/workspace/anime_pulse/17-native-cached-cover.png` shows the Cached tab selected and the error `failed to connect to /100.118.77.78 (port 7888) from /10.146.65.136 ... after 12000ms`. `patricks-tv` was offline on the tailnet (last seen ~47 minutes earlier). The TV can ping the laptop hotspot address 10.146.65.53 but TCP 7888 times out, so a client fallback to the hotspot would not have helped without a UFW change (not applied; no sudo). After that capture, focus was `com.amazon.tv.launcher`, so input was stopped. Episode-list UI was not recaptured on the TV. Re-verify both screens when the TV can reach the API (Tailscale signed in on the TV, or inbound 7888 allowed on the hotspot).
- Tab navigation (2026-11-25 ~7:45 AM America/New_York): D-pad could not leave the Trending grid. GridView never had nextFocusUp, BACK left the app, and loadFeed always called grid.requestFocus() because `getChildCount() >= 0` is always true — so a finishing Trending fetch yanked focus off the tab bar. Fix: UP from the first row and BACK from the grid return to the current tab; LEFT/RIGHT on the tab bar move between tabs (HorizontalScrollView is no longer focusable); switching tabs increments feedSeq so a stale loader cannot apply or steal focus; focused tabs get a cyan ring.

