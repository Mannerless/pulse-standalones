#!/usr/bin/env bash
# Write the share token into the installed app's private storage.
# Never prints the token. Does not leave a copy under /data/local/tmp.
set -euo pipefail

SERIAL="${FIRE_TV_SERIAL:-10.146.65.136:5555}"
PKG="com.masumane.animepulse.tvnative"
TOKEN_FILE="${ANIMEPULSE_SHARE_TOKEN_FILE:-$HOME/.config/animepulse/share_token}"
ADB="${ADB:-adb}"

if [[ "$SERIAL" != "10.146.65.136:5555" ]]; then
  echo "Refusing to use serial $SERIAL (Fire TV only)." >&2
  exit 1
fi
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Token file not found at expected path." >&2
  exit 1
fi
if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  echo "Fire TV $SERIAL is not reachable." >&2
  exit 1
fi

# base64 over stdin; adb shell must receive the remote command as one string
# so run-as's -c script stays quoted on the device.
python3 - "$ADB" "$SERIAL" "$PKG" "$TOKEN_FILE" << 'PY'
import base64, subprocess, sys
from pathlib import Path
adb, serial, pkg, token_file = sys.argv[1:5]
raw = Path(token_file).read_bytes().strip()
if not raw:
    print("Token file is empty.", file=sys.stderr)
    sys.exit(1)
b64 = base64.b64encode(raw) + b"\n"
remote = (
    f"run-as {pkg} /system/bin/sh -c "
    f"'mkdir -p files && base64 -d > files/share_token && chmod 600 files/share_token && chmod 700 files && wc -c files/share_token'"
)
p = subprocess.run([adb, "-s", serial, "shell", remote],
                   input=b64, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
out = p.stdout.decode("utf-8", "replace").strip()
err = p.stderr.decode("utf-8", "replace").strip()
first = out.split()[0] if out else ""
if p.returncode == 0 and first.isdigit() and int(first) == len(raw):
    print("Token written to app-private storage (byte count matches; value not printed).")
    sys.exit(0)
print("Token inject failed; not printing command output.", file=sys.stderr)
if err and len(err) < 300:
    print("stderr:", err, file=sys.stderr)
sys.exit(1)
PY
