#!/usr/bin/env bash
# scripts/check-sql-schema.sh
#
# Three-tier SQL schema sanity check.
#
#   1. DENYLIST — flags references to known-bad column names
#      that have bitten us before (Phase 33 bug class):
#        • valid_until         (never existed on quotes)
#        • ref_number          (never existed on quotes)
#        • recorded_by         (actual column is received_by)
#        • next_follow_up_at   (data is in follow_ups table)
#      Hard fail.
#
#   2. ALIAS CHECK — flags qualified alias.column refs whose
#      column name doesn't appear anywhere in supabase_*.sql.
#      Hard fail.
#
#   3. STRUCTURE WARN — enforces the CLAUDE.md §8 conventions for
#      idempotency and schema reload. Each missing piece is reported
#      as a warning. Hard fail only when run with --strict (so the
#      legacy pre-commit path keeps working until every existing
#      file has been brought up to the new bar):
#
#        • CREATE TABLE without IF NOT EXISTS
#        • ADD COLUMN without IF NOT EXISTS
#        • CREATE POLICY without a matching DROP POLICY IF EXISTS
#        • INSERT INTO without ON CONFLICT / WHERE NOT EXISTS /
#          HAVING NOT EXISTS (any of the three idempotency idioms)
#        • Schema mutation but no `NOTIFY pgrst, 'reload schema';`
#        • No `-- VERIFY` comment block at end
#
# Usage:
#   bash scripts/check-sql-schema.sh path/to/file.sql           # warn-only
#   bash scripts/check-sql-schema.sh --strict path/to/file.sql  # warn → fail

STRICT=0
if [ "$1" = "--strict" ]; then
  STRICT=1
  shift
fi

if [ $# -lt 1 ]; then
  echo "usage: $0 [--strict] <sql-file>" >&2
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

# ─── 3. Structure warnings (CLAUDE.md §8) ─────────────────────────
STRUCT_WARNS=""

# CREATE TABLE without IF NOT EXISTS
if echo "$STRIPPED" | grep -qiE 'create[[:space:]]+table[[:space:]]+(?!if[[:space:]]+not[[:space:]]+exists)' 2>/dev/null; then
  # POSIX grep doesn't support lookahead — do it as a two-step:
  if echo "$STRIPPED" | grep -iE 'create[[:space:]]+table' | grep -qivE 'if[[:space:]]+not[[:space:]]+exists'; then
    STRUCT_WARNS="${STRUCT_WARNS}\n  ⚠ CREATE TABLE without IF NOT EXISTS — file will error on second run."
  fi
fi

# ADD COLUMN without IF NOT EXISTS
if echo "$STRIPPED" | grep -iE 'add[[:space:]]+column' | grep -qivE 'if[[:space:]]+not[[:space:]]+exists'; then
  STRUCT_WARNS="${STRUCT_WARNS}\n  ⚠ ADD COLUMN without IF NOT EXISTS — file will error on second run."
fi

# CREATE POLICY without preceding DROP POLICY IF EXISTS
if echo "$STRIPPED" | grep -qiE 'create[[:space:]]+policy'; then
  if ! echo "$STRIPPED" | grep -qiE 'drop[[:space:]]+policy[[:space:]]+if[[:space:]]+exists'; then
    STRUCT_WARNS="${STRUCT_WARNS}\n  ⚠ CREATE POLICY without a matching DROP POLICY IF EXISTS — file will error on second run."
  fi
fi

# INSERT INTO without an idempotency guard. We accept any of:
#   ON CONFLICT, NOT EXISTS (anywhere in the same file — usually
#   inside a SELECT/HAVING/WHERE subquery), or UPDATE ... ON CONFLICT.
# Skipped when the file defines a PL/pgSQL function body: INSERTs
# inside function bodies are runtime actions, not seed migrations,
# and their idempotency is the function's contract — not something a
# linter at file-level can judge.
if echo "$STRIPPED" | grep -qiE 'insert[[:space:]]+into'; then
  if ! echo "$STRIPPED" | grep -qiE '(on[[:space:]]+conflict|not[[:space:]]+exists)' \
       && ! echo "$STRIPPED" | grep -qiE 'language[[:space:]]+plpgsql'; then
    STRUCT_WARNS="${STRUCT_WARNS}\n  ⚠ INSERT INTO without ON CONFLICT / NOT EXISTS guard — re-running this file will create duplicate rows."
  fi
fi

# NOTIFY pgrst when schema mutates
if echo "$STRIPPED" | grep -qiE '(create|alter|drop)[[:space:]]+(table|column|function|policy|trigger)'; then
  if ! echo "$STRIPPED" | grep -qiE "notify[[:space:]]+pgrst"; then
    STRUCT_WARNS="${STRUCT_WARNS}\n  ⚠ Schema mutation without NOTIFY pgrst, 'reload schema'; — PostgREST may cache stale schema."
  fi
fi

# VERIFY block at end. Accept any comment line containing the word
# VERIFY — decorative `-- ─── VERIFY ───` separators are common.
if ! grep -qE '^[[:space:]]*--.*VERIFY' "$SQL_FILE"; then
  STRUCT_WARNS="${STRUCT_WARNS}\n  ⚠ Missing \`-- VERIFY\` block at end. Owner can't sanity-check the migration after running."
fi

# ─── Report ──────────────────────────────────────────────────────
if [ -z "$DENY_HITS" ] && [ -z "$ALIAS_MISSES" ] && [ -z "$STRUCT_WARNS" ]; then
  echo "OK $(basename "$SQL_FILE")"
  exit 0
fi

# Hard failures
if [ -n "$DENY_HITS" ] || [ -n "$ALIAS_MISSES" ]; then
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
fi

# Structure warnings only
if [ -n "$STRUCT_WARNS" ]; then
  echo ""
  if [ "$STRICT" = "1" ]; then
    echo "✗ Schema check FAILED (--strict) for $(basename "$SQL_FILE")"
  else
    echo "⚠ Schema check WARN for $(basename "$SQL_FILE") (pass without --strict)"
  fi
  echo ""
  echo "Structure issues (CLAUDE.md §8):"
  printf "$STRUCT_WARNS\n"
  echo ""
  [ "$STRICT" = "1" ] && exit 1
fi

echo "OK $(basename "$SQL_FILE") (with warnings)"
exit 0
