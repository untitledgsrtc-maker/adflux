#!/usr/bin/env python3
# scripts/create-ops-ticket-template.py
# Creates the Gujarati UTILITY WhatsApp template 'ops_ticket_alert' on the
# marketing WABA. Owner runs with a FRESH Meta System User token (§119):
#   TOKEN='<fresh token>' python3 scripts/create-ops-ticket-template.py
# 2 body vars: {{1}} = station/depot name, {{2}} = number of screens down.
import json, os, urllib.request, urllib.error

WABA = '2870129030006085'  # marketing WABA (§119)
TOKEN = os.environ.get('TOKEN')
if not TOKEN:
    raise SystemExit('set TOKEN=<fresh Meta System User token>')

payload = {
    'name': 'ops_ticket_alert',
    'language': 'gu',
    'category': 'UTILITY',
    'components': [
        {'type': 'BODY',
         'text': 'નવી ટિકિટ: *{{1}}* — {{2}} સ્ક્રીન બંધ છે. ઍપ ખોલીને ટિકિટ જુઓ.',
         'example': {'body_text': [['આણંદ', '14']]}},
    ],
}
req = urllib.request.Request(
    f'https://graph.facebook.com/v21.0/{WABA}/message_templates',
    data=json.dumps(payload).encode(),
    headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req) as r:
        print('OK', r.read().decode())
except urllib.error.HTTPError as e:
    print('ERR', e.code, e.read().decode())
