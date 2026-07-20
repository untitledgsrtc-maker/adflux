#!/usr/bin/env bash
# Create the five post-call WhatsApp templates on the MARKETING WABA.
#
# One template per call outcome (PostCallOutcomeModal OUTCOMES):
#   positive → post_call_good      (UTILITY + PDF)
#   callback → post_call_callback  (UTILITY, no PDF — appointment confirmation)
#   neutral  → post_call_maybe     (UTILITY + PDF)
#   nurture  → post_call_nurture   (UTILITY, no PDF)
#   negative → post_call_lost      (UTILITY, no PDF, no pitch)
#
# WHY these are UTILITY and not Marketing: each one follows a call the customer
# just had. Bodies are deliberately transactional — no price, no offer, no CTA.
# The two with a PDF let the document carry the content so the COPY stays clean;
# a salesy body is what makes a reviewer reclassify to Marketing (~7x the cost
# plus a frequency cap).
#
# The PDF is a DOCUMENT header. Meta needs a SAMPLE at approval time; the real
# file is supplied per-send, so it can differ per lead later (e.g. that lead's
# own quote PDF).
#
# USAGE
#   export TOKEN='<your System User token>'      # never commit this
#   export BROCHURE_URL='https://…/brochure.pdf' # from companies.brochure_url
#   bash scripts/create-post-call-templates.sh
#
# Get BROCHURE_URL with:
#   select brochure_url from companies where segment='PRIVATE';
#
# Re-running is safe-ish: Meta rejects a duplicate name with a clear error, it
# does not create a second copy.
set -uo pipefail

WABA_ID="${WABA_ID:-2870129030006085}"   # marketing WABA (98982 73686)
APP_ID="${APP_ID:-1443324144491532}"     # the "Waba" app
GRAPH="https://graph.facebook.com/v21.0"

if [ -z "${TOKEN:-}" ]; then echo "ERROR: export TOKEN=... first"; exit 1; fi

# ── 1. upload the brochure to Meta → header handle ──────────────────────────
HANDLE=""
if [ -n "${BROCHURE_URL:-}" ]; then
  echo "→ downloading brochure…"
  TMP="$(mktemp -t brochure).pdf"
  if curl -fsSL "$BROCHURE_URL" -o "$TMP"; then
    LEN=$(wc -c < "$TMP" | tr -d ' ')
    echo "  got $LEN bytes"
    echo "→ opening Meta upload session…"
    SESSION=$(curl -sS -X POST \
      "$GRAPH/$APP_ID/uploads?file_name=brochure.pdf&file_length=$LEN&file_type=application/pdf" \
      -H "Authorization: Bearer $TOKEN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    if [ -n "$SESSION" ]; then
      echo "  session: $SESSION"
      HANDLE=$(curl -sS -X POST "$GRAPH/$SESSION" \
        -H "Authorization: OAuth $TOKEN" \
        -H "file_offset: 0" \
        --data-binary "@$TMP" | sed -n 's/.*"h":"\([^"]*\)".*/\1/p')
      echo "  handle: ${HANDLE:0:40}…"
    fi
    rm -f "$TMP"
  else
    echo "  !! could not download the brochure — continuing WITHOUT the PDF"
  fi
else
  echo "!! BROCHURE_URL not set — creating the two PDF templates WITHOUT a header."
  echo "   (Set it and re-run to get the attachment.)"
fi

create () {  # create <name> <json-components>
  local name="$1" comps="$2"
  echo
  echo "→ $name"
  curl -sS -X POST "$GRAPH/$WABA_ID/message_templates" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"language\":\"en\",\"category\":\"UTILITY\",\"components\":$comps}"
  echo
}

# Document header component, only when we actually got a handle.
if [ -n "$HANDLE" ]; then
  DOC_HEADER="{\"type\":\"HEADER\",\"format\":\"DOCUMENT\",\"example\":{\"header_handle\":[\"$HANDLE\"]}},"
else
  DOC_HEADER=""
fi

# ── 2. the five templates ───────────────────────────────────────────────────

# GOOD — they asked for information. The PDF is the content.
create "post_call_good" "[
  ${DOC_HEADER}
  {\"type\":\"BODY\",
   \"text\":\"Hi {{1}}, thank you for speaking with us just now.\\n\\nAs requested on our call, here are the details of the GSRTC bus-station LED screen network.\\n\\nIf you have any questions, reply to this message and {{2}} from Untitled Advertising will assist you.\",
   \"example\":{\"body_text\":[[\"Rajesh\",\"Rima\"]]}}
]"

# CALL LATER — a genuine appointment confirmation. Cleanest Utility of the five.
# Deliberately NO attachment: a brochure would dilute it toward Marketing.
create "post_call_callback" "[
  {\"type\":\"BODY\",
   \"text\":\"Hi {{1}}, thank you for your time.\\n\\nAs agreed, {{2}} from Untitled Advertising will call you back on {{3}} at {{4}}.\\n\\nIf that time no longer suits you, reply to this message and we will rearrange.\",
   \"example\":{\"body_text\":[[\"Rajesh\",\"Rima\",\"22 July\",\"4:00 PM\"]]}}
]"

# MAYBE — light touch, leaves something in their hands.
create "post_call_maybe" "[
  ${DOC_HEADER}
  {\"type\":\"BODY\",
   \"text\":\"Hi {{1}}, thank you for your time on the call.\\n\\nSharing the details of the GSRTC bus-station LED screen network for your reference.\\n\\nI will check back in a few days. If you need anything sooner, reply to this message. - {{2}}, Untitled Advertising\",
   \"example\":{\"body_text\":[[\"Rajesh\",\"Rima\"]]}}
]"

# NURTURE — soft close, re-pitch handled by the 30-day cadence, not by this.
create "post_call_nurture" "[
  {\"type\":\"BODY\",
   \"text\":\"Hi {{1}}, thank you for your time today.\\n\\nI will leave this with you and check back in about a month. If anything changes before then, reply to this message. - {{2}}, Untitled Advertising\",
   \"example\":{\"body_text\":[[\"Rajesh\",\"Rima\"]]}}
]"

# LOST — ONE polite sign-off. No price, no link, no attachment, no re-pitch.
# Never repeat this one; a drip to someone who said no is what earns reports.
create "post_call_lost" "[
  {\"type\":\"BODY\",
   \"text\":\"Hi {{1}}, thank you for your time today.\\n\\nIf you have any requirement for GSRTC bus-station LED advertising in future, you can reply to this message any time. - {{2}}, Untitled Advertising\",
   \"example\":{\"body_text\":[[\"Rajesh\",\"Rima\"]]}}
]"

echo
echo "Done. Each response above shows either an id (created, now In review)"
echo "or an error. Check status in WhatsApp Manager → Message templates."
