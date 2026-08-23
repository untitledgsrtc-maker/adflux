#!/usr/bin/env python3
# Create the Day-2 follow-up TEMPLATE on the marketing WABA (§226 cadence).
# Closed-window (24h+) follow-up must be a Meta-APPROVED template. This is a
# UTILITY, reply-first, Gujarati template — DISTINCT from ai_quote_followup
# (§213) and every other cadence touch (owner: "all templates must be different").
#
# RUN:  TOKEN='<fresh Meta System User token>' python3 scripts/create-followup-day2-template.py
#   (generate a FRESH token in Business Settings → System users → campaign-api →
#    Generate token, scopes whatsapp_business_messaging + whatsapp_business_management.
#    NEVER click "Revoke tokens" — that kills the live app's token. §119.)
#
# After it prints ok, watch WhatsApp Manager → Message templates until it is
# ACTIVE. ⚠ Meta may reclassify a "still interested? reply" template to MARKETING
# on approval (§216) — if the Category shows Marketing, appeal it: Business Support
# Home → Template category updates → select → Request review (usually reverts fast).
import os, json, urllib.request, urllib.error

TOKEN = os.environ.get('TOKEN', '')
WABA  = '2870129030006085'   # marketing WABA (98982 73686), §119

if not TOKEN:
    raise SystemExit('Set TOKEN=<fresh Meta System User token> and re-run.')

TEMPLATE = {
    'name': 'followup_day2',
    'language': 'gu',
    'category': 'UTILITY',
    'components': [{
        'type': 'BODY',
        # {{1}} = the customer's first name. Reply-first, transactional, NO price/pitch
        # (keeps it Utility): references their own inquiry + the ONE next step.
        'text': ('નમસ્તે {{1}} 🙏 તાજેતરમાં તમે GSRTC LED સ્ક્રીન વિશે પૂછ્યું હતું. '
                 'હજુ રસ હોય તો કઈ *સિટી* અને કેટલા *મહિના* — એટલું આ મેસેજ પર *જવાબ* આપો, '
                 'હું તરત વિગત મોકલી આપું. 👍'),
        'example': {'body_text': [['રાજેશ']]},
    }],
}

def main():
    req = urllib.request.Request(
        f'https://graph.facebook.com/v21.0/{WABA}/message_templates',
        data=json.dumps(TEMPLATE).encode('utf-8'),
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'},
        method='POST')
    try:
        print('OK:', json.load(urllib.request.urlopen(req)))
    except urllib.error.HTTPError as e:
        print('ERROR', e.code, e.read().decode('utf-8'))

if __name__ == '__main__':
    main()
