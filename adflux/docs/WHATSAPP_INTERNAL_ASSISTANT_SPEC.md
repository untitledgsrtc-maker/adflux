# WhatsApp Internal Team Assistant — Build Spec

**Status:** DRAFT for owner approval (2026-08-17). No code yet.
**Owner ask:** the 95 number (95 815 78261) becomes an internal team assistant. A rep
texts "hi" (or a question) and gets their own data back — quotes/PDF, renewals, meetings,
follow-ups, target, incentive, leads to call — plus a proactive nudge every 2 hours about
what's still pending.

---

## 1. Feasibility verdict — YES, mostly wiring

Every hard piece already runs in production:
- **WhatsApp Cloud API** on 95 815 78261 (`api/wa/webhook.js` inbound, `api/wa/send.js`
  outbound, `api/wa/ai-reply.js` the Claude responder). §54/§115.
- **AI that reads a message + replies with context** (the customer bot). §115.
- **Quote PDFs sendable on WhatsApp as a document** (§120 brochure, §127 inbox quote send).
- **All the data** already in the DB: `quotes` (+ `campaign_end_date` = renewals),
  `follow_ups`, `lead_activities` (meetings), `daily_targets`, incentive
  (`compute_monthly_salary` / `monthly_sales_data`).
- **Cron + reminder pipeline** already pushes follow-up reminders (§130 cron pattern).

What's genuinely new is small: a rep-number → user mapping, a routing fork in the webhook,
a rep-scoped assistant reply, and one 2-hour cron.

---

## 2. The WhatsApp 24-hour rule (and why we need ~zero templates)

WhatsApp lets a business send **free text only within 24h of the person's last message**.
Outside that window → only pre-approved **template** messages (paid, Meta-approved).

Owner decision (confirmed): **the rep messages first daily**, which re-opens the 24h window,
so every reply AND every 2-hour ping that day is **free text, no template**.
- **v1 ships with ZERO templates.** A rep gets data + pings only while their window is open
  (i.e. they've messaged in the last 24h). For a team that says "hi" daily, that's all day.
- **Only gap:** a rep who goes >24h silent (day off / forgets) won't receive a proactive
  ping until they message again. That's exactly the disengaged rep — a **single fallback
  template** could reach them, but it's **deferred to P4 (optional)**, added only if silent
  reps become a real problem.
- **Messaging cost in v1: ₹0** (free-text only). Only the Claude API calls cost anything
  (tiny, per rep message).

---

## 3. Architecture — reuse the existing pipeline, add one fork

```
Rep's WhatsApp  ──▶  api/wa/webhook.js (95 number, HMAC-verified)
                        │
                        │  NEW: is the sender a KNOWN REP?  (users.whatsapp_number)
             ┌──────────┴───────────┐
        YES (rep)                 NO (customer)
             │                        │
   INTERNAL assistant path      EXISTING customer path
   (team-assistant reply)       (store convo → C4.5 lead → customer AI)
             │
   fetch rep's own data (scoped) → Claude interprets → reply via api/wa/send
   (send a quote PDF as a document when asked)
```

**Key rule:** a rep's inbound message must **NOT** create a customer lead, must **NOT**
land in the customer inbox, and must **NOT** trigger the customer AI. The rep-number check
gates BEFORE all of that. A rep conversation is internal-only.

- **Inbound routing** lives in `api/wa/webhook.js` (already a Node fn — we modify it, no new
  serverless fn, so the §219 12-fn Hobby cap is untouched).
- **The assistant reply** is an **Edge** function (`api/wa/team-assistant.js`) — Edge doesn't
  count against the 12-fn cap (§219), same as `api/wa/ai-reply.js`. It may instead be a mode
  added to `ai-reply.js`; decided at build.
- **Outbound** reuses `api/wa/send.js` (free text + document attach) inside the 24h window.

---

## 4. Identity mapping (the one new column)

`users.whatsapp_number text` — each rep's personal WhatsApp number, normalized to match the
webhook's sender id (91 + 10 digits). Seeded from the owner's list:

| Rep | WhatsApp |
|---|---|
| Jayna | 9974973686 |
| Dhara | 9409152255 |
| Rima | 8866273686 |
| Kirti | 9974073686 |
| Viral | 9974173686 |
| Mayur | 9601673686 |
| Kamina | 9898173686 |

**Identity is resolved SERVER-side from the sender's number, never from the message text.**
A number not in this table is treated as a customer (existing flow). A rep sees ONLY their
own data — every query is scoped to the resolved `user_id`. No cross-rep leak, ever.

⚠ **Verify before build:** these must be the numbers the reps actually WhatsApp *from*.
Several end in `…3686` (like the company numbers) — confirm each is the rep's real personal
WhatsApp, or their messages won't be recognised.

---

## 5. Data menu (7 items — all the rep's own data, all already in the DB)

| Item | Source |
|---|---|
| **Send quote PDF** ("send Mahant's quote") | `quotes` (created_by = rep) → stored PDF (`pdf_share_tokens` / `uploadQuotePDFHtml`, §44.9) → WhatsApp document (§127 pattern) |
| **Renewals due** | `quotes` status='won', `campaign_end_date` in next 30–60 days, created_by = rep (§44.6) |
| **Today + upcoming meetings** | `follow_ups` / `lead_activities` meeting rows, this rep, dated today+ |
| **Pending follow-ups** | open `follow_ups` (is_done=false) for the rep, due today/overdue (§130 pattern) |
| **Today's target + progress** | `daily_targets` (min_calls/meetings) vs today's actuals (call_logs / lead_activities) (§43.2) |
| **This month's incentive so far** | `compute_monthly_salary` / `monthly_score` (self-scoped, §80/§107) |
| **Leads to call today** | rep's due callbacks / open leads (`follow_ups` call-action due today) (§44.3) |

---

## 6. Interaction flows

**A. "hi" → full daily snapshot.** Rep texts anything generic → one message back:
today's meetings · pending follow-ups (count + next few) · renewals due soon · today's
target vs done · this-month incentive · leads to call. The "daily cockpit in WhatsApp".

**B. Natural-language question.** "my renewals this month" · "meetings today" · "how many
follow-ups pending" → Claude reads the intent, the endpoint fetches the rep's scoped data,
Claude answers just that. (Claude does the language understanding — Gujarati/Hindi/English,
like the customer bot §115.)

**C. Send a quote PDF.** "send [client]'s quote" → find the rep's matching quote →
- one match → send its PDF as a WhatsApp document.
- several / none → reply with a short list to pick from, or "no quote found for X".
Reuses the existing quote-PDF-to-WhatsApp send (§127) — the PDF must have been generated once
(shared from the app); if never shared, the endpoint generates it (`uploadQuotePDFHtml`).

**D. Proactive 2-hour ping.** A cron every 2h during work hours → for each rep with pending
meetings OR follow-ups today AND an open 24h window → "You still have N follow-ups + M
meetings pending today. Reply hi for details." (v1: free-text, skip if window closed.)

---

## 7. New pieces to build

| Piece | What | Where |
|---|---|---|
| `users.whatsapp_number` | rep→number map + seed 7 | SQL (additive column) |
| Webhook rep-fork | recognise rep sender → internal path, skip customer flow | `api/wa/webhook.js` (modify, no new fn) |
| `api/wa/team-assistant.js` | Edge fn: rep msg + user_id → Claude + scoped data → reply | new Edge fn (or a mode in `ai-reply.js`) |
| Scoped data reads | the rep's snapshot + quotes, filtered by the resolved user_id | service-role queries / DEFINER RPCs |
| 2-hour cron | pending-items nudge (free-text, window-open only) | Supabase `pg_cron` (SQL, like §130/§162) |
| `team_assistant_log` (optional) | audit of rep interactions | SQL (optional) |

No new customer-facing tables. No change to the customer WhatsApp flow, leads, quotes,
payroll, or any hot path (all additive — §45-safe).

---

## 8. Security (hard requirements)

- Rep identity = SERVER-resolved from the sender's WhatsApp number → `users.whatsapp_number`.
  Never from message content.
- Every data query scoped to that `user_id`. A rep can never retrieve another rep's data,
  a customer's data, or anything admin.
- A number not in the mapping is NOT a rep (falls to the customer flow) — no privilege by
  guessing.
- The team-assistant endpoint is invoked server-side from the webhook (or shared-secret
  gated, like `ai-reply.js` §115) — not a public user endpoint.
- Rep messages never create a lead / never hit the customer AI / never enter the customer
  inbox.

---

## 9. Proactive 2-hour ping — details

- **Cron:** every 2h, **09:00–20:00 IST**, **skip Sunday** (Saturday is a workday, §34Z.61).
  *(Assumption — owner to confirm the hours/days.)*
- **Who:** active sales/telecaller reps with ≥1 pending follow-up OR meeting today AND an
  open 24h window (messaged in the last 24h).
- **Message:** a short pending-summary ("N follow-ups, M meetings still pending — reply hi").
- **v1: free-text only.** Window closed → skip (logged). No template.
- **Dedup:** send the current pending count once per 2h slot; don't spam the same item.

---

## 10. Build phases

1. **P1 — identity + snapshot.** `users.whatsapp_number` + seed · webhook rep-fork ·
   team-assistant endpoint (snapshot only) · the scoped snapshot read. → Rep texts "hi",
   gets their whole day. **The core.**
2. **P2 — NL queries + send PDF.** Claude interprets specific asks; send a quote PDF as a
   document.
3. **P3 — proactive 2-hour cron.** The pending-items nudge (free-text, window-open only).
4. **P4 (optional, later).** One fallback template for silent reps (>24h). Only if needed.

Each phase ships + is owner-verified before the next (§45 — never risk the live customer
WhatsApp flow). The customer bot on 95 keeps running untouched throughout.

---

## 11. Locked decisions + assumptions

- **Number:** 95 815 78261 (service) — now freed up since the 22 boards moved to 98 (§196).
- **Menu:** the 7 items in §5.
- **Templates:** none in v1 (rep messages daily → window stays open). P4 fallback optional.
- **Ping cadence:** every 2h, 09:00–20:00 IST, skip Sunday *(confirm)*.
- **Cost:** ₹0 messaging in v1 (free-text); Claude API calls only.

---

## 12. Open questions / risks (for owner)

1. **The 7 numbers** — confirm each is the rep's real personal WhatsApp *sending* number.
2. **Ping hours/days** — 09:00–20:00 IST, skip Sunday? adjust?
3. **Multi-quote "send PDF"** — when a rep has several quotes for a client, list-and-pick OK?
4. **The 95 number is shared with legacy customer chats** — the rep-fork keeps them separate
   by sender number; confirm no rep's WhatsApp number is also used to chat as a customer.
5. **Incentive over WhatsApp** — fine to send a rep their own running incentive figure? (their
   own data, self-scoped — yes unless you object.)

---

*Integration details (exact webhook fork point, PDF-send reuse, per-item queries) are
confirmed against the live code at build time, per the §35/§40 blast-radius rule. This spec
is the shape for approval.*
