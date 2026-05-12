#!/usr/bin/env bash
# scripts/check-jsx-brand.sh
#
# Catches brand-token violations in JSX files before commit.
# Per CLAUDE.md §5, the only acceptable yellow is var(--accent, #FFE600).
# Hardcoded #facc15 (Tailwind's default yellow) is a hard-fail.
#
# Usage:
#   bash scripts/check-jsx-brand.sh path/to/file.jsx
#
# Exit codes:
#   0  — clean
#   1  — at least one violation found

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <jsx-file>"
  exit 2
fi

JSX_FILE="$1"
if [ ! -f "$JSX_FILE" ]; then
  echo "ERROR: file not found: $JSX_FILE"
  exit 2
fi

VIOLATIONS=$(grep -nE '#facc15|#0a0e1a' "$JSX_FILE" || true)

if [ -z "$VIOLATIONS" ]; then
  exit 0
fi

echo ""
echo "✗ Brand check FAILED for $(basename "$JSX_FILE")"
echo ""
echo "Hardcoded legacy colors found (CLAUDE.md §5 violation):"
echo "$VIOLATIONS"
echo ""
echo "Replace:"
echo "  '#facc15'  →  'var(--accent, #FFE600)'"
echo "  '#0a0e1a'  →  'var(--accent-fg, #0f172a)'"
exit 1
