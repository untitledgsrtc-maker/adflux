#!/usr/bin/env python3
# Phase 322 — create the GUJARATI after-presentation thank-you template
# `post_meeting_thanks` on the MARKETING WABA. UTILITY, DOCUMENT header (brochure),
# 2 body vars ({{1}} = customer name, {{2}} = rep). Reply-first wording, bold on
# the network name + the reply CTA (Meta's own tip).
#
# The body here MUST stay byte-identical to preview_body in
# supabase_phase322_meeting_thanks_template.sql (§125.1 lockstep — the inbox log
# is built from preview_body; a drift shows the rep text the customer never got).
#
# Like the Phase 319 retry, this uploads a TINY sample PDF as the approval sample
# (a large brochure gave "Uploaded media handle is invalid"). The REAL brochure is
# attached per-send from wa_outcome_templates.header_doc_url.
#
# USAGE (a FRESH Meta System User token — never commit it):
#   TOKEN='<your token>' python3 scripts/create-meeting-thanks-template.py
#
# After it shows "Active" in WhatsApp Manager, run
# supabase_phase322_meeting_thanks_template.sql (NOT before — §126.1).
import os, json, urllib.request, urllib.error

TOKEN = os.environ.get('TOKEN', '').strip()
WABA  = os.environ.get('WABA_ID', '2870129030006085')   # marketing WABA (98982 73686)
APP   = os.environ.get('APP_ID', '1443324144491532')     # the "Waba" app
GRAPH = 'https://graph.facebook.com/v21.0'
if not TOKEN:
    raise SystemExit("ERROR: export TOKEN=... first (a fresh System User token)")

# ── tiny valid 1-page PDF — the approval SAMPLE only (real brochure sent per-send) ──
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

# ── the body (MUST match preview_body in the SQL — §125.1) ──
BODY = ("નમસ્તે {{1}}, આજે રૂબરૂ મળવા બદલ આભાર.\n\n"
        "વાત મુજબ, *GSRTC બસ-સ્ટેશન LED સ્ક્રીન નેટવર્ક*ની વિગતો સાથે મોકલી છે.\n\n"
        "કોઈ પણ પ્રશ્ન હોય તો *અહીં જ જવાબ આપો* — {{2}} (Untitled Advertising) મદદ કરશે.")

comps = [
    {"type": "HEADER", "format": "DOCUMENT", "example": {"header_handle": [HANDLE]}},
    {"type": "BODY", "text": BODY, "example": {"body_text": [["Rajesh", "Rima"]]}},
]
body = json.dumps({"name": "post_meeting_thanks", "language": "gu", "category": "UTILITY",
                   "components": comps}).encode()
res, err = api(f"{GRAPH}/{WABA}/message_templates", data=body,
               headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
print("\n→ post_meeting_thanks (gu)")
print("  " + (json.dumps(res) if res else "ERROR " + err))

print("\nDone. The line above shows an id (submitted, In review) or an error.")
print("When post_meeting_thanks shows Active in WhatsApp Manager, run")
print("supabase_phase322_meeting_thanks_template.sql.")
