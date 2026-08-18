#!/usr/bin/env python3
# Phase 319 (retry) — create the 3 GUJARATI post-call templates that carry a PDF
# (good / maybe / nurture). The first run failed them with "Uploaded media handle
# is invalid" because the 7.3 MB brochure made a bad SAMPLE handle. Meta only needs
# a *sample* document at approval; the REAL brochure is attached per-send from
# wa_outcome_templates.header_doc_url — so this uploads a tiny placeholder PDF as
# the sample instead. callback + lost already created (no PDF) — not touched here.
#
# USAGE (same terminal, TOKEN still exported from the first run):
#   TOKEN='<your token>' python3 scripts/create-gu-pdf-templates-retry.py
#   (BROCHURE_URL is NOT needed — we make our own tiny sample.)
import os, json, urllib.request, urllib.error

TOKEN = os.environ.get('TOKEN', '').strip()
WABA  = os.environ.get('WABA_ID', '2870129030006085')
APP   = os.environ.get('APP_ID', '1443324144491532')
GRAPH = 'https://graph.facebook.com/v21.0'
if not TOKEN:
    raise SystemExit("ERROR: export TOKEN=... first (same token as the first run)")

# ── tiny valid 1-page PDF (a few hundred bytes) — the approval sample only ──
def make_sample_pdf():
    objs = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    ]
    content = b"BT /F1 20 Tf 60 780 Td (Untitled Advertising - GSRTC LED Network) Tj ET"
    objs.append(b"<</Length %d>>stream\n%s\nendstream" % (len(content), content))
    objs.append(b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>")
    out = b"%PDF-1.4\n"
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, o)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offs:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref)
    return out

def api(url, data=None, headers=None, method='POST'):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        return json.load(urllib.request.urlopen(req)), None
    except urllib.error.HTTPError as e:
        return None, e.read().decode()

# ── upload the tiny sample → header handle ──
pdf = make_sample_pdf()
print("→ sample pdf: %d bytes" % len(pdf))
sess, err = api(f"{GRAPH}/{APP}/uploads?file_name=sample.pdf&file_length={len(pdf)}&file_type=application/pdf",
                headers={'Authorization': f'Bearer {TOKEN}'})
if err:
    raise SystemExit("upload-session failed: " + err)
sid = sess['id']
up, err = api(f"{GRAPH}/{sid}", data=pdf,
              headers={'Authorization': f'OAuth {TOKEN}', 'file_offset': '0'})
if err:
    raise SystemExit("upload failed: " + err)
HANDLE = up['h']
print("→ handle len %d  (%s…)" % (len(HANDLE), HANDLE[:24]))

# ── the 3 Gujarati bodies (must match supabase_phase319_gu_templates.sql) ──
BODIES = {
 "post_call_good":
  "નમસ્તે {{1}}, હમણાં તમારી સાથે વાત કરીને આનંદ થયો.\n\nવાત મુજબ, *GSRTC બસ-સ્ટેશન LED સ્ક્રીન નેટવર્ક*ની વિગતો સાથે મોકલી છે.\n\nજોઈને તમારો અભિપ્રાય જરૂર જણાવજો — *કોઈ પણ પ્રશ્ન હોય તો અહીં જ જવાબ આપો*, {{2}} (Untitled Advertising) મદદ કરશે.",
 "post_call_maybe":
  "નમસ્તે {{1}}, ફોન પર સમય આપવા બદલ આભાર.\n\nતમારા સંદર્ભ માટે *GSRTC બસ-સ્ટેશન LED સ્ક્રીન નેટવર્ક*ની વિગતો મોકલી છે.\n\nનિરાંતે જોજો — *તમને યોગ્ય લાગે તો અહીં જ જવાબ આપજો*, {{2}} (Untitled Advertising).",
 "post_call_nurture":
  "નમસ્તે {{1}}, આજે સમય આપવા બદલ આભાર.\n\nતમારા સંદર્ભ માટે અમારી *GSRTC LED નેટવર્ક*ની વિગતો મોકલી છે. કોઈ ઉતાવળ નથી — હું *લગભગ એક મહિના પછી* ફરી સંપર્ક કરીશ.\n\nત્યાં સુધીમાં કંઈ પણ ફેરફાર થાય તો અહીં જ જવાબ આપજો. — {{2}}, Untitled Advertising",
}

for name, text in BODIES.items():
    comps = [
        {"type": "HEADER", "format": "DOCUMENT", "example": {"header_handle": [HANDLE]}},
        {"type": "BODY", "text": text, "example": {"body_text": [["Rajesh", "Rima"]]}},
    ]
    body = json.dumps({"name": name, "language": "gu", "category": "UTILITY",
                       "components": comps}).encode()
    res, err = api(f"{GRAPH}/{WABA}/message_templates", data=body,
                   headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    print(f"\n→ {name} (gu)")
    print("  " + (json.dumps(res) if res else "ERROR " + err))

print("\nDone. Each line shows an id (submitted, In review) or an error.")
print("When all 5 gu templates show Active in WhatsApp Manager, run")
print("supabase_phase319_gu_templates.sql.")
