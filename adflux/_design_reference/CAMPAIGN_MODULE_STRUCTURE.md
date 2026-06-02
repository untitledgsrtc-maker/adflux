# Campaign Module — Final Structure (spec, not built)

**Date:** 2026-06-02 · **Status:** RE-AUDITED → **REVISE accepted** · **Nothing is built.**
Companion to the visual mockup `campaign_module_mockup.html` (open in browser).

---

## ★ REVISION (2026-06-02) — re-audit verdict: REVISE

A second adversarial re-audit (grounded in live code) found the original plan sound but
**~2-3× overbuilt for v1** with **4 P0 live-app risks**. This revision cuts MVP to a
receive + chat + QR core, marks the full 19-table model as **V3 / future**, and locks the
4 P0 contracts below. **Build nothing** until the P0 contracts + §14 prerequisites are
owner-approved.

**Owner decisions — LOCKED (2026-06-02):**
- TC-first = **YES** (campaign leads default to a telecaller).
- Duplicate policy = **attach to existing open lead; never create a duplicate.**
- Broadcast in MVP = **NO** · Chatbot in MVP = **NO** · Segments in MVP = **NO**.
- Agency campaign access = **NO**.
- QR raw scans = **NO** — v1 counts "messaged" only.
- Vishal / co_owner scope = **GOVERNMENT only** (CLAUDE.md §42).
- Justdial = email parser, **later** (not C2).

## ★ MVP — C2 table list (build this first)

**C2 ships exactly these 7 tables + one nullable column. Nothing else.**
- `campaigns`
- `campaign_locations`
- `whatsapp_accounts`
- `whatsapp_conversations` — owns `assigned_to` + `first_response_at` + `status` (visibility NOT gated solely on `lead_id`)
- `whatsapp_messages` — `wamid` UNIQUE
- `inbound_leads` — **`(provider, external_event_id)` UNIQUE** (idempotency)
- `webhook_event_log` — PII-stripped (event id + signature_ok + status; no raw phone)
- `leads.campaign_id uuid NULL` (ON DELETE SET NULL)
- **reuse** existing `whatsapp_templates` (Phase 47.1) — extend additively

**NOT in C2 (deferred — see the V3 model below):** `broadcasts`, `segments`,
`chatbot_flows`, `chatbot_nodes`, `message_suppression` (reuse `leads.wa_opt_out` /
`do_not_call`), `campaign_sources`, `campaign_routing_rules` (collapse to a column),
`lead_source_events`, `integration_errors` (fold into `webhook_event_log.status`),
`leads.location_code` (use `location_id uuid NULL REFERENCES campaign_locations(id)`,
added in **C8** — not C2).

## ★ P0 contracts (lock before ANY build)

**P0-1 · Dedup.** Normalize phone with the EXISTING app helper (`cleanPhone` → `91`+10,
used by WorkV2 / LeadDetailV2 / TelecallerV2 — do not invent a new one). Before inserting,
call `find_open_lead_id_by_phone()`; if an open lead exists, **attach / link to it** (don't
insert). **Never let `trg_leads_block_dup_phone` throw in the webhook path** (it raises on
an open-lead phone collision → would error the webhook). **Never silently reassign an
existing lead to another rep.** Documented tie-break when 2+ leads share a phone.

**P0-2 · Routing.** A campaign-created lead ALWAYS sets exactly one owner column —
`telecaller_id` OR `assigned_to`. **Default = `telecaller_id` (TC-first).** `segment` ALWAYS
set (**default `PRIVATE`**). **Never leave both owner columns NULL** for campaign leads (that
dumps them into the live round-robin, which knows nothing about campaigns).

**P0-3 · Activity.** Bot / WhatsApp automation **never** writes `lead_activities` as
`meeting` / `site_visit` / `call` (those feed `compute_daily_score` → incentive, and the
§33 meeting-KPI). Use `activity_type='whatsapp'` (already ignored by the score function) or
a safe note-only log. No score / incentive inflation.

**P0-4 · Stage.** Only the live stages: **New, Working, QuoteSent, Nurture, Won, Lost.**
Never the removed `Qualified` / `Contacted` (the CHECK rejects them → hard error → lead lost).

> Any commit that writes to `leads` or `lead_activities` requires a **sales-module-guardian
> PASS** — a frozen DB contract can break without touching a frozen file.

---

## 0 · HARD RULE — do NOT touch the live app (correctness AND speed)

The team runs this app every day; their incentive math depends on it. **Any regression OR
slowdown to an existing flow is unacceptable and costs the owner real money.** This rule
outranks every feature in this doc.

**Additive only.** The Campaign module is a separate layer bolted *beside* the current system
— new tables, new routes, new endpoints, new Edge functions. New campaign leads enter the
existing `leads` table through the SAME insert path the Excel upload already uses (Phase 99
routing honored). The only change to existing data is **additive nullable columns no existing
code reads** (`leads.campaign_id` in C2; `location_id` in C8) — and even those get a
sales-module-guardian pass because frozen pages `SELECT *`.

**Off-limits — no edits without explicit owner approval + guardian PASS:** every existing
flow/file — leads CRUD, LeadUploadV2, WorkV2, TelecallerV2, LeadDetailV2, LeadsV2, FollowUpsV2,
QuotesV2, quote wizards, payments / payroll / TA-DA, proposal renderers, dashboards, the
push-pipeline internals, all existing triggers + RLS, the §28 frozen sales/TC surface.

**No-slowdown guarantee.** The module adds ZERO latency to existing screens (leads list,
/work, /telecaller, lead detail, save flows):
- New triggers go on NEW tables. Anything that must touch `leads`/`lead_activities` must be
  proven non-blocking + guardian'd — never add a synchronous trigger to a hot save path.
- No new RLS subqueries or joins on existing high-volume tables.
- Webhooks reply 200-fast and process async — never block on inbound.
- Realtime / polling subscribe to NEW tables only.

**Hard stop.** If a campaign feature CANNOT be built without editing a live flow/file OR adding
load to a hot path → **STOP, tell the owner, get explicit approval + guardian + a before/after
perf check.** Never quietly tweak a live file to make the new thing work.

---

## 1 · What a Campaign is

A campaign bundles: **source + offer + WhatsApp number + auto-reply template +
routing (which rep/TC) + tracking.** Leads come in → instant WhatsApp reply → bot
qualifies → telecaller/sales works it → quote → won, all stamped to the campaign so
you see which ad/board makes money.

---

## 2 · Screens (sitemap — 8 surfaces, admin-gated)

| # | Screen | Purpose | Key content | Primary actions |
|---|---|---|---|---|
| 1 | **Campaigns** `/campaigns` | list + KPIs | summary cards (leads / auto-replies / reply rate / won ₹); table: name · source · number · **telecaller** · leads → replied → quotes → won → conv% | New campaign · View |
| 2 | **Inbox** `/campaigns/inbox` | two-way WhatsApp chat | thread list (filter by number / rep); conversation with 24h-window indicator, canned replies, **assign/reassign TC**, send box | Reply · Reassign · Open lead · Create quote |
| 3 | **Broadcast** `/campaigns/broadcast` | bulk send + results | **billing strip** (balance · msgs left · spent · Top up); funnel (audience→sent→delivered→read→clicked→replied→failed) + credit ₹ + per-day chart + template preview; **composer** (template + segment + suppression math + est cost + tier warning) | New broadcast · Top up |
| 4 | **Segments** `/campaigns/segments` | reusable audiences | rule builder (source · city · **last-broadcast = opened/failed/replied** · opted-in) + live count; saved segments incl. **auto-suppressed (failed + opted-out)** | Build · Save · Broadcast to |
| 5 | **QR & Locations** `/campaigns/qr` | per-board attribution | big QR + encoded link; cards (scans → messaged → leads → top board); table of boards each with own QR + scans/messaged/leads/conv% + TC; scans-by-city; **dead-board flag** | Download QR · View board |
| 6 | **Chatbot** `/campaigns/chatbot` | rule-based bot builder | node canvas (Start → Greeting → Rates/Photos/Quote/Handoff) + block rail + properties panel | Edit nodes · Test · Publish |
| 7 | **Integrations** `/integrations` | connect providers + templates | WhatsApp connection (Business→WABA→numbers→token→secret→webhook→payment); **go-live checklist**; **templates** (category + approval status); Meta Lead Ads card; Justdial card | Connect · Submit template · Top up |
| — | **Lead detail → Conversation tab** | per-lead chat + bot transcript | the WhatsApp thread inside the existing lead page | Reply |

Topbar: **notification bell** (inbound alerts) + the same alerts fire as **phone push**.

> **MVP screens (v1):** Campaigns · Inbox · QR & Locations · Integrations + the Lead
> Conversation tab. **Deferred (V3):** Broadcast · Segments · Chatbot.

---

## 3 · Full data model (V3 / future — NOT MVP)

> **This 19-table model is the FULL V3 vision, not the build target. C2 ships only the 7
> tables in the "★ MVP — C2 table list" section above.** The rest below land in later phases.

> RLS pattern mirrors the app: admin/co_owner full; reps see only their own via the
> child-via-parent rule. **Caveat (P1):** `whatsapp_conversations` must ALSO carry its own
> `assigned_to`, because a conversation exists BEFORE a lead (bot mid-qualify) — gating
> visibility only on `lead_id` would blank the inbox for in-flight chats. Every inbound keys
> on **`(provider, external_event_id)` UNIQUE** for idempotency (webhooks retry).

**Add to existing (staged):** `leads.campaign_id uuid NULL` in **C2**; the location link as
`leads.location_id uuid NULL REFERENCES campaign_locations(id)` in **C8** — NOT
`location_code` (denormalized text drifts).

### Campaign config
| Table | Key columns | Notes |
|---|---|---|
| `campaigns` | id, name, source_type, offer, segment, whatsapp_account_id, auto_reply_template_id, routing_rule_id, is_active, created_by | admin RLS |
| `campaign_sources` | id, campaign_id, source_type, external_ref (page_id/form_id) | one campaign, many sources |
| `campaign_routing_rules` | id, campaign_id, mode (fixed_tc/fixed_sales/round_robin/fixed_owner), target_user_id, segment | decides which column gets set |
| `campaign_locations` | id, campaign_id, code (`RR-AHM-01`), label, city, lat, lng, qr_text, is_active | the per-board QR rows |

### Integration / WhatsApp
| Table | Key columns | Notes |
|---|---|---|
| `integration_accounts` | id, provider (meta/whatsapp/justdial), label, external_id, status, last_ok_at | config only, **never secrets** |
| `whatsapp_accounts` | id, integration_account_id, **provider** (cloud_api/bsp), phone_number_id, display_number, waba_id, quality_rating, messaging_tier, default_telecaller_id, is_active | one row per number; **add/move/swap = insert or edit a row, no code change** (see §4B) |
| `whatsapp_templates` (reuse Phase 47.1, extend) | + provider_name, category (UTILITY/MARKETING/AUTH), language, approval_status, components_json | template manager |

### Intake (staging + audit)
| Table | Key columns | Notes |
|---|---|---|
| `inbound_leads` | id, source, raw_payload jsonb, normalized (phone/name/city), dedupe_phone, status (new/converted/duplicate/error), lead_id, campaign_id, location_code, received_at | 180-day retention |
| `lead_source_events` | id, inbound_lead_id, event_type, detail jsonb, at | per-lead audit |
| `webhook_event_log` | id, provider, signature_ok, payload jsonb, http_status, at | 90-day retention |
| `integration_errors` | id, provider, context, error, payload, resolved, at | dead-letter queue |

### Conversation
| Table | Key columns | Notes |
|---|---|---|
| `whatsapp_conversations` | id, whatsapp_account_id, lead_id, customer_wa_id, assigned_to, window_expires_at, last_inbound_at, status, bot_state | one thread per (number, customer); unique (account, wa_id) |
| `whatsapp_messages` | id, conversation_id, wamid (unique), direction, type, body, template_name, status (sent/delivered/read/failed), error, at | wamid dedupes webhook retries |

### Broadcast + segments
| Table | Key columns | Notes |
|---|---|---|
| `segments` | id, name, rules_json, contact_count, created_by | rules incl. last-broadcast status |
| `broadcasts` | id, campaign_id, template_id, segment_id, status, audience_count, sent/delivered/read/failed/replied counts, credit_cost, scheduled_at, sent_at | the funnel + credit data |
| `broadcast_recipients` | id, broadcast_id, lead_id, phone, wamid, status, error, at | per-recipient status → **powers segment-from-results** |
| `message_suppression` | id, phone, reason (failed/opted_out/dnc), at | auto-excluded from every send (or reuse `leads.wa_opt_out` + a view) |

### Chatbot
| Table | Key columns | Notes |
|---|---|---|
| `chatbot_flows` | id, campaign_id, name, is_active | one flow per campaign |
| `chatbot_nodes` | id, flow_id, type (message/buttons/condition/action/handoff), config_json, x, y, next_map_json | canvas nodes + edges |

---

## 4 · Integrations — exact mechanics (verified vs current Meta docs)

### WhatsApp Cloud API (the inbox + auto-reply + broadcast)
- Hierarchy **Business → WABA → phone_number_id**. Send via `POST /{phone_number_id}/messages`.
- **24-hour window**: business-initiated needs an approved template; customer reply opens 24h of free-form; each inbound resets it.
- **Templates**: categories UTILITY (auto-reply) / MARKETING (broadcast) / AUTH; Meta-approved; positional `{{1}}` params.
- **Webhook** (`messages` field): inbound messages + delivery statuses (sent/delivered/read/failed). Verify `X-Hub-Signature-256` = HMAC-SHA256(raw body, App Secret) + `hub.challenge` handshake. Return 200 fast, process async.
- **Tiers**: 250 → 1K → 10K → 100K → unlimited business-initiated/24h; auto-raises with quality + volume.
- **Pricing** (per-message since 1 Jul 2025): service replies in-window free; utility-in-window free; marketing billed.
- **Already live for you:** 2 numbers connected, business verified + approved, quality High.
- **Future option (not v1):** WhatsApp Business Calling API — voice calls *inside* the chat
  thread (a TC could call a lead over WhatsApp instead of cellular, logged in the same thread). Parked.

### Meta Lead Ads (auto-pull FB/IG lead forms) — SEPARATE permission
- Webhook payload = **IDs only**; fetch full lead via `GET /{leadgen_id}` → `field_data`.
- Needs `leads_retrieval` + page perms + **App Review + Advanced Access + Business Verification** (weeks).
- Same HMAC webhook verification. Dedupe on `leadgen_id`. Backfill sweep via `GET /{form_id}/leads`.

### Justdial — NO public API
- Build an **email-forwarding parser**: forward JD lead emails → inbound endpoint → regex → `inbound_leads` (source=Justdial). Free, self-controlled. *(Optional: RM-enabled webhook to our endpoint — ask edigiexpert/JD account manager.)*

---

## 4B · Future-proof — add/change an account or swap the WhatsApp API (no rebuild)

Designed so you can **add a number, move a WABA off edigiexpert, rotate a token, or switch
providers** without touching app code — because nothing about an account is hardcoded.

**Account config lives in DB rows, not code:**
- `integration_accounts` (provider · label · external_id · status) = the connection record.
- `whatsapp_accounts` (phone_number_id · display_number · waba_id · **provider** · quality ·
  tier · default_telecaller_id · is_active) = **one row per number.** Add a number = insert a
  row in the Integrations UI; the inbound webhook routes by `value.metadata.phone_number_id`
  → looks up this row → **no code change.**

**Secrets are per-account, in Edge config (never in DB, never in frontend):**
- Each account's token + App Secret is a named Edge secret keyed to that account. **Rotate
  edigiexpert's token = update one secret. Add a WABA = add its secret.** The send/verify path
  reads the secret for the account the message belongs to.

**Provider is a field + an adapter, not a hardcode:**
- `whatsapp_accounts.provider` = `cloud_api` today (direct Meta). The send/receive path sits
  behind ONE adapter interface (`sendMessage(account, …)` / `verifyWebhook(account, …)`).
- **Switching provider later** (direct Cloud API ↔ a BSP like AiSensy/Wati, or a new number on
  a different setup) = write ONE new adapter to the same interface + set that account's
  `provider`. Campaigns / inbox / leads / routing stay untouched.

**Moving a WABA off edigiexpert → your own Meta business:** update that account's `waba_id` +
token (row + secret). **No schema change, no code change, no data migration** — history
(conversations/messages/leads) is keyed to the account row, not the owner.

**Two providers can run side-by-side during a migration:** `webhook_event_log.provider` +
`inbound_leads.source` namespace every event, so old-number-on-A and new-number-on-B don't collide.

**Design rule:** never hardcode a number, token, waba_id, phone_number_id, or provider URL in
app code or a committed file. If it changes when you add/move/swap an account, it lives in
`whatsapp_accounts` (config) or Edge secrets (credentials).

---

## 5 · Inbound flows (step-by-step)

**Meta lead:** webhook (IDs) → verify HMAC (raw body) → 200 fast → async fetch
`GET /{leadgen_id}` → normalize phone (existing `cleanPhone`) → **P0-1**: find existing open
lead → attach if found, else insert with **P0-2** routing (set `telecaller_id` TC-first +
`segment` default PRIVATE; never both-NULL) → send auto-reply template → create
conversation → create follow-up → notify via DEFINER trigger → log every step.

**Justdial:** forwarded email → parser → same `inbound_leads` pipeline.

**WhatsApp message / QR scan:** customer sends (QR pre-fills `[RR-AHM-01]`) → webhook
→ verify → read location tag → create/find lead (city + board stamped) → auto-reply →
bot greets (location-aware) → on handoff/qualify, route to that city's TC → push.

**Manual/Excel:** unchanged — `LeadUploadV2` keeps working, shows as source "Manual".

---

## 6 · Outbound

- **Auto-reply**: on a new lead, send the campaign's approved UTILITY template from its number.
- **Live chat**: free-form text inside the 24h window (the Inbox).
- **Broadcast**: pick approved template + **audience (saved segment OR uploaded CSV)** → suppress failed/opted-out → throttle to messaging tier → send → track per-recipient status → funnel + credit total. CSV = one phone column (10-digit/+91) + optional variable columns; reuses the `LeadUploadV2` CSV-parse pattern; **own contacts only** (cold lists burn the number).
- **Re-open after 24h**: send an approved template (the Inbox shows the locked state + template picker).
- **Billing = display only**: the module SHOWS balance + estimated cost + spend. Top-up +
  payment live on **Meta / edigiexpert** — the app **NEVER stores a card** and never processes
  payment; the "Top up" button opens Meta/edigiexpert. *(Broadcast + billing = V3.)*

---

## 7 · QR / location attribution

Each board gets a QR encoding `wa.me/<number>?text=Hi, saw your screen at <Place> [CODE]`.
Scan → WhatsApp opens pre-filled → customer sends → first message carries `[CODE]` →
we stamp lead with board + city + campaign, auto-reply, route to that city's TC.
Dashboard rolls up **messaged → leads → quotes → won per board**. Dead boards
(0 messages/30d) flagged. **Raw scan counts = OUT for v1 (owner-locked)** — v1 counts
"messaged" only (a message carrying `[CODE]` arrives). Raw-scan-via-redirect = future.

**Manual QR creation:** an admin "New QR" form — board name + city → auto-builds the code
(e.g. `RR-AHM-01`) + the WhatsApp link with the city tag → renders the QR → **Download PNG /
PDF** to print on the hoarding. The city flows into both the message tag AND the city→TC
routing. Make as many boards as needed.

---

## 8 · Chatbot

Rule-based (AI later). Per-campaign flow on a node canvas: **Start (QR/message, carries
tag) → Greeting (location-aware, menu buttons) → Rates / Photos / Get-a-quote →
Qualify (city/budget/duration) → Route to city's TC → Human handoff** (on "talk to
person" or 2 failed tries → assigned TC + push, bot stands down). Full transcript on the
lead's Conversation tab.

---

## 9 · Segments + suppression

Build reusable audiences from CRM + past-broadcast results. Rules stack:
**lead stage (e.g. is-not Lost) · has open follow-up · heat · source · city ·
last broadcast = opened / not-opened / replied / failed · opted-in.** Live count, save,
reuse. **Failed + opted-out auto-suppressed from every send.**
- **CRM-filter example (owner's case):** 5,000 leads → exclude 3,000 Lost → keep only the
  ~500 in active follow-up → broadcast to those 500 (pay for 500, not 5,000).
- **Past-results example:** 5,000 blast → 1,500 open → save "opened" → next blast = those
  1,500; the 1,000 that failed → suppressed forever.

---

## 10 · Notifications

Every inbound message + new lead + broadcast-finished + webhook-failure → **in-app
notification (bell + toast)** AND **phone push** (reuse the existing `enqueue_push`
pipeline + quiet-hours gate). Push goes to the assigned rep.

---

## 11 · Routing doctrine (Phase 99 — must not break)

- TC-owned lead → set `telecaller_id`, leave `assigned_to` NULL. **(Campaign default — TC-first.)**
- Sales-owned → set `assigned_to`, `telecaller_id` NULL.
- **Campaign leads NEVER leave both NULL** (P0-2) — that dumps them into the live
  round-robin, which has no campaign awareness. Always set one owner + `segment` (default PRIVATE).
- No phone-less campaign leads (queued as `error` for manual review).
- Dedupe = **attach to existing open lead** (P0-1) — never create a duplicate, never reassign.

---

## 12 · Roles / access

| Role | Access |
|---|---|
| admin | full (config + all conversations) |
| co_owner (Vishal) | **GOVERNMENT-scoped only** (per §42 doctrine) |
| sales | own campaign leads + own conversations |
| telecaller | TC-assigned leads + conversations |
| agency | none by default *(owner decision)* |
| hr / accounts / office_staff | none |

Integration config (tokens/templates/billing) = admin/co_owner only.

---

## 13 · Server endpoints + security (UPGRADED)

Endpoints (MVP = the WhatsApp webhook only; meta/jd deferred):
- `api/wa/webhook` — WhatsApp inbound + statuses. **MVP.**
- `api/meta/leadgen` — Meta lead webhook. *(deferred — C9)*
- `api/jd/inbound` — Justdial email-parser intake. *(deferred — later)*

**Security must-haves before the FIRST production webhook:**
1. **Raw-body HMAC-SHA256** verify (`X-Hub-Signature-256`) — disable body-parser
   (`config.api.bodyParser=false`); reject on mismatch; never skip-to-make-it-work.
2. **`(provider, external_event_id)` UNIQUE** on `inbound_leads` — retries can't duplicate-insert.
3. **`wamid` UNIQUE** on `whatsapp_messages` — status-retry dedupe.
4. **200-fast, process async** — respond before DB work, or Meta retry-storms.
5. **Secrets in Edge config only** (App Secret, permanent token, service-role) — never in
   frontend or a client-readable `api/` file. `META_WABA_*` already live in the Edge runtime.
6. **Push via a DEFINER trigger, NOT `rpc('enqueue_push')`** — it is REVOKED from
   `authenticated`/`anon` (Phase 97.A2); a direct call returns 42501. Mirror Phase 34Z.55 +
   the `is_push_allowed_now()` 9-21 IST quiet-hours gate.
7. **Single opt-out source** — reuse `leads.wa_opt_out` / `do_not_call` (Phase 47.5); no
   second suppression table (split-brain = DNC / account-ban risk).
8. **PII minimization + purge** — `webhook_event_log` stores no raw phone (hash/strip);
   full payload only in admin-RLS `inbound_leads`; ship the retention purge cron WITH the table.
9. **No public endpoint without an inline guard + rate limit** — the `_`-prefixed helper
   does NOT bundle on this Vercel project (`api/directions.js:27`; `api/_guard.js` no longer
   exists) → inline the guard per endpoint + lock the `hub.challenge` verify-token handshake.
10. **RLS on every new table** from day one; conversations own their `assigned_to` (pre-lead visibility).

**Ops screens required (see §15):** webhook health (last-received, signature-fail count) ·
retry failed send · resolve-duplicate / manual map inbound→existing lead · token health.

---

## 14 · Do-NOT-build-yet prerequisites

Build nothing until ALL of these are in hand / owner-approved:
1. **Permanent token + contact from edigiexpert** (they own your WABAs; can revoke anytime) —
   *gates everything WhatsApp.* #1 risk on the register, not a checklist row.
2. **App Secret** — for raw-body HMAC verification.
3. **Owner-approved dedup policy** — LOCKED: attach-to-existing-open-lead (P0-1).
4. **Owner-approved routing default** — LOCKED: TC-first, `segment=PRIVATE` (P0-2).
5. **Opt-out wording** — the exact "reply STOP to opt out" text.
6. **Data-retention period** — days for `webhook_event_log` + `inbound_leads` raw payloads.

Phase-gated (NOT needed for C2–C5 receive + chat):
- **Payment method** on the WABA — only for auto-reply templates (C7) + broadcast (V3).
- **Tier-up** — only for >1,000/day broadcasts (V3).
- **Meta Lead Ads permission** (`leads_retrieval` + App Review) — only for Meta ingest (C9).

---

## 15 · Build phases (REVISED — each shippable + safe; STILL NOT BUILT)

| Phase | Goal | Needs | Risk | Gate |
|---|---|---|---|---|
| C2 | 7 MVP tables + `leads.campaign_id` + **the 4 P0 contracts written + idempotency keys** | — | low | security-rls-auditor |
| C3 | Integrations health + template list — **read-only** (connection display, no send) | token | low | — |
| C4 | WhatsApp **receive-only** webhook — inline raw-body HMAC + idempotency. Store conversation+message. **No lead write, no auto-reply.** Verify vs a real Meta test payload first. | token + App Secret | medium | preview-deploy |
| C4.5 | Inbound → `leads` with the **P0-1 dedup + P0-2 routing** contract | C4 | **high** | **guardian + security** |
| C5 | Inbox (reply in 24h window) + notifications via DEFINER trigger | C4.5 | medium | guardian |
| C8 | QR / location (add `location_id`) — ship **"messaged"**, not scans | C5 | low | — |

**Deferred (NOT in this build):** auto-reply send (C7), Meta Lead Ads ingest (C9), Justdial
parser (later), Broadcast + Segments (V3), Chatbot (V3).

**Smallest first build:** C2 → C3 → C4 → C4.5 → C5, then C8. Receive customer messages,
chat back in-app, route safely, alert the rep, attribute by board — needs only the
edigiexpert token (no billing). **Biggest risk: C4.5** — a campaign lead colliding with the
live pool (double-insert or hijack a rep's lead). Gate it hard (guardian + security).

---

## 16 · Owner decisions

**LOCKED (2026-06-02):**
- TC-first = **YES** · Duplicate policy = **attach to existing open lead** · Broadcast MVP = **NO**
- Chatbot MVP = **NO** · Segments MVP = **NO** · Agency access = **NO** · QR raw scans = **NO** (messaged only)
- Vishal / govt scope = **GOVERNMENT only** · Justdial = email parser **later** (not C2)

**Still open (needed before C2–C5):**
1. Which number is THE campaign number? (you have 2-3)
2. Default auto-reply text (transactional / UTILITY wording).
3. Opt-out wording ("reply STOP…").
4. Data-retention days (`webhook_event_log` + `inbound_leads` raw payloads).
5. Template-approval owner (who submits + tracks template approvals).
6. **edigiexpert token owner / contact.**

---

## 17 · What stays untouched (the guarantee)

Leads table (except 2 nullable columns) · LeadUploadV2 · telecaller flow · sales /work ·
quote wizards · payments / payroll / TA-DA · proposal renderers · APK shell · the §28
frozen sales contracts · the existing push pipeline (extended, not replaced). The module
reads and writes through the **same lead-insert contract** the Excel upload uses, so reps
who are live on the app see new rows — not new behavior.

**Speed guarantee:** the module adds no query, join, trigger, or RLS cost to any existing
screen or save flow (see §0). If a build step would, it STOPS for owner approval + a
before/after perf check. No regression, no slowdown — that is the non-negotiable bar.
