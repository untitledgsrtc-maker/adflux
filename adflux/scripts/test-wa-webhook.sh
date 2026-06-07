#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# test-wa-webhook.sh — simulate a real Meta WhatsApp inbound POST to the
# campaign webhook, with a valid X-Hub-Signature-256 HMAC, so you can verify
# the C4 + C4-store pipeline WITHOUT the Meta test number.
#
# What it proves: HMAC verify passes -> webhook_event_log audit row +
# whatsapp_conversations + whatsapp_messages rows get written.
#
# Usage (paste your CAMPAIGN_APP_SECRET — the SAME value you set in Vercel):
#   CAMPAIGN_APP_SECRET='your_app_secret' bash scripts/test-wa-webhook.sh
#
# Optional overrides:
#   URL=https://untitled-os-tau.vercel.app/api/wa/webhook   (default: app.untitledad.in)
#   FROM=919876543210   (the customer phone that "sent" the message)
#   TEXT='hello from the test'
# ---------------------------------------------------------------------------
set -euo pipefail

SECRET="${CAMPAIGN_APP_SECRET:?Set CAMPAIGN_APP_SECRET to the value you put in Vercel}"
URL="${URL:-https://app.untitledad.in/api/wa/webhook}"
FROM="${FROM:-919812345678}"
TEXT="${TEXT:-hi from the webhook self-test}"

# A minimal but real-shaped Meta inbound payload. phone_number_id is a
# self-test value -> the webhook self-provisions a whatsapp_accounts row for
# it (no default_telecaller_id, so C4.5 would safely error-queue, not mint a
# NULL-owner lead). wamid is unique-per-run so re-runs aren't deduped away.
STAMP="$(date +%s)"
BODY=$(cat <<JSON
{"object":"whatsapp_business_account","entry":[{"id":"2476976612751250","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15551967216","phone_number_id":"SELFTEST_PNID"},"contacts":[{"profile":{"name":"Webhook Self-Test"},"wa_id":"${FROM}"}],"messages":[{"from":"${FROM}","id":"wamid.SELFTEST.${STAMP}","timestamp":"${STAMP}","type":"text","text":{"body":"${TEXT}"}}]},"field":"messages"}]}]}
JSON
)

# HMAC-SHA256 over the EXACT body bytes (no trailing newline) with the App
# Secret — identical to what the webhook recomputes server-side.
HEX="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"
SIG="sha256=${HEX}"

echo "POST $URL?debug=1"
echo "  from=${FROM}  text=\"${TEXT}\""
echo "  signature=${SIG:0:23}..."
echo "---"
# ?debug=1 echoes the C4-store outcome back in the JSON (HMAC-gated; Meta
# never sends it, so prod replies are unchanged).
curl -sS -X POST "${URL}?debug=1" \
  -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: ${SIG}" \
  --data "$BODY"
echo
echo "---"
echo "Expected: {\"received\":true,\"count\":1,\"store\":{\"ok\":true,\"stored\":1}}"
echo "  store.ok=false → the error string says which write failed."
echo "Then check Supabase:"
echo "  select customer_wa_id, status from whatsapp_conversations order by created_at desc limit 3;"
echo "  select direction, type, body from whatsapp_messages order by at desc limit 3;"
