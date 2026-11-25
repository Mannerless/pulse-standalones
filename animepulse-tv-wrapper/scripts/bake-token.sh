#!/usr/bin/env bash
# FALLBACK only: copy the share token into gitignored assets/ and rebuild.
# Prefer scripts/install-token.sh (run-as). This bakes the token into the APK.
# The asset is gitignored and this script will not print it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_FILE="${ANIMEPULSE_SHARE_TOKEN_FILE:-$HOME/.config/animepulse/share_token}"
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Token file not found." >&2
  exit 1
fi
mkdir -p "$ROOT/assets"
umask 077
cp "$TOKEN_FILE" "$ROOT/assets/share_token"
chmod 600 "$ROOT/assets/share_token"
echo "Wrote gitignored assets/share_token (not printed). Building with ALLOW_BAKED_TOKEN=1."
ALLOW_BAKED_TOKEN=1 "$ROOT/build.sh"
echo "Remove assets/share_token after install if you do not want it on disk."
