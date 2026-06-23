#!/usr/bin/env bash
# check-duplication.sh — Stage 0 reporting tool for the consolidation cleanup.
#
# Reports the "same thing defined in many places" classes from
# DUPLICATION_AUDIT_2026-06-17.md so the disease stays VISIBLE.
#
# NOT a hard build-gate yet — it becomes one in Stage 2, once db/functions/
# exists and each Postgres function has exactly one canonical file. Until then
# this is a diagnostic: run it to see where duplication still lives.
#
# Usage:  bash scripts/check-duplication.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Postgres functions CREATE OR REPLACE'd across >=2 SQL files (collision risk) =="
# The 2 base snapshots (supabase_all_migrations.sql + supabase_schema.sql) are
# generated FULL-SCHEMA fresh-install dumps, not the phase-file disease — they
# legitimately contain every function. Exclude them so the count reflects real
# phase-file duplication (§70 / Phase 178). Canonical bodies live in db/functions/.
SNAP_EXCLUDE="--exclude=supabase_all_migrations.sql --exclude=supabase_schema.sql"
for fn in $(grep -rhoE "CREATE OR REPLACE FUNCTION (public\.)?[a-z0-9_]+" --include='*.sql' $SNAP_EXCLUDE . 2>/dev/null \
            | sed -E 's/.*FUNCTION (public\.)?//' | sort -u); do
  n=$(grep -rlE "CREATE OR REPLACE FUNCTION (public\.)?${fn}\b" --include='*.sql' $SNAP_EXCLUDE . 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -ge 2 ] && printf "  %3d  %s\n" "$n" "$fn"
done | sort -rn

echo ""
echo "== Orphan src files (imported by nothing — dead code) =="
found_orphan=0
while IFS= read -r f; do
  base=$(basename "$f"); name="${base%.*}"
  case "$name" in main|App|index|vite-env|setupTests|sw) continue;; esac
  hits=$(grep -rlE "[/'\"]${name}(\.jsx?)?['\"]" src api index.html 2>/dev/null | grep -vx "$f" | wc -l | tr -d ' ')
  if [ "$hits" -eq 0 ]; then echo "  ORPHAN  $f"; found_orphan=1; fi
done < <(find src -type f \( -name '*.jsx' -o -name '*.js' \) | sort)
[ "$found_orphan" -eq 0 ] && echo "  (none — clean)"

echo ""
echo "See DUPLICATION_AUDIT_2026-06-17.md for the full inventory + cleanup plan."
