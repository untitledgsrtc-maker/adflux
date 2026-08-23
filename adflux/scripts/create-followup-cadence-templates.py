#!/usr/bin/env python3
# Create the FULL closed-window follow-up cadence templates on the marketing WABA (§226).
# 8 DISTINCT UTILITY templates, one per day-slot of the owner's schedule (Meta caps ~1
# marketing template/recipient/day, so morning+evening days need only ONE that delivers):
#   Day 2 · Day 4 · Day 7 · Day 9 · Day 15 · Day 25 · Day 30 · Nurture (every 30d).
# Each is reply-first, Gujarati, {{1}}=name, transactional (Utility) — every message different
# (owner: "all templates must be different").
#
# RUN:  TOKEN='<fresh Meta System User token>' python3 scripts/create-followup-cadence-templates.py
#   (Business Settings → System users → campaign-api → Generate token, scopes
#    whatsapp_business_messaging + whatsapp_business_management. NEVER "Revoke tokens" — §119.)
#
# It submits all 8; each is created independently, so an "already exists" on one (e.g. followup_day2
# if you ran the earlier script) just prints an error for THAT one and the rest still create.
# Then watch WhatsApp Manager → Message templates until each is ACTIVE. ⚠ Meta may reclassify a
# "still interested? reply" template to MARKETING on approval (§216) — appeal any that flip:
# Business Support Home → Template category updates → select → Request review (usually reverts fast).
import os, json, urllib.request, urllib.error

TOKEN = os.environ.get('TOKEN', '')
WABA  = '2870129030006085'   # marketing WABA (98982 73686), §119
if not TOKEN:
    raise SystemExit('Set TOKEN=<fresh Meta System User token> and re-run.')

# (name, gujarati body with {{1}} = first name)
TEMPLATES = [
    ('followup_day2',
     'નમસ્તે {{1}} 🙏 તાજેતરમાં તમે GSRTC LED સ્ક્રીન વિશે પૂછ્યું હતું. હજુ રસ હોય તો કઈ *સિટી* અને કેટલા *મહિના* — એટલું આ મેસેજ પર *જવાબ* આપો, હું તરત વિગત મોકલી આપું. 👍'),
    ('followup_day4',
     'નમસ્તે {{1}} 👋 GSRTC LED સાથે તમારી જાહેરાત *માપી* શકાય છે — દરેક સ્ક્રીન પર QR, દરેક સ્કેન એક ટ્રેક થયેલ લીડ. તમારી સિટી માટે આંકડા જોઈએ? આ મેસેજ પર *જવાબ* આપો.'),
    ('followup_day7',
     'નમસ્તે {{1}} 🙏 હજુ GSRTC LED સ્ક્રીન વિચારી રહ્યા છો? સાચી *સ્ટેશન* પસંદ કરવામાં હું મદદ કરી શકું — બસ આ મેસેજ પર *જવાબ* આપો.'),
    ('followup_day9',
     'નમસ્તે {{1}} 👋 ગુજરાતના *20 GSRTC બસ સ્ટેશન* પર LED સ્ક્રીન — મહિને લાખો લોકો જુએ. તમારા બ્રાન્ડ માટે વિગત જોઈએ? આ મેસેજ પર *જવાબ* આપો.'),
    ('followup_day15',
     'નમસ્તે {{1}} 🙏 ફક્ત યાદ કરાવવા — GSRTC LED હજુ મનમાં હોય તો, તમે તૈયાર હો ત્યારે હું *ભાવપત્રક* બનાવી આપું. આ મેસેજ પર *જવાબ* આપો.'),
    ('followup_day25',
     'નમસ્તે {{1}} 👋 તમારી સિટી માટે અમારી GSRTC LED સ્ક્રીન હજુ ઉપલબ્ધ છે — વિગત જોઈએ તો આ મેસેજ પર *જવાબ* આપો.'),
    ('followup_day30',
     'નમસ્તે {{1}} 🙏 GSRTC LED વિશે એક છેલ્લી નોંધ — તમારી સિટી માટે *ભાવપત્રક* જોઈએ તો ફક્ત *સિટી* + *મહિના* જણાવો. આ મેસેજ પર *જવાબ* આપો.'),
    ('followup_nurture',
     'નમસ્તે {{1}} 👋 GSRTC LED — ગુજરાતના બસ સ્ટેશન પર *માપી શકાય એવી* આઉટડોર જાહેરાત. જ્યારે પણ કેમ્પેન પ્લાન કરો, અમે અહીં છીએ. કોઈ પ્રશ્ન હોય તો *જવાબ* આપો.'),
]

def create(name, body):
    payload = {
        'name': name, 'language': 'gu', 'category': 'UTILITY',
        'components': [{'type': 'BODY', 'text': body, 'example': {'body_text': [['રાજેશ']]}}],
    }
    req = urllib.request.Request(
        f'https://graph.facebook.com/v21.0/{WABA}/message_templates',
        data=json.dumps(payload).encode('utf-8'),
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'},
        method='POST')
    try:
        print(f'OK  {name}:', json.load(urllib.request.urlopen(req)))
    except urllib.error.HTTPError as e:
        print(f'ERR {name}:', e.code, e.read().decode('utf-8'))

if __name__ == '__main__':
    for name, body in TEMPLATES:
        create(name, body)
