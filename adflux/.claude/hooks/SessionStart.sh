#!/usr/bin/env bash
# .claude/hooks/SessionStart.sh
#
# Runs at the start of a Claude session. Prints context to stdout
# so the model sees current repo state before doing any work.
#
# Output is appended to Claude's system context.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "===== Session start context ====="
echo ""
echo "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
echo "Last 5 commits:"
git log --oneline -5 2>/dev/null || echo "(no git history)"
echo ""
echo "Pending commits (origin..HEAD):"
git log --oneline origin/$(git rev-parse --abbrev-ref HEAD 2>/dev/null)..HEAD 2>/dev/null || echo "(in sync)"
echo ""
echo "Uncommitted changes:"
git status --short 2>/dev/null | head -20 || echo "(clean)"
echo ""
echo "===== Schema columns reference ====="
echo "(grep before any SQL Write — catches the Phase 33 bug class)"
echo ""
for tbl in quotes payments leads users follow_ups work_sessions; do
  echo "--- $tbl ---"
  grep -A30 "CREATE TABLE $tbl" supabase_schema.sql 2>/dev/null | head -30 | grep -E '^\s+[a-z_]+\s+(uuid|text|int|bigint|numeric|boolean|date|timestamp)' | awk '{print "  ."$1}'
  grep -hE "ALTER TABLE\s+(public\.)?$tbl\b" supabase_*.sql 2>/dev/null | head -5 || true
  echo ""
done
echo "===== End context ====="
