#!/usr/bin/env bash
# ============================================================================
# scripts/release-apk.sh — ONE command to build + upload an APK release.
#   preflight -> sweep iCloud dupes -> build web -> prune unused media -> clean
#   assembleDebug -> check the signing key -> back up what reps are served now ->
#   replace apk/untitled-os.apk -> verify the live link serves the new build ->
#   print the publish SQL. This script never inserts the app_version row itself -
#   that stays your deliberate go-live step.
#
#   Run:        npm run release:apk
#   Rehearse:   DRY_RUN=1 npm run release:apk    (builds + checks, touches NOTHING live;
#                                                 any value other than 0/false/no = dry)
#   Re-ship the same versionCode on purpose:  FORCE=1 npm run release:apk
#   Re-use the APK already built (skip the build), e.g. after a failed verify:
#                SKIP_BUILD=1 npm run release:apk
#
# !! HEADS-UP (CLAUDE.md §317): the moment the upload lands, the new file IS what
#    https://app.untitledad.in/apk serves. Anyone who taps the EXISTING "Update
#    available" banner (stragglers on an older version) or opens /apk gets this build
#    before the app_version row exists. So release OUTSIDE field hours (before 9:30 or
#    after 19:30 IST) and test on your phone straight away. Going live for the fleet
#    (the new banner) is still only the INSERT printed at the end.
#
# PREREQS (one-time): `supabase login` + the apk bucket exists
#   (supabase_phase180_apk_bucket.sql). assembleDebug keeps the SAME signing key as
#   the reps' installed app so it installs as an update, not a fresh install (§74.1);
#   this script pins that key and refuses to ship a build signed with a different one.
#   The space-name sweep + clean avoids the iCloud "X 2.dex defined multiple times"
#   build crash (§74.2).
#
# WHY THE PRUNE (§316): the app runs in live-update mode (capacitor.config.json has
#   server.url -> it loads app.untitledad.in), so the web files copied INTO the APK are
#   only an offline fallback. public/deck|investor|led|email are ~57 MB of sales media
#   nobody opens from inside the APK; without the prune the APK is ~45 MB instead of
#   ~9 MB and every in-app update eats that much mobile data. Bundled mode (no
#   server.url) needs the full build, so the prune is skipped there.
#
# HOW THE SWAP STAYS SAFE (§316/§317): `supabase storage cp` has no overwrite flag (409
#   Duplicate) and `storage rm` asks y/N, so the live object is removed then re-uploaded.
#   That is only done AFTER (a) the bucket itself confirmed the object exists (not a flaky
#   download), (b) a full, readable copy of it is saved in ~/apk-backups, and (c) a trap
#   is armed that puts that copy back on ANY failure/Ctrl-C/terminal-close in between.
#   The live /api/apk link is then checked against the build - that check, not the CLI
#   exit code, decides whether the release landed.
# ============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
BUCKET_DST="ss:///apk/untitled-os.apk"
BUCKET_DIR="ss:///apk/"
OBJ_NAME="untitled-os.apk"
LIVE_URL="https://app.untitledad.in/api/apk"
APK_MIME="application/vnd.android.package-archive"
PRUNE_DIRS="deck investor led email email-footers"
MAX_LIVE_APK_MB=25            # a live-update APK bigger than this means the prune did not work
# the debug key the reps' installed app was signed with (§74.1/§316) - a different key = phones refuse the update
EXPECT_CERT="${EXPECT_CERT:-15d785ae92e7b2178b3a36da75d8c866044ee114877e0fc5f62ad4ca64d42fe6}"
VERIFY_POLL_SECS="${VERIFY_POLL_SECS:-5}"
TMP="${TMPDIR:-/tmp}"; TMP="${TMP%/}"
BACKUP_DIR="${APK_BACKUP_DIR:-$HOME/apk-backups}"

# --- flags: unknown/odd spellings fail SAFE (DRY_RUN) or OFF (FORCE/SKIP_BUILD) ---
case "${DRY_RUN:-0}" in 0|""|false|FALSE|False|no|NO|No) DRY_RUN=0 ;; *) DRY_RUN=1 ;; esac
case "${FORCE:-0}" in 1|true|TRUE|True|yes|YES|Yes) FORCE=1 ;; *) FORCE=0 ;; esac
case "${SKIP_BUILD:-0}" in 1|true|TRUE|True|yes|YES|Yes) SKIP_BUILD=1 ;; *) SKIP_BUILD=0 ;; esac
case "${ALLOW_NEW_KEY:-0}" in 1|true|TRUE|True|yes|YES|Yes) ALLOW_NEW_KEY=1 ;; *) ALLOW_NEW_KEY=0 ;; esac

echo "==> 0/4  Preflight"
for tool in node npm npx curl unzip supabase; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: '$tool' not found on PATH"; exit 1; }
done
BT_DIR="$HOME/Library/Android/sdk/build-tools"
[ -d "$BT_DIR" ] || { echo "ERROR: Android build-tools not found at $BT_DIR"; exit 1; }
BT="$(ls "$BT_DIR" | sort -V | tail -1)"
AAPT2="$BT_DIR/$BT/aapt2"
APKSIGNER="$BT_DIR/$BT/apksigner"
[ -x "$AAPT2" ] || { echo "ERROR: aapt2 not found at $AAPT2"; exit 1; }
[ -x "$APKSIGNER" ] || { echo "ERROR: apksigner not found at $APKSIGNER"; exit 1; }

# versionCode of an APK file; prints at most one number, never aborts the script
vc_of() { "$AAPT2" dump badging "$1" 2>/dev/null | grep -oE "versionCode='[0-9]+'" | grep -oE '[0-9]+' | head -1 || true; }

# What the bucket really holds is the authority on "first release" - NOT whether a download worked.
# (api/apk.js answers 502 both for "object missing" and for "Supabase blip".)
OBJ_LIST="$(supabase storage ls "$BUCKET_DIR" --experimental 2>/dev/null)" || {
  echo "ERROR: cannot list the apk bucket (supabase login / project link problem?). Nothing was changed."; exit 1; }
OBJ_EXISTS=0
if grep -qx "$OBJ_NAME" <<<"$OBJ_LIST"; then OBJ_EXISTS=1; fi
echo "    bucket check: $OBJ_NAME $( [ "$OBJ_EXISTS" = 1 ] && echo 'exists (a backup will be taken)' || echo 'absent (first release)' )"

# live-update mode? (capacitor.config.json has a server.url). Exit 0=yes 1=no 2=unreadable.
set +e
node -e "try{const c=JSON.parse(require('fs').readFileSync('capacitor.config.json','utf8'));process.exit(c.server&&c.server.url?0:1)}catch(e){process.exit(2)}"
NODE_RC=$?
set -e
case "$NODE_RC" in
  0) LIVE_MODE=1 ;;
  1) LIVE_MODE=0 ;;
  *) echo "ERROR: capacitor.config.json is missing or not valid JSON - cannot tell live-update from bundled mode"; exit 1 ;;
esac

APK="android/app/build/outputs/apk/debug/app-debug.apk"

if [ "$SKIP_BUILD" = "1" ]; then
  echo "==> 1-2/4  SKIP_BUILD=1 - using the APK already built at $APK"
  [ -f "$APK" ] || { echo "ERROR: SKIP_BUILD=1 but no APK at $APK"; exit 1; }
else
  echo "==> 1/4  Sweep iCloud space-name dupes (the §74.2 'X 2.dex' crash)"
  find android -path '*/build/*' -type f -name '* *' -delete 2>/dev/null || true
  find android/app/src/main/res -type f -name '* *' -delete 2>/dev/null || true

  echo "==> 2/4  Build web + prune + cap sync + clean assembleDebug"
  npm run build
  if [ "$LIVE_MODE" = "1" ]; then
    for d in $PRUNE_DIRS; do rm -rf "dist/$d"; done
    echo "    live-update mode: pruned from the bundled copy: $PRUNE_DIRS"
  else
    echo "    WARNING: bundled mode (no server.url) - NOT pruning; the APK needs the full web build"
  fi
  # start the copied web assets from empty (also drops stale files and iCloud " 2" copies)
  rm -rf android/app/src/main/assets/public
  npx cap sync android
  ( cd android && ./gradlew clean assembleDebug --console=plain )
  [ -f "$APK" ] || { echo "ERROR: APK not produced ($APK)"; exit 1; }
fi

VC="$(vc_of "$APK")"
[ -n "$VC" ] || { echo "ERROR: could not read versionCode from $APK"; exit 1; }
VN="$("$AAPT2" dump badging "$APK" 2>/dev/null | grep -oE "versionName='[^']+'" | head -1 | sed "s/versionName='//; s/'$//" || true)"
SIZE_BYTES="$(wc -c < "$APK" | tr -d ' ')"
SIZE_MB=$(( SIZE_BYTES / 1048576 ))
echo "    built versionCode=$VC versionName=$VN  (${SIZE_MB} MB)"
if [ "$LIVE_MODE" = "1" ] && [ "$SIZE_MB" -gt "$MAX_LIVE_APK_MB" ]; then
  echo "ERROR: APK is ${SIZE_MB} MB (> ${MAX_LIVE_APK_MB} MB) in live-update mode - the media prune did not work. Not uploading."
  exit 1
fi

# signing key: gradle silently makes a NEW debug keystore if ~/.android/debug.keystore vanished
CERT="$("$APKSIGNER" verify --print-certs "$APK" 2>/dev/null | grep -m1 'SHA-256' | awk '{print $NF}' || true)"
if [ "$CERT" != "$EXPECT_CERT" ]; then
  if [ "$ALLOW_NEW_KEY" = "1" ]; then
    echo "    WARNING: signing key is '${CERT:-unreadable}' (not the pinned one) - ALLOW_NEW_KEY=1, continuing. Installed phones will REFUSE this update."
  else
    echo "ERROR: APK is signed with '${CERT:-unreadable}', not the key the reps' app was installed with ($EXPECT_CERT)."
    echo "       Phones would refuse the update. Check ~/.android/debug.keystore. (ALLOW_NEW_KEY=1 overrides - only for a deliberate key change.)"
    exit 1
  fi
fi
echo "    signing key OK (matches the reps' installed app)"

echo "==> 3/4  Back up the APK reps are served right now"
BACKUP=""; SERVED_VC=0
if [ "$OBJ_EXISTS" = "1" ]; then
  mkdir -p "$BACKUP_DIR"
  B="$BACKUP_DIR/untitled-os-served-$(date +%Y%m%d-%H%M%S).apk"
  if ! curl -fsSL --retry 3 --connect-timeout 15 --max-time 180 "$LIVE_URL?v=$(date +%s)" -o "$B"; then
    rm -f "$B"
    echo "ERROR: the bucket has $OBJ_NAME but it could not be downloaded to back it up. Refusing to replace it blind. Nothing was changed - try again."
    exit 1
  fi
  if ! unzip -tq "$B" >/dev/null 2>&1; then
    rm -f "$B"
    echo "ERROR: the served file is not a complete APK (download truncated or an error page). Refusing to replace it blind. Nothing was changed."
    exit 1
  fi
  SERVED_VC="$(vc_of "$B")"
  case "$SERVED_VC" in
    ''|*[!0-9]*) rm -f "$B"; echo "ERROR: could not read a versionCode from the served APK. Nothing was changed."; exit 1 ;;
  esac
  BACKUP="$B"
  echo "    served now: versionCode=$SERVED_VC   (backup: $BACKUP)"
else
  echo "    nothing served yet (confirmed by the bucket listing) - no backup needed"
fi
if [ "$SERVED_VC" -ge "$VC" ] && [ "$FORCE" != "1" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    echo "    NOTE (dry run): a real run would STOP here - served versionCode $SERVED_VC >= built $VC (bump android/app/build.gradle, or FORCE=1)"
  else
    echo "ERROR: reps are already served versionCode $SERVED_VC >= the build's $VC. Bump versionCode in android/app/build.gradle, or run with FORCE=1 to re-ship it deliberately."
    exit 1
  fi
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "==> DRY RUN complete - nothing was uploaded or changed. Build: versionCode=$VC, ${SIZE_MB} MB."
  exit 0
fi

echo "==> 4/4  Replace $OBJ_NAME and verify the live link"
RM_DONE=0; UPLOAD_OK=0

# what the public link really serves right now (used after any failure so the operator is told the truth)
describe_live() {
  local f="$TMP/untitled-os-live-state.apk" v
  if curl -fsSL --connect-timeout 15 --max-time 120 "$LIVE_URL?v=$(date +%s)" -o "$f" 2>/dev/null; then
    v="$(vc_of "$f")"
    echo "    LIVE NOW: $LIVE_URL serves versionCode=${v:-unreadable}"
  else
    echo "    LIVE NOW: $LIVE_URL is DOWN (the download failed)"
  fi
}

# on ANY exit (failure, Ctrl-C, terminal close) between "old object removed" and "new one uploaded": put the old one back
cleanup() {
  local rc=$?
  trap - EXIT
  if [ "$RM_DONE" = "1" ] && [ "$UPLOAD_OK" != "1" ]; then
    echo ""
    echo "!! Stopped while the live APK was being replaced - restoring the previous one."
    if [ -n "$BACKUP" ] && [ -s "$BACKUP" ]; then
      echo y | supabase storage rm "$BUCKET_DST" --experimental >/dev/null 2>&1 || true   # clear any half-uploaded object
      if supabase storage cp "$BACKUP" "$BUCKET_DST" --experimental --content-type "$APK_MIME"; then
        echo "    restored from $BACKUP"
      else
        echo "    RESTORE FAILED - re-upload $BACKUP to $BUCKET_DST by hand NOW (reps get an error from /apk until you do)"
      fi
    else
      echo "    no backup exists (first release) - nothing to restore"
    fi
    describe_live
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

if [ "$OBJ_EXISTS" = "1" ]; then
  RM_DONE=1
  echo y | supabase storage rm "$BUCKET_DST" --experimental >/dev/null 2>&1 || true
  AFTER="$(supabase storage ls "$BUCKET_DIR" --experimental 2>/dev/null || true)"
  if grep -qx "$OBJ_NAME" <<<"$AFTER"; then
    RM_DONE=0
    echo "ERROR: could not remove the old $OBJ_NAME (the live APK is untouched). Nothing was changed."
    exit 1
  fi
fi
RM_DONE=1
if ! supabase storage cp "$APK" "$BUCKET_DST" --experimental --content-type "$APK_MIME"; then
  echo "UPLOAD FAILED"
  exit 1      # the cleanup trap restores the previous APK
fi
UPLOAD_OK=1

# verify the PUBLIC link: poll, because storage -> proxy can take a few seconds
CHECK="$TMP/untitled-os-live-check.apk"
LIVE_VC=""; VERIFIED=0; WHY="the download failed"
for i in 1 2 3 4 5 6; do
  sleep "$VERIFY_POLL_SECS"
  rm -f "$CHECK"
  if curl -fsSL --connect-timeout 15 --max-time 120 "$LIVE_URL?v=$(date +%s)" -o "$CHECK" 2>/dev/null; then
    LIVE_VC="$(vc_of "$CHECK")"
    if [ "$LIVE_VC" != "$VC" ]; then
      WHY="the link still serves versionCode='${LIVE_VC:-unreadable}', expected $VC"
    elif ! cmp -s "$APK" "$CHECK"; then
      WHY="the versionCode matches but the bytes differ from this build"
    else
      VERIFIED=1; break
    fi
  else
    WHY="the download failed (HTTP error / timeout)"
  fi
done
if [ "$VERIFIED" != "1" ]; then
  echo "VERIFY FAILED after $i tries: $WHY."
  echo "    The upload itself went through. Re-check in a minute:  SKIP_BUILD=1 FORCE=1 npm run release:apk"
  echo "    (or curl -sL $LIVE_URL -o /tmp/x.apk). Do NOT roll back unless it still fails."
  [ -n "$BACKUP" ] && echo "    Previous APK saved at: $BACKUP"
  exit 1
fi
trap - EXIT
echo "    live link serves versionCode=$VC, byte-identical to this build  → $LIVE_URL"

cat <<EOF

NEXT — test on ONE phone NOW (§39, never push native to the fleet blind). Remember: until you
do the step below, only stragglers who tap the OLD banner or open /apk get this build.
  1. On a test phone open  https://app.untitledad.in/apk  → install (updates over the app).
  2. Field-rep login → "Set up" GPS banner → grant the 2 settings → drive ~2 km → check /admin/gps km.

THEN roll out to ALL reps — paste this once in Supabase Studio (this is what
shows the in-app "Update available" banner to everyone):

  INSERT INTO public.app_version (version_code, version_name, apk_url, changelog, is_active)
  VALUES ($VC, '$VN', 'https://app.untitledad.in/apk', '<what changed, one line>', true);
  -- apk_url is https://app.untitledad.in/apk (CLAUDE.md §76): the /api/apk proxy serves
  -- the file with the right content-type, and the app's service worker lets the link
  -- through. The banner reads the highest active version_code.

ROLLBACK: set is_active=false on that row (stops the banner for people not yet updated) and
  re-upload the previous APK (saved: ${BACKUP:-none}). Phones that ALREADY installed this
  build cannot be downgraded by Android - for them ship the old code under a HIGHER versionCode.

EOF
