#!/usr/bin/env bash
# ============================================================================
# scripts/release-apk.sh — ONE command to build + upload an APK release.
#   sweep iCloud dupes -> clean assembleDebug -> upload to the `apk` bucket via the
#   Supabase CLI (uses your `supabase login` — NO service-role key needed) -> print
#   the publish SQL. You device-test ONE phone, THEN paste the publish SQL to roll
#   the update out to all reps (the in-app "Update available" banner).
#
#   Run:  npm run release:apk
#
# PREREQS (one-time): `supabase login` (done) + the apk bucket exists
#   (supabase_phase180_apk_bucket.sql). assembleDebug keeps the SAME signing key as
#   the reps' installed app so it installs as an update, not a fresh install (§74.1).
#   The space-name sweep + clean avoids the iCloud "X 2.dex defined multiple times"
#   build crash (§74.2).
# ============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
BUCKET_DST="ss:///apk/untitled-os.apk"

echo "==> 1/3  Sweep iCloud space-name dupes (the §74.2 'X 2.dex' crash)"
find android -path '*/build/*' -type f -name '* *' -delete 2>/dev/null || true
find android/app/src/main/res -type f -name '* *' -delete 2>/dev/null || true

echo "==> 2/3  Build web + cap sync + clean assembleDebug"
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

echo "==> 3/3  Upload to Storage apk/untitled-os.apk (Supabase CLI, overwrite)"
supabase storage cp "$APK" "$BUCKET_DST" --experimental
echo "    uploaded → https://app.untitledad.in/apk"

cat <<EOF

NEXT — device-test ONE phone FIRST (§39, never push native to the fleet blind):
  1. On a test phone open  https://app.untitledad.in/apk  → install (updates over the app).
  2. Field-rep login → "Set up" GPS banner → grant the 2 settings → drive ~2 km → check /admin/gps km.

THEN roll out to ALL reps — paste this once in Supabase Studio (this is what
shows the in-app "Update available" banner to everyone):

  INSERT INTO public.app_version (version_code, version_name, apk_url, changelog, is_active)
  VALUES ($VC, '$VN', 'https://kompjctmisnitjpbjalh.supabase.co/storage/v1/object/public/apk/untitled-os.apk?v=$VC', 'GPS fix + in-app updates', true);
  -- apk_url is the DIRECT storage URL (NOT app.untitledad.in/apk): the installed app
  -- OWNS app.untitledad.in, so the banner's browser-download fallback on the old APK
  -- would open the app (login) instead of downloading. The storage domain isn't
  -- captured → it downloads. The native installApk follows either, so this is safe
  -- for both the bootstrap (old APK) and future in-app updates.

EOF
