#!/usr/bin/env python3
# AI QUOTE FOLLOW-UP — create the Meta template `ai_quote_followup` (Gujarati,
# UTILITY, reply-first, ONE body var, NO document header).
# SQL: supabase_ai_quote_followup.sql  ·  Endpoint: api/wa/ai-followup.js
#
# It re-opens the 24h window for a customer who got an AI quote and went silent.
# UTILITY (not Marketing): strictly transactional — "did you get your quote,
# reply if any question." NO price / NO pitch / NO attachment → ~₹0.11/send + a
# reviewer won't reclassify it (§120). One body var {{1}} = customer first name.
#
# USAGE (fresh System User token — Vercel's is unreadable, §119; NEVER "Revoke"):
#   TOKEN='<your System User token>' python3 scripts/create-quote-followup-template.py
#
# Then watch WhatsApp Manager → Message templates until `ai_quote_followup` is
# Active. The supabase_ai_quote_followup.sql row is already seeded — nothing sends
# until the template is Active AND you flip whatsapp_accounts.ai_followup_enabled.
#
# ⚠ LOCKSTEP (§125.1): the BODY text below MUST match preview_body in
#   supabase_ai_quote_followup.sql. Edit one → edit both.
import os, json, urllib.request, urllib.error

TOKEN = os.environ.get('TOKEN', '').strip()
WABA  = os.environ.get('WABA_ID', '2870129030006085')   # marketing WABA (§119)
GRAPH = 'https://graph.facebook.com/v21.0'
if not TOKEN:
    raise SystemExit("ERROR: export TOKEN=... first (a fresh System User token)")

# Must byte-match preview_body in supabase_ai_quote_followup.sql:
BODY = ("નમસ્તે {{1}} 👋 તમને GSRTC LED સ્ક્રીન નું *ભાવપત્રક* મળ્યું? "
        "કોઈ પ્રશ્ન હોય તો આ મેસેજ પર *જવાબ* આપો — અમે મદદ કરીશું.")

payload = {
    "name": "ai_quote_followup",
    "language": "gu",
    "category": "UTILITY",
    "components": [
        {"type": "BODY", "text": BODY, "example": {"body_text": [["Rajesh"]]}},
    ],
}
data = json.dumps(payload).encode()
req = urllib.request.Request(f"{GRAPH}/{WABA}/message_templates", data=data, method='POST',
                             headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
try:
    res = json.load(urllib.request.urlopen(req))
    print("→ ai_quote_followup (gu, UTILITY): " + json.dumps(res))
    print("Submitted (In review). Wait for Active in WhatsApp Manager, then flip")
    print("whatsapp_accounts.ai_followup_enabled=true on the marketing account.")
except urllib.error.HTTPError as e:
    print("ERROR: " + e.read().decode())
