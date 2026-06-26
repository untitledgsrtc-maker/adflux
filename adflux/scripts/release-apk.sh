#!/usr/bin/env bash
# ============================================================================
# scripts/release-apk.sh — ONE command to ship an APK update to all reps.
#   build the debug APK → upload it to the Supabase `apk` bucket → publish the
#   app_version row. Reps then get the in-app "Update available" banner (2 taps).
#   NO manual Storage drag, no manual SQL.
#
#   Run:  npm run release:apk
#
# ONE-TIME SETUP (do once):
#   1. Run supabase_phase180_apk_bucket.sql in Supabase Studio (creates the bucket).
#   2. Add your service_role key to .env (gitignored, NOT bundled to the client —
#      only VITE_* vars are). One line:
#        SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
#      Get it: Supabase dashboard → Settings → API → service_role ("secret").
#
# WHY assembleDebug (not Release): the reps' installed app is debug-signed
# (~/.android/debug.keystore). A new APK must use the SAME key to install over
# it, so we stay on debug-signing (see CLAUDE.md §74.1/§74.2). The clean +
# space-file sweep avoids the iCloud "X 2.dex defined multiple times" failure.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROJECT_REF="kompjctmisnitjpbjalh"
BUCKET="apk"
OBJECT="untitled-os.apk"

# --- service key (read ONLY that line from .env; don't source the whole file) ---
KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
if [ -z "$KEY" ] && [ -f .env ]; then
  KEY="$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
if [ -z "$KEY" ]; then
  echo "ERROR: SUPABASE_SERVICE_ROLE_KEY not set."
  echo "  Add one line to .env:  SUPABASE_SERVICE_ROLE_KEY=eyJ..."
  echo "  (Supabase dashboard → Settings → API → service_role 'secret')"
  exit 1
fi

echo "==> 1/4  Sweep iCloud space-name dupes under build/ (the 'X 2.dex' crash)"
find android -path '*/build/*' -type f -name '* *' -delete 2>/dev/null || true
find android/app/src/main/res -type f -name '* *' -delete 2>/dev/null || true

echo "==> 2/4  Build web + cap sync + clean assembleDebug"
npm run build
npx cap sync android
( cd android && ./gradlew clean assembleDebug --console=plain )

APK="android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || { echo "ERROR: APK not produced ($APK)"; exit 1; }
BT="$(ls "$HOME/Library/Android/sdk/build-tools/" | sort -V | tail -1)"
AAPT="$HOME/Library/Android/sdk/build-tools/$BT/aapt"
VC="$("$AAPT" dump badging "$APK" | grep -oE "versionCode='[0-9]+'" | grep -oE '[0-9]+')"
VN="$("$AAPT" dump badging "$APK" | grep -oE "versionName='[^']+'" | sed "s/versionName='//; s/'$//")"
echo "    built versionCode=$VC versionName=$VN  ($(ls -lh "$APK" | awk '{print $5}'))"

echo "==> 3/4  Upload to Storage  $BUCKET/$OBJECT  (overwrite)"
HTTP="$(curl -sS -o /tmp/apk_upload_resp -w '%{http_code}' -X POST \
  "https://$PROJECT_REF.supabase.co/storage/v1/object/$BUCKET/$OBJECT" \
  -H "Authorization: Bearer $KEY" \
  -H "x-upsert: true" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary "@$APK")"
if [ "$HTTP" != "200" ]; then
  echo "ERROR: upload HTTP $HTTP"; echo "  $(cat /tmp/apk_upload_resp)"
  echo "  → Did you run supabase_phase180_apk_bucket.sql? Is the service key right?"
  exit 1
fi
echo "    uploaded OK"

echo "==> 4/4  Publish app_version row (version_code=$VC, is_active=true)"
PUB="$(curl -sS -o /tmp/apk_pub_resp -w '%{http_code}' -X POST \
  "https://$PROJECT_REF.supabase.co/rest/v1/app_version" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d "{\"version_code\":$VC,\"version_name\":\"$VN\",\"apk_url\":\"https://app.untitledad.in/apk?v=$VC\",\"changelog\":\"release\",\"is_active\":true}")"
if [ "$PUB" != "201" ] && [ "$PUB" != "200" ]; then
  echo "ERROR: publish HTTP $PUB"; echo "  $(cat /tmp/apk_pub_resp)"; exit 1
fi
echo "    published OK"

echo ""
echo "DONE — v$VC is live."
echo "  Test the link:  https://app.untitledad.in/apk"
echo "  Reps on an older build now see the in-app 'Update available' banner (2 taps)."
