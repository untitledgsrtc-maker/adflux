#!/usr/bin/env bash
# scripts/apk-prebuild-check.sh
#
# Phase 76.2.2 — pre-flight sanity check before APK builds.
# Catches the classes of failures that wasted hours during the
# 23 May 2026 build cycle:
#   1. macOS Finder duplicate files in android/app/src/main/res/
#      named "config 2.xml" etc. → Gradle mergeResources fails.
#   2. Stale Gradle daemon eating heap → kills it pre-emptively.
#   3. JDK version mismatch → Capacitor 8 needs JDK 17+.
#   4. Stale Vite dist/ vs latest src/ → forces rebuild.
#
# Usage:
#   ./scripts/apk-prebuild-check.sh
#
# Exits non-zero if any check fails — chain into your build
# pipeline:
#   ./scripts/apk-prebuild-check.sh && npm run build && npx cap sync android && cd android && ./gradlew assembleDebug

set -eo pipefail

cd "$(dirname "$0")/.."

red=$'\033[31m'
grn=$'\033[32m'
ylw=$'\033[33m'
clr=$'\033[0m'

fail=0

echo "${ylw}=== Pre-build sanity check ===${clr}"

# 1. macOS duplicate files anywhere Gradle / Capacitor reads
#    res/    → Gradle mergeResources hard-fails on these
#    dist/   → Vite output, cap sync copies into assets/public
#    public/ → static, also lands in assets/public
#    android/app/src/main/assets/public/ → already-synced; clean stale
dup_paths=(
  android/app/src/main/res
  android/app/src/main/assets
  dist
  public
)
dups=""
for p in "${dup_paths[@]}"; do
  [[ -d "$p" ]] || continue
  found=$(find "$p" -type f -name "* *" 2>/dev/null || true)
  [[ -n "$found" ]] && dups="${dups}${found}"$'\n'
done
if [[ -n "$dups" ]]; then
  echo "${red}FAIL — macOS Finder duplicate files found:${clr}"
  echo "$dups"
  echo "Run:  find . \\( -path ./node_modules -prune \\) -o -type f -name '* *' -delete"
  fail=1
else
  echo "${grn}OK — no duplicate space-named files${clr}"
fi

# 2. JDK version
jver=$(java -version 2>&1 | head -1 | grep -oE '"[0-9]+' | tr -d '"' || echo "0")
if (( jver < 17 )); then
  echo "${red}FAIL — JDK $jver < 17, Capacitor 8 needs JDK 17+${clr}"
  fail=1
else
  echo "${grn}OK — JDK $jver${clr}"
fi

# 3. Stop any stale Gradle daemon
if [[ -x android/gradlew ]]; then
  (cd android && ./gradlew --stop > /dev/null 2>&1) && \
    echo "${grn}OK — daemons stopped${clr}" || \
    echo "${ylw}note — no daemons to stop${clr}"
fi

# 4. Vite dist exists?
if [[ ! -d dist ]] || [[ -z "$(ls -A dist 2>/dev/null)" ]]; then
  echo "${ylw}note — dist/ missing or empty, run 'npm run build' first${clr}"
fi

# 5. Capacitor config — bundled or live-update?
if grep -q '"server"' capacitor.config.json; then
  echo "${ylw}note — capacitor.config.json has server.url (live-update mode)${clr}"
else
  echo "${grn}OK — capacitor.config.json is bundled mode${clr}"
fi

# 6. Disk space (need 5+ GB free for Gradle build)
free_kb=$(df -k . | tail -1 | awk '{print $4}')
free_gb=$((free_kb / 1024 / 1024))
if (( free_gb < 5 )); then
  echo "${red}FAIL — only ${free_gb} GB free, Gradle build needs 5+${clr}"
  fail=1
else
  echo "${grn}OK — ${free_gb} GB free${clr}"
fi

if (( fail == 1 )); then
  echo "${red}=== Pre-build check FAILED — fix above + retry ===${clr}"
  exit 1
fi

echo "${grn}=== Pre-build check PASS ===${clr}"
