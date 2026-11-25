#!/usr/bin/env bash
# Build and sign the Anime Pulse TV wrapper APK.
# Never prints or packages the share token (see scripts/install-token.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/home/dev/android-sdk}}"
BT="${ANDROID_BUILD_TOOLS:-$SDK/build-tools/34.0.0}"
D8_BT="${ANDROID_D8_BUILD_TOOLS:-$SDK/build-tools/36.1.0}"
ANDROID_JAR="$SDK/platforms/android-33/android.jar"
AAPT="$BT/aapt"
D8="$D8_BT/d8"
ZIPALIGN="$BT/zipalign"
APKSIGNER="$BT/apksigner"
JAVAC="${JAVAC:-javac}"

KEYSTORE="${ANIMEPULSE_TV_KEYSTORE:-$HOME/.android/animepulse-tv.keystore}"
KEYALIAS="${ANIMEPULSE_TV_KEYALIAS:-animepulse-tv}"
PASSDIR="$HOME/.android"
PASSFILE="$PASSDIR/animepulse-tv.keystore.pass"

PKG="com.masumane.animepulse.tvwrapper"
OUT="$ROOT/build"
# Keep APKs out of the git tree's easy-to-commit root; still under build/ (gitignored).
APK_UNSIGNED="$OUT/animepulse-tv-wrapper-unsigned.apk"
APK_ALIGNED="$OUT/animepulse-tv-wrapper-aligned.apk"
APK_SIGNED="$OUT/animepulse-tv-wrapper.apk"

if [[ ! -f "$ANDROID_JAR" ]]; then
  echo "android.jar not found at $ANDROID_JAR" >&2
  exit 1
fi
if [[ ! -x "$AAPT" || ! -x "$D8" ]]; then
  echo "build-tools missing under $BT" >&2
  exit 1
fi

mkdir -p "$PASSDIR"
chmod 700 "$PASSDIR" 2>/dev/null || true

if [[ ! -f "$KEYSTORE" ]]; then
  if [[ ! -f "$PASSFILE" ]]; then
    # random password, never printed
    umask 077
    { p=$(openssl rand -base64 24 | tr -d "\n"); printf "%s\n%s\n" "$p" "$p"; } > "$PASSFILE"
    chmod 600 "$PASSFILE"
  fi
  umask 077
  # keytool reads pass from file via stdin-like flag; do not echo it
  keytool -genkeypair \
    -keystore "$KEYSTORE" \
    -alias "$KEYALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storetype PKCS12 \
    -dname "CN=Anime Pulse TV, OU=Local, O=Patrick Melton, C=US" \
    -storepass:file "$PASSFILE" \
    -keypass:file "$PASSFILE"
  chmod 600 "$KEYSTORE"
  echo "Created keystore at $KEYSTORE (mode 600)."
fi
chmod 600 "$KEYSTORE" "$PASSFILE"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

# If a baked token asset was left behind, refuse unless explicitly allowed.
if [[ -f "$ROOT/assets/share_token" && "${ALLOW_BAKED_TOKEN:-}" != "1" ]]; then
  echo "Refusing to build: assets/share_token exists. Remove it or set ALLOW_BAKED_TOKEN=1." >&2
  exit 1
fi

ASSET_FLAGS=()
if [[ -d "$ROOT/assets" ]]; then
  ASSET_FLAGS=(-A "$ROOT/assets")
fi

"$AAPT" package -f -m \
  -J "$OUT/gen" \
  -M "$ROOT/AndroidManifest.xml" \
  -S "$ROOT/res" \
  "${ASSET_FLAGS[@]}" \
  -I "$ANDROID_JAR" \
  --min-sdk-version 22 \
  --target-sdk-version 28 \
  --version-code 1 \
  --version-name 1.0

"$JAVAC" --release 8 \
  -encoding UTF-8 \
  -cp "$ANDROID_JAR" \
  -d "$OUT/classes" \
  "$OUT/gen/com/masumane/animepulse/tvwrapper/R.java" \
  "$ROOT/src/com/masumane/animepulse/tvwrapper/MainActivity.java"

# d8 wants files or a dir of class files
mapfile -t CLASS_FILES < <(find "$OUT/classes" -name '*.class')
"$D8" --min-api 22 --lib "$ANDROID_JAR" --output "$OUT/dex" "${CLASS_FILES[@]}"

"$AAPT" package -f \
  -M "$ROOT/AndroidManifest.xml" \
  -S "$ROOT/res" \
  "${ASSET_FLAGS[@]}" \
  -I "$ANDROID_JAR" \
  -F "$APK_UNSIGNED" \
  --min-sdk-version 22 \
  --target-sdk-version 28 \
  --version-code 1 \
  --version-name 1.0

# aapt add needs to run from the dex dir so classes.dex is at apk root
cp "$OUT/dex/classes.dex" "$OUT/classes.dex"
( cd "$OUT" && "$AAPT" add "$(basename "$APK_UNSIGNED")" classes.dex >/dev/null )

"$ZIPALIGN" -f -p 4 "$APK_UNSIGNED" "$APK_ALIGNED"

"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$KEYALIAS" \
  --ks-pass "file:$PASSFILE" \
  --key-pass "file:$PASSFILE" \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --out "$APK_SIGNED" \
  "$APK_ALIGNED"

"$APKSIGNER" verify --verbose "$APK_SIGNED" | grep -v 'key id' || true
echo "Built $APK_SIGNED"
ls -l "$APK_SIGNED"
