#!/usr/bin/env bash
# Probe health and a token-gated page. Never prints the token.
set -euo pipefail
HOST="${1:-10.146.65.53}"
PORT="${PORT:-7888}"
TOKEN_FILE="${ANIMEPULSE_SHARE_TOKEN_FILE:-$HOME/.config/animepulse/share_token}"
TOKEN="$(tr -d '\n\r' < "$TOKEN_FILE")"
echo "=== health (no token) ==="
curl -sS -m 5 "http://${HOST}:${PORT}/api/health" || echo "HEALTH_FAIL"
echo
echo
echo "=== loopback health ==="
curl -sS -m 5 "http://127.0.0.1:${PORT}/api/health" || echo "LOOPBACK_HEALTH_FAIL"
echo
echo
echo "=== TV without token (expect 401) ==="
curl -sS -m 5 -o /tmp/ap-no-token.body -w "HTTP %{http_code}\n" "http://${HOST}:${PORT}/api/feed" || echo "NOTOKEN_FAIL"
echo
echo "=== TV with header token (expect 200) ==="
CODE=$(curl -sS -m 8 -o /tmp/ap-authed.body -w "%{http_code}" -H "X-AnimePulse-Token: ${TOKEN}" "http://${HOST}:${PORT}/api/feed?mode=trending" || true)
echo "HTTP $CODE bytes=$(wc -c < /tmp/ap-authed.body)"
echo "=== loopback feed without token (must still work) ==="
CODE2=$(curl -sS -m 8 -o /tmp/ap-loop.body -w "%{http_code}" "http://127.0.0.1:${PORT}/api/feed?mode=trending" || true)
echo "HTTP $CODE2 bytes=$(wc -c < /tmp/ap-loop.body)"
