#!/usr/bin/env bash
# VaultPulse kill switch.
#   1. lock the vault (memory wiped)      4. stop the private Tor
#   2. close the browser window           5. destroy the RAM profile + Tor state + server log
#   3. stop the server                    6. build a fresh empty profile (and, with --relaunch, restart everything)
# The encrypted vault on disk (data/vault.enc, data/config.json) is NOT touched.
# Usage: killswitch.sh [--relaunch]
set -uo pipefail   # no -e on purpose: the wipe must keep going through partial failures

APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PORT="${PORT:-7899}"
PROFILE_DIR="${VAULTPULSE_PROFILE:-${XDG_RUNTIME_DIR:-/tmp}/vaultpulse-profile}"
TOR_DIR="${XDG_RUNTIME_DIR:-/tmp}/vaultpulse-tor"
UID_NUM="$(id -u)"
RELAUNCH=0
[ "${1:-}" = "--relaunch" ] && RELAUNCH=1
FAILED=0

log() { echo "[VaultPulse kill-switch] $*"; }

# Only ever delete our own directories: absolute path, contains "vaultpulse", not root-ish.
safe_wipe() {
  local d="$1"
  case "$d" in
    /*vaultpulse*) ;;
    *) log "REFUSING to wipe suspicious path: '$d'"; FAILED=1; return 1 ;;
  esac
  if [ "$d" = "/" ] || [ "$d" = "$HOME" ] || [ "$d" = "$APP_DIR" ] || [ "$d" = "$APP_DIR/data" ]; then
    log "REFUSING to wipe protected path: '$d'"; FAILED=1; return 1
  fi
  rm -rf -- "$d" 2>/dev/null || true
  if [ -e "$d" ]; then log "could not fully remove $d"; FAILED=1; return 1; fi
  return 0
}

# Terminate a list of PIDs: SIGTERM, wait up to ~5s, then SIGKILL survivors.
kill_pids() {
  local pids="$*" p i alive
  [ -n "$pids" ] || return 0
  for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done
  for i in $(seq 1 25); do
    alive=""
    for p in $pids; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
    [ -z "$alive" ] && return 0
    sleep 0.2
  done
  for p in $alive; do kill -KILL "$p" 2>/dev/null || true; done
  sleep 0.5
  for p in $alive; do kill -0 "$p" 2>/dev/null && { log "pid $p refused to die"; FAILED=1; }; done
  return 0
}

# 0. Retire the exit watchdog first (a relaunch starts its own), never ourselves
WATCHDOG_PID_FILE="${XDG_RUNTIME_DIR:-/tmp}/vaultpulse-watchdog.pid"
if [ -f "$WATCHDOG_PID_FILE" ]; then
  WD="$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)"
  if [ -n "$WD" ] && [ "$WD" != "$$" ] && kill -0 "$WD" 2>/dev/null; then kill -TERM "$WD" 2>/dev/null || true; fi
  rm -f "$WATCHDOG_PID_FILE"
fi

# 1. Lock (best effort; the server may already be down)
if command -v curl >/dev/null 2>&1; then
  curl -s -m 3 -X POST "http://127.0.0.1:${PORT}/api/vault/lock" >/dev/null 2>&1 || true
fi
log "vault locked"

# 2. Browser: every process that uses this profile (main + helpers)
BROWSER_PIDS="$(ps -eo pid=,args= | grep -F -- "--user-data-dir=${PROFILE_DIR}" | grep -v -E 'grep|ps -eo' | awk '{print $1}' | tr '\n' ' ')"
kill_pids $BROWSER_PIDS
log "browser closed ($(echo $BROWSER_PIDS | wc -w) processes)"

# 3. Server
SERVER_PIDS="$(pgrep -u "$UID_NUM" -f "^node ${APP_DIR}/server.mjs" | tr '\n' ' ' || true)"
kill_pids $SERVER_PIDS
log "server stopped"

# 4. Private Tor (match by its own torrc path, never by name alone)
TOR_PIDS=""
for p in $(pgrep -u "$UID_NUM" -x tor 2>/dev/null); do
  if tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -qF "${TOR_DIR}/torrc"; then TOR_PIDS="$TOR_PIDS $p"; fi
done
kill_pids $TOR_PIDS
log "private Tor stopped"

# 5. Destroy state
safe_wipe "$PROFILE_DIR"
safe_wipe "$TOR_DIR"
: > "$APP_DIR/data/server.log" 2>/dev/null || true
log "profile, Tor state and server log destroyed"

# 6. Fresh empty profile
mkdir -p "$PROFILE_DIR" && chmod 700 "$PROFILE_DIR" || { log "could not create fresh profile dir"; FAILED=1; }

# Verification pass: nothing of the old session may remain
LEFT="$(ps -eo pid=,args= | grep -F -- "--user-data-dir=${PROFILE_DIR}" | grep -v -E 'grep|ps -eo' | wc -l)"
[ "$LEFT" = "0" ] || { log "verify: $LEFT browser processes still alive"; FAILED=1; }
[ -z "$(ls -A "$PROFILE_DIR" 2>/dev/null)" ] || { log "verify: new profile is not empty"; FAILED=1; }
[ ! -e "$TOR_DIR" ] || { log "verify: Tor state still present"; FAILED=1; }
if [ "$FAILED" -ne 0 ]; then log "COMPLETED WITH PROBLEMS (see above)"; else log "verified clean: fresh empty profile at $PROFILE_DIR"; fi

if [ "$RELAUNCH" -eq 1 ]; then
  log "relaunching fresh (new Tor circuits, new server, new window)..."
  exec "$APP_DIR/launch.sh"
fi
exit "$FAILED"
