#!/usr/bin/env bash
# scripts/apk-lint-check.sh
#
# Phase 76.2.2 audit close (audit item 7.2) — Android lint runner.
# Catches things gradlew assembleDebug doesn't flag as errors:
#   - Unused permissions
#   - Manifest typos
#   - Deprecated API usage
#   - Hardcoded strings / accessibility holes
#   - Resource leaks
#
# When to run:
#   - Before every signed release
#   - After bumping AGP version
#   - After adding a new Capacitor plugin
#
# NOT in the standard pre-build flow — too slow (~30-60 sec) for
# every iteration. Manual cadence per CLAUDE.md §35.
#
# Output: android/app/build/reports/lint-results-debug.html
#
# Usage:
#   ./scripts/apk-lint-check.sh
#   open android/app/build/reports/lint-results-debug.html

set -eo pipefail

cd "$(dirname "$0")/.."

red=$'\033[31m'
grn=$'\033[32m'
ylw=$'\033[33m'
clr=$'\033[0m'

echo "${ylw}=== Android lint (Gradle :app:lintDebug) ===${clr}"
echo "This takes 30-60 sec. Stay put."

cd android
./gradlew :app:lintDebug

echo ""
echo "${grn}=== Lint complete ===${clr}"
echo ""
echo "Report (text): android/app/build/reports/lint-results-debug.txt"
echo "Report (html): android/app/build/reports/lint-results-debug.html"
echo ""
echo "Quick view (top issues):"
if [[ -f app/build/reports/lint-results-debug.txt ]]; then
  head -40 app/build/reports/lint-results-debug.txt
fi
