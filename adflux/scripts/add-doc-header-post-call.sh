#!/usr/bin/env bash
# Phase 253 — add the brochure DOCUMENT header to post_call_callback +
# post_call_nurture (owner decision 22 Jul: PDF on Call-later + Nurture too;
# post_call_lost deliberately stays PDF-free — one polite sign-off, §120).
#
# WHY A SCRIPT AND NOT JUST SQL: the two Meta templates were APPROVED WITHOUT
# a document header. If supabase_phase253b_postcall_pdf_map.sql is run first,
# every callback/nurture send includes a header parameter the approved template
# doesn't have → Meta REJECTS the send → the button errors for every rep.
# Order is: run THIS script → wait for both templates to show Active again in
# WhatsApp Manager → THEN run the SQL.
#
# ⚠ DOWNTIME WINDOW: editing an approved template puts it back into review
# (usually minutes-to-hours for Utility). While a template is In review /
# Pending it CANNOT be sent — reps tapping "Send from company number" on a
# Call-later or Nurture outcome will see an error until Meta re-approves.
# Run this at the end of the workday. Good / Maybe / Lost are unaffected.
#
# Meta caps edits at 1/day and 10/month per template — don't re-run on a whim.
#
# USAGE
#   export TOKEN='<fresh System User token>'   # generate in Meta (§119 — the
#                                              # Vercel one can't be read back;
#                                              # NEVER click "Revoke tokens")
#   export BROCHURE_URL='https://…/brochure.pdf'   # companies.brochure_url
#   bash scripts/add-doc-header-post-call.sh
set -uo pipefail

WABA_ID="${WABA_ID:-2870129030006085}"   # marketing WABA (98982 73686, §119)
APP_ID="${APP_ID:-1443324144491532}"     # the "Waba" app
GRAPH="https://graph.facebook.com/v21.0"

if [ -z "${TOKEN:-}" ]; then echo "ERROR: export TOKEN=... first"; exit 1; fi
if [ -z "${BROCHURE_URL:-}" ]; then echo "ERROR: export BROCHURE_URL=... first"; exit 1; fi

# ── 1. upload the brochure sample → header handle ───────────────────────────
echo "→ downloading brochure…"
TMP="$(mktemp -t brochure).pdf"
curl -fsSL "$BROCHURE_URL" -o "$TMP" || { echo "ERROR: brochure download failed"; exit 1; }
LEN=$(wc -c < "$TMP" | tr -d ' ')
echo "  got $LEN bytes"
echo "→ opening Meta upload session…"
SESSION=$(curl -sS -X POST \
  "$GRAPH/$APP_ID/uploads?file_name=brochure.pdf&file_length=$LEN&file_type=application/pdf" \
  -H "Authorization: Bearer $TOKEN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$SESSION" ] || { echo "ERROR: no upload session"; rm -f "$TMP"; exit 1; }
HANDLE=$(curl -sS -X POST "$GRAPH/$SESSION" \
  -H "Authorization: OAuth $TOKEN" \
  -H "file_offset: 0" \
  --data-binary "@$TMP" | sed -n 's/.*"h":"\([^"]*\)".*/\1/p')
rm -f "$TMP"
[ -n "$HANDLE" ] || { echo "ERROR: upload gave no handle"; exit 1; }
echo "  handle: ${HANDLE:0:40}…"

DOC_HEADER="{\"type\":\"HEADER\",\"format\":\"DOCUMENT\",\"example\":{\"header_handle\":[\"$HANDLE\"]}}"

# ── 2. edit each template (an edit must resend the FULL components array —
#       body text below is byte-identical to the approved copy + preview_body,
#       §120 lockstep) ─────────────────────────────────────────────────────
edit () {  # edit <template_name> <full-components-json>
  local name="$1" comps="$2"
  echo
  echo "→ $name : lookup id…"
  local tid
  tid=$(curl -sS "$GRAPH/$WABA_ID/message_templates?name=$name&fields=id,name,status" \
    -H "Authorization: Bearer $TOKEN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  if [ -z "$tid" ]; then echo "  ERROR: template not found"; return 1; fi
  echo "  id: $tid — submitting edit…"
  curl -sS -X POST "$GRAPH/$tid" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"components\":$comps}"
  echo
}

edit "post_call_callback" "[
  ${DOC_HEADER},
  {\"type\":\"BODY\",
   \"text\":\"Hi {{1}}, thank you for your time.\\n\\nAs agreed, {{2}} from Untitled Advertising will call you back on {{3}} at {{4}}.\\n\\nIf that time no longer suits you, reply to this message and we will rearrange.\",
   \"example\":{\"body_text\":[[\"Rajesh\",\"Rima\",\"22 July\",\"4:00 PM\"]]}}
]"

edit "post_call_nurture" "[
  ${DOC_HEADER},
  {\"type\":\"BODY\",
   \"text\":\"Hi {{1}}, thank you for your time today.\\n\\nI will leave this with you and check back in about a month. If anything changes before then, reply to this message. - {{2}}, Untitled Advertising\",
   \"example\":{\"body_text\":[[\"Rajesh\",\"Rima\"]]}}
]"

echo
echo "Done. Each response above is either {\"success\":true} (edit submitted,"
echo "template now In review) or an error. When BOTH show Active again in"
echo "WhatsApp Manager → Message templates, run"
echo "supabase_phase253b_postcall_pdf_map.sql IMMEDIATELY — the hazard cuts"
echo "both ways: SQL before approval = header param on a header-less template"
echo "(rejected); approval before SQL = header-less send on a header template"
echo "(also rejected). The two must flip together."
