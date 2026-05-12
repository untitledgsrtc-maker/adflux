#!/usr/bin/env bash
# .claude/hooks/PostToolUse.sh
#
# Runs AFTER Claude's Write / Edit completes.
# Validates the file on disk. Exit 2 alerts Claude that the just-
# written file has a problem so it can fix in a follow-up.
#
# Catches:
#   • SQL files that reference non-existent columns (schema check)
#   • JSX files that fail esbuild parse (catch SyntaxError early)

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

[ -z "$FILE" ] || [ ! -f "$FILE" ] && exit 0
EXT="${FILE##*.}"

case "$EXT" in
  sql)
    bash "$REPO_ROOT/scripts/check-sql-schema.sh" "$FILE" 1>&2 || {
      echo "SQL schema check failed for $FILE." 1>&2
      echo "Verify the column references before deploying." 1>&2
      exit 2
    }
    ;;
  jsx|tsx)
    bash "$REPO_ROOT/scripts/check-jsx-brand.sh" "$FILE" 1>&2 || exit 2
    # Parse-check with esbuild if available
    if [ -x "$REPO_ROOT/node_modules/.bin/esbuild" ]; then
      "$REPO_ROOT/node_modules/.bin/esbuild" --loader:.jsx=jsx --log-level=warning "$FILE" >/dev/null 2>&1 || {
        echo "esbuild parse error in $FILE." 1>&2
        exit 2
      }
    fi
    ;;
esac
exit 0
