# Campaign — Real Number Go-Live Checklist (95815 78261)

**Goal:** put the real WhatsApp number `+91 95815 78261` on the campaign
system so real customers can message it → land in **Campaigns → Inbox** →
a rep replies → it delivers.

**Status (8 Jun 2026):** the campaign CODE is DONE + PROVEN on the test
number — real inbound landed in the inbox, the reply was accepted by Meta.
The only thing left is swapping the test number for the real one. That is a
**configuration** job (Meta + Vercel), not a code job.

**Who does what:** every Meta / Vercel / AiSensy step is YOURS (I can't log
into your accounts). The two SQL bits (routing + a sanity check) are mine —
ping me and I'll run them.

> **Golden rule (your §45):** a WhatsApp number can live in only ONE system
> at a time. The moment this number moves onto our webhook, **AiSensy stops
> working on it.** So do PHASE 0 first, and pick a quiet window (evening /
> Sunday) for the switch — never mid-day with customers active.

---

## PHASE 0 — Confirm it's safe to move (do this FIRST)

1. **WhatsApp Manager** (business.facebook.com/wa/manage) → **Phone numbers**
   → top-right **WABA switcher** → find which account actually lists
   **95815 78261**. Note that WABA's name + ID.
2. **AiSensy** → log in → is `95815 78261` the connected number, and are
   broadcasts / replies flowing on it **right now**?
   - **Yes, active** → this is a real cutover. Decide you're OK losing
     AiSensy on this number, and pick a quiet window.
   - **No / idle** → low risk, proceed.
3. If unsure, ask whoever set up AiSensy. **Do not move it on a guess.**

---

## PHASE 1 — Get the number onto YOUR Cloud API

4. In **WhatsApp Manager → Phone numbers → 95815 78261**, if it says
   **"Register your number to start using it"** → click **Register** → set a
   **6-digit PIN** → **WRITE THE PIN DOWN** (Meta asks for it later; losing it
   is a pain).
5. Make sure the number's WABA is linked to the **Waba** developer app.
   (In the app's **API Setup → From** dropdown it should then appear. If it
   doesn't, the number's WABA isn't attached to this app — in **Business
   Settings → Accounts → WhatsApp Accounts**, add the **Waba** app to that
   WABA.)
6. **Copy the real Phone number ID** (API Setup → From → pick 95815 78261 →
   the Phone number ID shown). This replaces the test `1109377682262338`.

---

## PHASE 2 — Point Meta at our webhook

7. **App → Configuration (webhook)** is already set:
   - Callback URL: `https://app.untitledad.in/api/wa/webhook`
   - Verify token: your `CAMPAIGN_WEBHOOK_VERIFY_TOKEN`
   - **messages** subscribed.
   Just confirm the real number's WABA is the one feeding this app (Business
   Settings → the WABA → Apps → the Waba app is connected).
8. Confirm `CAMPAIGN_APP_SECRET` in Vercel = **this Waba app's** App Secret
   (App Settings → Basic → Show). It already verified on the self-test, so
   this should be fine — just don't change the app.

---

## PHASE 3 — Token, publish, payment (the real gates)

9. **Access token.** The temp token expires in 24h — fine to test, useless
   for production. For live, make a **permanent System User token**:
   Business Settings → **System Users** → Add (Admin) → **Generate token** →
   app = Waba → permissions: `whatsapp_business_messaging` +
   `whatsapp_business_management` → copy. (Tell me if you want the click-path
   for this — it's the one fiddly step.)
10. **Vercel** → Settings → Environment Variables → edit **`CAMPAIGN_WA_TOKEN`**
    → paste the new token → Save → **Redeploy**.
11. **PUBLISH THE APP** (the gate for real customer inbound). App dashboard →
    **Publish** (left nav, shows "Unpublished"). Needs a **Privacy Policy URL**
    (App Settings → Basic). If untitledad.in has no /privacy page yet, that's a
    small one-time task first. For messaging on your OWN number you generally
    do **not** need full App Review — but you must flip the app to **Live**.
12. **Payment method.** WhatsApp Manager → the WABA → **Payment settings** →
    add a card. First ~1,000 conversations/month are free; without a card you
    hit a hard cap. Needed before real volume.

---

## PHASE 4 — Routing (my part — ping me)

13. WhatsApp leads must route to a telecaller, else they error-queue (no
    NULL-owner lead, by design). I set `default_telecaller_id` on the
    `whatsapp_accounts` row (and/or on the campaign). Tell me **which
    telecaller** (Dhara / Rima / …) should own incoming WhatsApp leads and
    I'll run the one-line SQL.

---

## PHASE 5 — Test the real loop

14. From **any** phone, WhatsApp **95815 78261** → "hi". → it should appear in
    **Campaigns → Inbox** within seconds, tagged as a **lead** routed to your
    chosen telecaller.
15. Reply from the inbox → it **delivers** to that phone (real customer window
    — no test-number quirk).
16. **Scan a QR board** → opens chat to 95815 78261 → conversation + lead +
    the scan counts on the QR page.

---

## Gotchas (don't get caught)

- ❌ Moving the number while AiSensy is live on it = customers go dark. PHASE 0.
- ❌ Temp token = dead in 24h. Use a System User token for production (step 9).
- ❌ App left **Unpublished** = real customer messages never reach the webhook
  (only dashboard test events do). PHASE 3 step 11 is mandatory for real use.
- ❌ No payment method = hard cap after the free tier. Step 12.
- ❌ No `default_telecaller_id` = inbound leads error-queue. Step 13 (my part).
- ❌ Changing the Waba app's App Secret after the fact breaks the webhook HMAC.
  Don't.

---

## What's ALREADY done (so you know the code side is finished)

- `api/wa/webhook` — receive + HMAC verify + store (proven via signed
  self-test: `{"received":true,"store":{"ok":true,"stored":1}}`).
- `api/wa/send` — reply send via Meta (proven: Meta accepted the reply).
- Inbox UI (`CampaignInboxV2`) — conversation list + thread + 24h-window
  reply composer (proven: chat rendered, composer unlocked).
- C4.5 trigger — inbound → lead with the 4 P0 contracts (dedup / routing /
  activity / stage). Live.
- QR boards + scan tracker + Client QRs. Live.

Nothing in this list needs touching for go-live. It's purely the Meta/Vercel
config above.
