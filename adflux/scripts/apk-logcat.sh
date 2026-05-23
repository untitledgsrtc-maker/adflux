#!/usr/bin/env bash
# scripts/apk-logcat.sh
#
# Phase 76.2.2 — diagnostic logcat tail for the UntitledTracking
# plugin (Phase 76.2). Filters Android logcat for plugin tag +
# Capacitor lifecycle so you see only the lines that matter when
# debugging "is the plugin firing?".
#
# Prerequisites
#   - ADB installed (comes with Android Studio or `brew install
#     android-platform-tools`)
#   - Phone connected via USB + USB debugging enabled
#     (Settings → About phone → tap Build number 7x → Developer
#      options → USB debugging ON)
#   - Phone "Allow USB debugging?" prompt accepted on first run
#
# Usage:
#   ./scripts/apk-logcat.sh
#
# Triage flow:
#   1. Run this script
#   2. Open Untitled OS app on phone
#   3. Watch for:
#        UntitledTracking: load() called
#        UntitledTracking: load() complete — receivers + callback active
#   4. Toggle Location off → look for:
#        UntitledTracking: gpsStateChanged enabled=false
#   5. Toggle airplane mode → look for:
#        UntitledTracking: networkStateChanged online=false
#
# If load() appears but events don't fire → BroadcastReceiver
# register failed. Check log line after "load()" for register
# error.
# If load() never appears → MainActivity.registerPlugin missing
# OR getContext() returned null. Reinstall APK.

set -eo pipefail

if ! command -v adb >/dev/null 2>&1; then
  echo "ERROR: adb not installed. Run: brew install android-platform-tools"
  exit 1
fi

if ! adb devices | grep -q "device$"; then
  echo "ERROR: no USB device detected."
  echo "  1. Plug phone in"
  echo "  2. Enable USB debugging in Developer options"
  echo "  3. Accept the 'Allow USB debugging?' prompt on phone"
  echo "Try: adb devices"
  exit 1
fi

echo "=== Clearing existing logcat buffer ==="
adb logcat -c

echo "=== Streaming UntitledTracking logs (Ctrl-C to stop) ==="
echo ""
adb logcat \
  UntitledTracking:V \
  Capacitor:V \
  CallLogReader:V \
  *:S
