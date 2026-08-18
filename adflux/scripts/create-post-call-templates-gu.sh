#!/usr/bin/env bash
# Phase 319 — create the 5 post-call templates in GUJARATI (language "gu") on the
# MARKETING WABA. Same names as the English ones (Meta allows one template name
# in multiple languages); these ADD the "gu" version. The app switches to them by
# flipping wa_outcome_templates.language to 'gu' (supabase_phase319_gu_templates.sql)
# — do that ONLY AFTER Meta marks all 5 gu templates Active, or the send fails
# (the en versions keep sending until then, so nothing breaks mid-review — §126.1).
#
# Bold (*...*) on the key details per Meta's own guidance (date/time, network name,
# the reply CTA). Reply-first wording (owner goal: get the customer to reply, which
# re-opens the 24h window). PDF (DOCUMENT header) on good/maybe/nurture; NONE on
# callback + lost (callback = appointment confirmation, lost = polite sign-off).
#
# USAGE
#   export TOKEN='<a FRESH Meta System User token>'   # never commit it
#   export BROCHURE_URL='https://…/brochure.pdf'      # companies.brochure_url (PRIVATE)
#   bash scripts/create-post-call-templates-gu.sh
#
# Re-running is safe: Meta rejects a duplicate name+language with a clear error,
# it does not create a second copy.
set -uo pipefail

WABA_ID="${WABA_ID:-2870129030006085}"   # marketing WABA (98982 73686)
APP_ID="${APP_ID:-1443324144491532}"     # the "Waba" app
GRAPH="https://graph.facebook.com/v21.0"
[ -z "${TOKEN:-}" ] && { echo "ERROR: export TOKEN=... first"; exit 1; }

# ── 1. upload the brochure to Meta → header handle (for the 3 PDF templates) ──
HANDLE=""
if [ -n "${BROCHURE_URL:-}" ]; then
  echo "→ downloading brochure…"
  TMP="$(mktemp -t brochure).pdf"
  if curl -fsSL "$BROCHURE_URL" -o "$TMP"; then
    LEN=$(wc -c < "$TMP" | tr -d ' '); echo "  got $LEN bytes"
    SESSION=$(curl -sS -X POST \
      "$GRAPH/$APP_ID/uploads?file_name=brochure.pdf&file_length=$LEN&file_type=application/pdf" \
      -H "Authorization: Bearer $TOKEN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    [ -n "$SESSION" ] && HANDLE=$(curl -sS -X POST "$GRAPH/$SESSION" \
      -H "Authorization: OAuth $TOKEN" -H "file_offset: 0" \
      --data-binary "@$TMP" | sed -n 's/.*"h":"\([^"]*\)".*/\1/p')
    echo "  handle: ${HANDLE:0:40}…"; rm -f "$TMP"
  else echo "  !! could not download the brochure — the 3 PDF templates will be created WITHOUT the doc header"; fi
else
  echo "!! BROCHURE_URL not set — the 3 PDF templates will be created WITHOUT the doc header."
fi

# ── 2. create one gu template. args: name  hasdoc(0/1)  text  example(pipe-sep) ──
post_tmpl () {
  local name="$1" hasdoc="$2" text="$3" example="$4"
  echo; echo "→ $name (gu)"
  python3 - "$name" "$hasdoc" "$HANDLE" "$text" "$example" <<'PY' | \
    curl -sS -X POST "$GRAPH/$WABA_ID/message_templates" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @-
import json, sys
name, hasdoc, handle, text, example = sys.argv[1:6]
comps = []
if hasdoc == '1' and handle:
    comps.append({"type": "HEADER", "format": "DOCUMENT",
                  "example": {"header_handle": [handle]}})
comps.append({"type": "BODY", "text": text,
              "example": {"body_text": [example.split('|')]}})
print(json.dumps({"name": name, "language": "gu", "category": "UTILITY",
                  "components": comps}, ensure_ascii=True))
PY
  echo
}

# ── 3. the five Gujarati bodies (bold on the key bits; {{1}} name, {{2}} rep,
#       {{3}} date, {{4}} time). $'...' keeps the \n\n paragraph breaks. ─────────
post_tmpl "post_call_good" 1 \
$'નમસ્તે {{1}}, હમણાં તમારી સાથે વાત કરીને આનંદ થયો.\n\nવાત મુજબ, *GSRTC બસ-સ્ટેશન LED સ્ક્રીન નેટવર્ક*ની વિગતો સાથે મોકલી છે.\n\nજોઈને તમારો અભિપ્રાય જરૂર જણાવજો — *કોઈ પણ પ્રશ્ન હોય તો અહીં જ જવાબ આપો*, {{2}} (Untitled Advertising) મદદ કરશે.' \
"Rajesh|Rima"

post_tmpl "post_call_callback" 0 \
$'નમસ્તે {{1}}, કદાચ તમે અત્યારે વ્યસ્ત હશો. મેં *GSRTC બસ-સ્ટેશન LED સ્ક્રીન* વિશે વિગતવાર વાત કરવા ફોન કર્યો હતો.\n\n{{2}} (Untitled Advertising) તમને *{{3}}* ના રોજ *{{4}}* વાગ્યે ફરી ફોન કરશે.\n\nજો બીજો સમય અનુકૂળ હોય, તો અહીં જ જવાબ આપો — ગોઠવી લઈશું.' \
"Rajesh|Rima|22 જુલાઈ|4:00 PM"

post_tmpl "post_call_maybe" 1 \
$'નમસ્તે {{1}}, ફોન પર સમય આપવા બદલ આભાર.\n\nતમારા સંદર્ભ માટે *GSRTC બસ-સ્ટેશન LED સ્ક્રીન નેટવર્ક*ની વિગતો મોકલી છે.\n\nનિરાંતે જોજો — *તમને યોગ્ય લાગે તો અહીં જ જવાબ આપજો*, {{2}} (Untitled Advertising).' \
"Rajesh|Rima"

post_tmpl "post_call_nurture" 1 \
$'નમસ્તે {{1}}, આજે સમય આપવા બદલ આભાર.\n\nતમારા સંદર્ભ માટે અમારી *GSRTC LED નેટવર્ક*ની વિગતો મોકલી છે. કોઈ ઉતાવળ નથી — હું *લગભગ એક મહિના પછી* ફરી સંપર્ક કરીશ.\n\nત્યાં સુધીમાં કંઈ પણ ફેરફાર થાય તો અહીં જ જવાબ આપજો. — {{2}}, Untitled Advertising' \
"Rajesh|Rima"

post_tmpl "post_call_lost" 0 \
$'નમસ્તે {{1}}, આજે સમય આપવા બદલ આભાર.\n\nભવિષ્યમાં ક્યારેય *GSRTC બસ-સ્ટેશન LED જાહેરાત* વિશે જરૂર જણાય, તો અહીં જ જવાબ આપી શકો છો.\n\nતમને શુભકામનાઓ. — {{2}}, Untitled Advertising' \
"Rajesh|Rima"

echo; echo "Done. Each line above shows an id (created, now In review) or an error."
echo "Watch WhatsApp Manager → Message templates until all 5 gu versions are Active,"
echo "THEN run supabase_phase319_gu_templates.sql to switch the app to Gujarati."
