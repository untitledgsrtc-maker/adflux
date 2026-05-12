#!/usr/bin/env bash
# scripts/check-sql-schema.sh
#
# Two-tier SQL schema sanity check:
#   1. DENYLIST — flags references to known-bad column names
#      that have bitten us before (Phase 33 bug class):
#        • valid_until         (never existed on quotes)
#        • ref_number          (never existed on quotes)
#        • recorded_by         (actual column is received_by)
#        • next_follow_up_at   (data is in follow_ups table)
#   2. ALIAS CHECK — flags qualified alias.column refs whose
#      column name doesn't appear anywhere in supabase_*.sql.
#
# Usage: bash scripts/check-sql-schema.sh path/to/file.sql

if [ $# -lt 1 ]; then
  echo "usage: $0 <sql-file>" >&2
  exit 2
fi

SQL_FILE="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$SQL_FILE" ]; then
  echo "ERROR: file not found: $SQL_FILE" >&2
  exit 2
fi

# Strip comments first
STRIPPED=$(sed 's/--.*//g' "$SQL_FILE")

# ─── 1. Denylist check ───────────────────────────────────────────
# Each entry is: column_name|why
DENY=(
  "valid_until|quotes table has no valid_until column. Use created_at + interval instead."
  "ref_number|quotes table has no ref_number column. Use quote_number only."
  "recorded_by|payments table column is 'received_by', not 'recorded_by'."
  "next_follow_up_at|leads table has no next_follow_up_at. Follow-up dates live in follow_ups table."
)

DENY_HITS=""
for ENTRY in "${DENY[@]}"; do
  COL="${ENTRY%%|*}"
  WHY="${ENTRY##*|}"
  # Look for the column name as a whole word in non-comment text
  if echo "$STRIPPED" | grep -qE "\b${COL}\b"; then
    DENY_HITS="$DENY_HITS\n  ✗ ${COL} — ${WHY}"
  fi
done

# ─── 2. Alias check ──────────────────────────────────────────────
KNOWN_COLS=$(grep -rhE '^\s+[a-z_][a-z0-9_]+\s+(uuid|text|int|integer|bigint|numeric|boolean|date|timestamp|timestamptz|jsonb|smallint|real|double)' \
             "$REPO_ROOT"/supabase_*.sql 2>/dev/null \
             | awk '{print $1}' | sort -u)
KNOWN_COLS_ALTER=$(grep -rhE 'ADD COLUMN(\s+IF NOT EXISTS)?\s+[a-z_][a-z0-9_]+' \
                   "$REPO_ROOT"/supabase_*.sql 2>/dev/null \
                   | grep -oE 'ADD COLUMN(\s+IF NOT EXISTS)?\s+[a-z_][a-z0-9_]+' \
                   | awk '{print $NF}' | sort -u)
ALL_KNOWN=$(printf "%s\n%s" "$KNOWN_COLS" "$KNOWN_COLS_ALTER" | sort -u)

REFS=$(echo "$STRIPPED" \
       | grep -oE '\b[a-zA-Z_][a-zA-Z0-9_]*\.[a-z_][a-z0-9_]+' \
       | grep -vE '\.(sql|md|jsx|tsx|ts|js|json|csv|html|svg|png|jpg|env)$' \
       | grep -vE '^(pg_|information_schema|public|extensions|auth|net|cron|storage|realtime|jsonb|to_char|round|coalesce|extract|sum|count|max|min|avg|setting|cron|schedule|unschedule|http_post|http_get|generate_series|now|current_setting|jsonb_build_object|application)\.' \
       | sort -u)

EXCLUDE_COLS="id|created_at|updated_at|tg_op|tg_table_name|tg_name|tg_when|tg_level|http_post|http_get|schedule|unschedule|sub|access_token|http_response|publishable"

ALIAS_MISSES=""
if [ -n "$REFS" ] && [ -n "$ALL_KNOWN" ]; then
  for REF in $REFS; do
    COL="${REF##*.}"
    echo "$COL" | grep -qE "^(${EXCLUDE_COLS})$" && continue
    echo "$ALL_KNOWN" | grep -qFx "$COL" && continue
    ALIAS_MISSES="$ALIAS_MISSES\n  ? ${REF}"
  done
fi

# ─── Report ──────────────────────────────────────────────────────
if [ -z "$DENY_HITS" ] && [ -z "$ALIAS_MISSES" ]; then
  echo "OK $(basename "$SQL_FILE")"
  exit 0
fi

echo ""
echo "✗ Schema check FAILED for $(basename "$SQL_FILE")"
if [ -n "$DENY_HITS" ]; then
  echo ""
  echo "Known-bad column references:"
  printf "$DENY_HITS\n"
fi
if [ -n "$ALIAS_MISSES" ]; then
  echo ""
  echo "Unknown alias.column references (verify against actual schema):"
  printf "$ALIAS_MISSES\n"
fi
echo ""
exit 1
