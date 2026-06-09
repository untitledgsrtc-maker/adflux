#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# subscribe-wa-waba.sh — subscribe a WhatsApp Business Account (WABA) to your
# Meta app's webhook, so that number's INBOUND messages reach our webhook
# (api/wa/webhook -> Campaigns -> Inbox).
#
# Run it once per real number's WABA. Safe to re-run (idempotent on Meta's
# side — re-subscribing just returns success again).
#
# Usage:
#   bash scripts/subscribe-wa-waba.sh
#   (it prompts for the ACCESS TOKEN + the WABA ID — you paste them; nothing
#    is stored, nothing is sent anywhere except Meta's Graph API)
# ---------------------------------------------------------------------------
set -euo pipefail

GRAPH="https://graph.facebook.com/v21.0"

TOKEN="${WA_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  printf 'Paste the ACCESS TOKEN (Generate access token -> UNTITLED ADVERTISING), then Enter: '
  read -r -s TOKEN; printf '\n'
fi
WABA="${WABA_ID:-}"
if [ -z "$WABA" ]; then
  printf 'Paste the WABA ID (WhatsApp Business Account ID), then Enter: '
  read -r WABA
fi
[ -z "$TOKEN" ] && { echo "No token entered." >&2; exit 1; }
[ -z "$WABA" ]  && { echo "No WABA ID entered." >&2; exit 1; }

echo ""
echo "=== 1) Subscribe this app to the WABA's webhooks ==="
curl -sS -X POST "${GRAPH}/${WABA}/subscribed_apps" \
  -H "Authorization: Bearer ${TOKEN}"
echo ""
echo ""
echo "=== 2) Confirm — list the apps now subscribed to this WABA ==="
curl -sS -X GET "${GRAPH}/${WABA}/subscribed_apps" \
  -H "Authorization: Bearer ${TOKEN}"
echo ""
echo ""
echo "---"
echo 'Step 1 should print {"success":true}.'
echo 'Step 2 should list your "Waba" app (whatsapp_business_api_data with the app id).'
echo "If you see an OAuth/permission error instead, the token lacks"
echo "whatsapp_business_management on this WABA — regenerate it with that account ticked."
