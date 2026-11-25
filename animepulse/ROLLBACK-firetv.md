# Rollback: Anime Pulse Fire TV work (v1.1.0)

Nothing on the Fire TV was uninstalled by this work. The Tailscale APK, if it was sideloaded, should be left in place unless you explicitly want it removed.

## 1. Stop the new server

```bash
systemctl --user stop animepulse.service
systemctl --user disable animepulse.service
# If a leftover process is still bound to 7888:
ss -tlnp | grep 7888
# only if needed:
# pkill -f /home/dev/apps/animepulse/server.mjs
```

The older `anime-tracker.service` is a different app and should be left running.

## 2. Restore the code

The pre-change backup (source only; cache and `node_modules` were excluded) is:

`/home/dev/backups/animepulse-pre-v1.1.0-20261125-013457.tar.gz`

```bash
cd /home/dev/apps
systemctl --user stop animepulse.service || true
# Return the git branch to main without taking these commits onto main:
git checkout main
# Then overlay the tarball if you also need generated files restored:
tar -C /home/dev/apps -xzf /home/dev/backups/animepulse-pre-v1.1.0-20261125-013457.tar.gz
```

The episode cache on the external drive was not modified as part of the backup or these edits.

## 3. Leave (or remove) the share token

The share token lives at `/home/dev/.config/animepulse/share_token` (mode 600). It is not in git. You can leave it, or delete that file if you want the TV listener unable to start.

Do not commit that file, and do not print its contents.

## 4. Git

Work was done on `release/animepulse-v1.1.0`, not `main`. To abandon the branch:

```bash
git checkout main
# optional, only if you are sure you do not want the branch:
# git branch -D release/animepulse-v1.1.0
```

## 5. Desktop launch

`launch.sh` still starts the loopback UI when `DISPLAY` is set and `ANIMEPULSE_TV` / `ANIMEPULSE_HEADLESS` are unset. After rollback to the tarball or `main`, that is the previous launcher.

## 4. Fire TV WebView wrapper (optional)

The wrapper APK is a new app only: `com.masumane.animepulse.tvwrapper` (label: Anime Pulse). Nothing else was uninstalled when it was installed. Leave it in place unless you explicitly want it removed.

To remove the wrapper only:

```bash
adb -s 10.146.65.136:5555 uninstall com.masumane.animepulse.tvwrapper
```

Do not use `adb uninstall` without that package name, and do not uninstall Tailscale or Silk.

Source lives in `/home/dev/apps/animepulse-tv-wrapper` on branch `release/animepulse-v1.1.0`. The APK and the share token are not in git.

The share token is stored in the app's private file `files/share_token` (written after install via `run-as`). Uninstalling the wrapper deletes that copy. The laptop copy at `/home/dev/.config/animepulse/share_token` is unchanged.

The signing keystore is outside the repo: `~/.android/animepulse-tv.keystore` and `~/.android/animepulse-tv.keystore.pass` (mode 600). Leave them unless you also want to discard the signing key.

Rebuild/reinstall (does not uninstall other apps):

```bash
cd /home/dev/apps/animepulse-tv-wrapper
./build.sh
./scripts/install.sh
```

