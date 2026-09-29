#!/usr/bin/env bash
# VaultPulse standalone launcher (no agy/Antigravity dependency).
# ALL traffic (server + browser window) is forced through a private, RAM-only Tor instance.
# FAIL CLOSED: if Tor is not fully bootstrapped, nothing is launched and nothing goes direct.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
export PORT="${PORT:-7899}"
# Ephemeral profile in RAM (tmpfs): nothing about browsing is written to disk; wiped every launch.
PROFILE_DIR="${VAULTPULSE_PROFILE:-${XDG_RUNTIME_DIR:-/tmp}/vaultpulse-profile}"
TOR_SOCKS_PORT="${VAULTPULSE_TOR_SOCKS:-9150}"   # browser -> Tor (socks5, DNS resolved inside Tor)
TOR_HTTP_PORT="${VAULTPULSE_TOR_HTTP:-9151}"     # server -> Tor (HTTP CONNECT tunnel)
TOR_DIR="${XDG_RUNTIME_DIR:-/tmp}/vaultpulse-tor"  # tmpfs: circuits/state never touch disk
TOR_BOOT_TIMEOUT_HALFSECS=600                    # 300s (a cold Tor bootstrap has taken 25s to 105s+)

die() { echo "[VaultPulse] $*" >&2; exit 1; }

for bin in node google-chrome ss tor; do
  command -v "$bin" >/dev/null 2>&1 || die "missing prerequisite: $bin$([ "$bin" = tor ] && echo ' (sudo apt install tor; then: sudo systemctl disable --now tor)')"
done
[ -d "$APP_DIR/node_modules/undici" ] || die "node_modules/undici missing; run: cd $APP_DIR && npm install"
mkdir -p "$APP_DIR/data"
chmod 700 "$APP_DIR/data" 2>/dev/null || true

# --- 1. Private Tor -----------------------------------------------------------------
tor_ready() { ss -tln | grep -q ":${TOR_SOCKS_PORT} " && ss -tln | grep -q ":${TOR_HTTP_PORT} "; }

if ! tor_ready; then
  echo "[VaultPulse] Starting private Tor (RAM-only) on 127.0.0.1:${TOR_SOCKS_PORT}/${TOR_HTTP_PORT}..."
  rm -rf "$TOR_DIR"
  mkdir -p "$TOR_DIR/data"
  chmod 700 "$TOR_DIR" "$TOR_DIR/data"
  cat > "$TOR_DIR/torrc" <<EOF
DataDirectory $TOR_DIR/data
SocksPort 127.0.0.1:$TOR_SOCKS_PORT
HTTPTunnelPort 127.0.0.1:$TOR_HTTP_PORT
ClientOnly 1
AvoidDiskWrites 1
SafeLogging 1
Log notice file $TOR_DIR/tor.log
EOF
  setsid tor -f "$TOR_DIR/torrc" >/dev/null 2>&1 </dev/null &
  for _ in $(seq 1 "$TOR_BOOT_TIMEOUT_HALFSECS"); do
    grep -q "Bootstrapped 100%" "$TOR_DIR/tor.log" 2>/dev/null && break
    sleep 0.5
  done
  if ! grep -q "Bootstrapped 100%" "$TOR_DIR/tor.log" 2>/dev/null; then
    echo "[VaultPulse] Tor failed to bootstrap. Last log lines:" >&2
    tail -n 6 "$TOR_DIR/tor.log" 2>/dev/null >&2 || true
    pkill -TERM -u "$(id -u)" -x tor 2>/dev/null || true
    die "refusing to launch without Tor (no direct fallback)."
  fi
fi
tor_ready || die "Tor ports ${TOR_SOCKS_PORT}/${TOR_HTTP_PORT} are not listening; refusing to launch."
echo "[VaultPulse] Tor circuit ready."

# --- 2. Server (must itself be proxied) ----------------------------------------------
export VAULTPULSE_PROXY="http://127.0.0.1:${TOR_HTTP_PORT}"

if ss -tln | grep -q ":${PORT} "; then
  SP="$(pgrep -u "$(id -u)" -f "^node ${APP_DIR}/server.mjs" | head -n 1 || true)"
  if [ -n "$SP" ] && ! tr '\0' '\n' < "/proc/$SP/environ" 2>/dev/null | grep -q '^VAULTPULSE_PROXY='; then
    echo "[VaultPulse] Running server is NOT routed through Tor; restarting it..."
    kill -TERM "$SP" 2>/dev/null || true
    for _ in $(seq 1 20); do ss -tln | grep -q ":${PORT} " || break; sleep 0.5; done
    if ss -tln | grep -q ":${PORT} "; then kill -KILL "$SP" 2>/dev/null || true; sleep 1; fi
  fi
fi

if ! ss -tln | grep -q ":${PORT} "; then
  echo "[VaultPulse] Starting private daemon on 127.0.0.1:${PORT}..."
  cd "$APP_DIR"
  setsid node "$APP_DIR/server.mjs" > "$APP_DIR/data/server.log" 2>&1 </dev/null &
  for _ in $(seq 1 20); do ss -tln | grep -q ":${PORT} " && break; sleep 0.5; done
  ss -tln | grep -q ":${PORT} " || die "server failed; see $APP_DIR/data/server.log"
fi
echo "[VaultPulse] Engine active on 127.0.0.1:${PORT} (outbound via Tor)"

# --- 3. Browser window (proxied, DNS inside Tor, no WebRTC leak) ----------------------
if [ -n "${DISPLAY:-}" ]; then
  case "$PROFILE_DIR" in */vaultpulse-profile) rm -rf "$PROFILE_DIR"; mkdir -p "$PROFILE_DIR"; chmod 700 "$PROFILE_DIR";; *) rm -f "$PROFILE_DIR"/Singleton* 2>/dev/null || true;; esac
  setsid google-chrome --app="http://127.0.0.1:${PORT}" --window-size=1280,800 \
    --user-data-dir="$PROFILE_DIR" --block-new-web-contents --autoplay-policy=no-user-gesture-required \
    --proxy-server="socks5://127.0.0.1:${TOR_SOCKS_PORT}" \
    --proxy-bypass-list="127.0.0.1;localhost;[::1]" \
    --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1" \
    --force-webrtc-ip-handling-policy=disable_non_proxied_udp \
    --disable-extensions-except="$APP_DIR/extensions/ubolite" --load-extension="$APP_DIR/extensions/ubolite" --no-first-run --no-default-browser-check \
    --disable-background-networking --disable-client-side-phishing-detection --disable-sync \
    ${VAULTPULSE_EXTRA_CHROME_FLAGS:-} \
    </dev/null >/dev/null 2>&1 &

  # --- 4. Exit watchdog: when the window goes away (Lock & Exit, crash, anything), run the kill switch
  # (no relaunch) so the server, Tor and RAM profile do not linger. One watchdog at a time.
  WATCHDOG_PID_FILE="${XDG_RUNTIME_DIR:-/tmp}/vaultpulse-watchdog.pid"
  if ! { [ -f "$WATCHDOG_PID_FILE" ] && kill -0 "$(cat "$WATCHDOG_PID_FILE" 2>/dev/null)" 2>/dev/null; }; then
    setsid bash -c '
      profile="$1"; app="$2"; pidfile="$3"
      echo $$ > "$pidfile"
      window_up() { ps -eo args= | grep -F -- "--user-data-dir=$profile" | grep -v grep >/dev/null; }
      for _ in $(seq 1 120); do window_up && break; sleep 0.5; done   # wait up to 60s for the window to appear
      while window_up; do sleep 2; done                              # then wait for it to go away
      rm -f "$pidfile"
      exec "$app/killswitch.sh"
    ' vaultpulse-watchdog "$PROFILE_DIR" "$APP_DIR" "$WATCHDOG_PID_FILE" </dev/null >/dev/null 2>&1 &
  fi
fi
echo "[VaultPulse] Interface launched. Closing the window shuts down the server and Tor."
