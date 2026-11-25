#!/usr/bin/env bash
# AnimePulse standalone launcher (no agy/Antigravity dependency).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
export PORT="${PORT:-7888}"
PROFILE_DIR="${ANIMEPULSE_PROFILE:-$HOME/.config/google-chrome-animepulse-standalone}"

# Load the share token from a mode-600 file if the env var is unset. Never echo it.
TOKEN_FILE="${ANIMEPULSE_SHARE_TOKEN_FILE:-$HOME/.config/animepulse/share_token}"
if [ -z "${ANIMEPULSE_SHARE_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
  ANIMEPULSE_SHARE_TOKEN="$(tr -d "\n\r" < "$TOKEN_FILE")"
  export ANIMEPULSE_SHARE_TOKEN
fi
export ANIMEPULSE_SHARE_TOKEN_FILE="$TOKEN_FILE"

# Chrome is only required when opening the desktop app window.
HEADLESS=0
if [ "${ANIMEPULSE_HEADLESS:-}" = "1" ] || [ "${ANIMEPULSE_TV:-}" = "1" ] || [ -z "${DISPLAY:-}" ]; then
  HEADLESS=1
fi

NEED=(node ss)
if [ "$HEADLESS" -eq 0 ]; then
  NEED+=(google-chrome)
fi
for bin in "${NEED[@]}"; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[AnimePulse] missing prerequisite: $bin" >&2; exit 1; }
done
[ -d "$APP_DIR/node_modules" ] || { echo "[AnimePulse] node_modules missing; run: cd $APP_DIR && npm install" >&2; exit 1; }
mkdir -p "$APP_DIR/data" "$PROFILE_DIR"

if ! ss -tln | grep -q ":${PORT} "; then
  echo "[AnimePulse] Starting server on port ${PORT}..."
  cd "$APP_DIR"
  setsid node "$APP_DIR/server.mjs" > "$APP_DIR/data/server.log" 2>&1 </dev/null &
  for _ in $(seq 1 20); do ss -tln | grep -q ":${PORT} " && break; sleep 0.5; done
  ss -tln | grep -q ":${PORT} " || { echo "[AnimePulse] server failed; see $APP_DIR/data/server.log" >&2; exit 1; }
fi
echo "[AnimePulse] Server online at http://127.0.0.1:${PORT}"

if [ "$HEADLESS" -eq 0 ] && [ -n "${DISPLAY:-}" ]; then
  POS_ARGS=()
  # Pin to the HDMI-A-0 monitor only if it is actually connected
  GEOM="$(xrandr --query 2>/dev/null | awk '/^HDMI-A-0 connected/ {for(i=3;i<=NF;i++) if ($i ~ /^[0-9]+x[0-9]+\+[0-9]+\+[0-9]+$/) {print $i; exit}}')"
  if [ -n "$GEOM" ]; then
    W="${GEOM%%x*}"; REST="${GEOM#*x}"; H="${REST%%+*}"; REST="${REST#*+}"; X="${REST%%+*}"; Y="${REST#*+}"
    POS_ARGS=(--window-position="$X,$Y" --window-size="$W,$((H-30))")
  fi
  rm -f "$PROFILE_DIR"/Singleton* 2>/dev/null || true
  setsid google-chrome --app="http://127.0.0.1:${PORT}" "${POS_ARGS[@]}" \
    --user-data-dir="$PROFILE_DIR" --disable-web-security \
    --block-new-web-contents --autoplay-policy=no-user-gesture-required \
    --disable-extensions-except="$APP_DIR/extensions/ubolite" --load-extension="$APP_DIR/extensions/ubolite" \
    --no-first-run --no-default-browser-check </dev/null >/dev/null 2>&1 &
fi
echo "[AnimePulse] Started."
