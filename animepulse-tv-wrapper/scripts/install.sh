#!/usr/bin/env bash
# Install (or replace) the wrapper on the Fire TV only, inject the token, launch.
# Does not uninstall other apps. Does not change Fire TV settings.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERIAL="${FIRE_TV_SERIAL:-10.146.65.136:5555}"
PKG="com.masumane.animepulse.tvwrapper"
APK="$ROOT/build/animepulse-tv-wrapper.apk"
ADB="${ADB:-adb}"

if [[ ! -f "$APK" ]]; then
  echo "APK not found. Run ./build.sh first." >&2
  exit 1
fi

# Safety: never target the phone.
if [[ "$SERIAL" != "10.146.65.136:5555" ]]; then
  echo "Refusing to use serial $SERIAL (Fire TV only)." >&2
  exit 1
fi

echo "Installing $APK on $SERIAL (adb install -r, no uninstall)..."
"$ADB" -s "$SERIAL" install -r "$APK"

"$ROOT/scripts/install-token.sh"

echo "Launching wrapper..."
"$ADB" -s "$SERIAL" shell am start -n "$PKG/.MainActivity"
echo "Launched."
