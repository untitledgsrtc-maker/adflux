#!/usr/bin/env python3
# List all message templates on the marketing WABA + their status/category.
# RUN:  TOKEN='<your Meta System User token>' python3 scripts/list-wa-templates.py
#   (reuse the SAME token you used for create-followup-cadence-templates.py)
# Status meaning: APPROVED = live/sendable · PENDING/IN_APPEAL = in Meta review ·
#                 REJECTED = fix + resubmit. Category MARKETING vs UTILITY = the price tier.
import os, json, urllib.request, urllib.error

TOKEN = os.environ.get('TOKEN', '')
WABA  = '2870129030006085'   # marketing WABA (98982 73686), §119
if not TOKEN:
    raise SystemExit('Set TOKEN=<your Meta System User token> and re-run.')

url = (f'https://graph.facebook.com/v21.0/{WABA}/message_templates'
       f'?fields=name,status,category,language&limit=200')
try:
    data = json.load(urllib.request.urlopen(
        urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})))
    rows = data.get('data', [])
    print(f"{'STATUS':14}{'CATEGORY':11}{'LANG':5}NAME")
    print('-' * 50)
    for t in sorted(rows, key=lambda x: x.get('name', '')):
        print(f"{t.get('status',''):14}{t.get('category',''):11}{t.get('language',''):5}{t.get('name','')}")
    fu = [t for t in rows if str(t.get('name', '')).startswith('followup')]
    print(f"\n{len(rows)} templates total · {len(fu)} followup_* found")
except urllib.error.HTTPError as e:
    print('ERR', e.code, e.read().decode('utf-8'))
