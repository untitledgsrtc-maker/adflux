#!/usr/bin/env bash
# .claude/hooks/PreToolUse.sh
#
# Runs BEFORE Claude executes Write / Edit / MultiEdit.
# stdin = JSON tool payload
# exit 0 = allow, exit 2 = block (Claude sees stderr).
#
# Phase 33Y catches the 6 schema-assumption mistakes from Phase 33
# that cost ~4 hours of round-tripping.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PAYLOAD=""
if [ ! -t 0 ]; then PAYLOAD=$(cat); fi
[ -z "$PAYLOAD" ] && exit 0

if command -v jq >/dev/null 2>&1; then
  TOOL=$(echo "$PAYLOAD" | jq -r '.tool // .tool_name // empty')
  FILE=$(echo "$PAYLOAD" | jq -r '.input.file_path // .tool_input.file_path // empty')
else
  TOOL=$(echo "$PAYLOAD" | grep -oE '"tool"\s*:\s*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  FILE=$(echo "$PAYLOAD" | grep -oE '"file_path"\s*:\s*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

case "$TOOL" in
  "Write"|"Edit"|"MultiEdit") ;;
  *) exit 0 ;;
esac

[ -z "$FILE" ] && exit 0
EXT="${FILE##*.}"

case "$EXT" in
  jsx|tsx)
    if [ -f "$FILE" ]; then
      bash "$REPO_ROOT/scripts/check-jsx-brand.sh" "$FILE" 1>&2 || {
        echo "Brand violation — fix before writing." 1>&2
        exit 2
      }
    fi
    ;;
esac
exit 0
