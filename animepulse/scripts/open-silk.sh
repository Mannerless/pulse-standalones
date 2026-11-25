#!/usr/bin/env bash
# Open Anime Pulse in Fire TV Silk. Reads the share token from the mode-600 file.
# Never prints the token or the full URL.
set -euo pipefail
SERIAL="${ANDROID_SERIAL:-10.146.65.136:5555}"
HOST="${1:-10.146.65.53}"
PORT="${PORT:-7888}"
PATH_Q="${2:-/}"
TOKEN_FILE="${ANIMEPULSE_SHARE_TOKEN_FILE:-$HOME/.config/animepulse/share_token}"
TOKEN="$(tr -d '\n\r' < "$TOKEN_FILE")"
# Quote the URI on the device shell so & in the query string is not interpreted.
# tv=1 is added for document URLs so the 10-foot CSS applies even if UA detection fails.
if [[ "$PATH_Q" == /api/* ]]; then
  SEP='?'
  [[ "$PATH_Q" == *\?* ]] && SEP='&'
  URI="http://${HOST}:${PORT}${PATH_Q}${SEP}token=${TOKEN}"
else
  SEP='?'
  [[ "$PATH_Q" == *\?* ]] && SEP='&'
  URI="http://${HOST}:${PORT}${PATH_Q}${SEP}token=${TOKEN}&tv=1"
fi
adb -s "$SERIAL" shell "am start -a android.intent.action.VIEW -d '${URI}' com.amazon.cloud9" 2>&1 \
  | sed -E 's/token=[^&[:space:]'\''"]+/token=REDACTED/g'
echo "[open-silk] launched Silk at http://${HOST}:${PORT}${PATH_Q%%\?*} (token redacted)"
