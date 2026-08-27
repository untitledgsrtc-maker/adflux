# Operations auto-ticket flow — design

**Date:** 2026-08-27
**Module:** Operations (§230–§242). Screen-maintenance for the physical GSRTC LED network.
**Status:** Design approved (owner "ok go", 2026-08-27). Deferred "Phase 2 inbound webhook"
from §241, plus a head-approval gate.

## Goal

When a screen (or a whole station/group) goes offline, the system auto-opens ONE fault
ticket per station, assigns it to the tech who covers that depot, alerts them, and runs
the ticket through a guarded lifecycle that ends with the Operation Head approving the fix:

```
open → in_progress → resolved → approved   (+ cancelled for auto-recovered blips)
```

A tech cannot mark a ticket closed, and the head cannot approve it, while the station's
screens are still offline (live CMS-checked) — the whole value of having real status data.

## Owner decisions (locked 2026-08-27, via AskUserQuestion)

1. **Trigger** = off the existing 10-min aiadflux sync (a DB reconcile function), NOT the
   CMS real-time webhook (that's blocked on the CMS dev re-pointing it off adfluxcrm.com).
   A future webhook just flips `ops_screens.status` faster → the SAME engine, no rebuild.
2. **Granularity** = per station/group. ONE ticket per depot when its screens go dark
   (a station outage does not flood N tickets — Valsad was 14/14 down, §241).
3. **Recovery** = auto-cancel an untouched (`open`) ticket when the CMS shows the screens
   back online (a transient blip wastes no tech trip); a ticket a tech already `in_progress`
   stays and follows the human close→approve flow.
4. **Approval gate** = guard BOTH steps. Tech can't `resolve` while screens offline; head
   can't `approve` while screens offline. If it drops again after approval → a fresh ticket
   auto-opens.
5. **Alerts** = all three: in-app queue + native push + WhatsApp.

## Architecture

Everything is ADDITIVE to the existing Operations module (§45-safe). No sales/frozen contract
touched. Reuses: `ops_tickets`, `ops_depots.assigned_to`, `ops_screens.status`, the sync
(`api/ops/sync.js` + cron `ops-aiadflux-sync` jobid 23, §241), the push pipeline (enqueue_push,
§34Z.55/§96), `users.whatsapp_number` (§197), the WhatsApp send-template infra (§120).

Three moving parts:

- **The engine** — a `SECURITY DEFINER` DB function `ops_reconcile_offline_tickets()` that the
  sync calls at the end of every run. It opens + auto-cancels tickets. This is the ONLY thing
  that creates auto-tickets, so the "screen went offline" detection lives in exactly one place.
- **The guarded actions** — four `SECURITY DEFINER` RPCs (`start` / `resolve` / `approve` /
  `reject`) the app calls. They enforce the state transitions + the live-CMS guards + role gates.
- **The alerts** — fired when the engine opens a ticket: in-app (the ticket appears in the
  tech's queue), native push, and WhatsApp.

## 1 · Data model — `ops_tickets` (additive migration)

`supabase_ops_p2_auto_tickets.sql` (idempotent, `ADD COLUMN IF NOT EXISTS`, drop+recreate the
status CHECK, `NOTIFY pgrst`, VERIFY block):

- Extend the status CHECK: `('open','in_progress','resolved','cancelled')` →
  `('open','in_progress','resolved','approved','cancelled')`.
- `ADD COLUMN approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL`.
- `ADD COLUMN approved_at timestamptz`.
- `ADD COLUMN down_count int` — snapshot of how many screens were down at open (context/priority;
  the LIVE down list always reads off `ops_screens` for the depot — the Station board §242 shows it).
- Extend the source CHECK: `('manual','api_webhook','sales_request')` →
  add `'auto_offline'`. Auto-tickets carry `source='auto_offline'`.

An auto-ticket is depot-scoped: `depot_id` set, `screen_id` NULL, `type='fault'`,
`source='auto_offline'`, `issue_type_id` NULL (unknown at open — the tech sets a cause on resolve).

## 2 · The engine — `ops_reconcile_offline_tickets()`

`SECURITY DEFINER`, `SET search_path=public, pg_temp`, `EXCEPTION`-wrapped (a reconcile failure
must never break the sync — mirrors every ops function). Called at the end of `api/ops/sync.js`
(after statuses + uptime are written) via a service-role `rpc()`; also safe to call from the
`ops-aiadflux-sync` cron and the /ops-admin "Record uptime" button.

Per depot (`ops_depots WHERE is_active`):

1. **Count** its `ops_screens WHERE is_active AND status='offline'` → `v_down`.
2. **Open** — if `v_down > 0` AND the depot has NO `ops_tickets WHERE source='auto_offline'
   AND status IN ('open','in_progress')` → INSERT:
   - `type='fault'`, `source='auto_offline'`, `status='open'`, `depot_id`, `screen_id` NULL,
   - `assigned_to = depot.assigned_to` (NULL if the depot has no tech → opens UNASSIGNED,
     the head assigns it — never skipped),
   - `down_count = v_down`,
   - `priority` by down-count: `>= 5 → 'high'`, `1–4 → 'normal'` (owner-tunable constants),
   - `opened_at = now()`, `created_by` = NULL (system).
   - Then fire the alerts (§4) — best-effort, never blocks the insert.
3. **Auto-cancel (blip)** — if `v_down = 0` AND the depot has an `ops_tickets WHERE
   source='auto_offline' AND status='open'` → UPDATE it `status='cancelled'`,
   `notes = COALESCE(notes,'') || ' [auto-recovered]'`, `resolved_at=now()`.
   (A ticket at `in_progress`/`resolved`/`approved` is NEVER touched here — human-owned.)
4. Never touches `in_progress`/`resolved`/`approved`/`manual`/`sales_request` tickets.

**Dedup** is the "no open/in_progress auto-ticket for this depot" check — a still-down station
does not re-ticket. If more screens drop while a ticket is open, the ticket's `down_count` MAY be
refreshed to the current count (optional, low-value — deferred; the live list is on the board).

## 3 · Guarded actions — four RPCs (SECURITY DEFINER, role-gated, live-CMS-checked)

All fail-closed on NULL role (§41: `IF v_role IS NULL OR v_role NOT IN (...) THEN RAISE`).
"Screens still offline" = `EXISTS(ops_screens WHERE depot_id = ticket.depot_id AND is_active
AND status='offline')`.

- `ops_ticket_start(p_ticket uuid)` — the assigned tech OR head/admin. `open → in_progress`.
  Gate: caller is `assigned_to` OR role IN (admin, co_owner, operation_head).
- `ops_ticket_resolve(p_ticket uuid, p_cause text, p_notes text)` — the assigned tech OR
  head/admin. `in_progress → resolved`. **BLOCKS if screens still offline** ("Screens still down
  — you can't close this yet"). Sets `resolved_at`, `cause`, `notes`, `issue_type_id` (optional).
- `ops_ticket_approve(p_ticket uuid)` — **head/admin only**. `resolved → approved`. **BLOCKS if
  screens still offline.** Sets `approved_by = auth.uid()`, `approved_at = now()`.
- `ops_ticket_reject(p_ticket uuid, p_reason text)` — head/admin only. `resolved → in_progress`
  (send back to the tech). Appends the reason to `notes`.

Each verifies the current status matches the expected FROM-state (a stale UI can't skip steps).
REVOKE from PUBLIC/anon; GRANT to authenticated (the role gate inside does the real control).
Reassignment (`ops_depots.assigned_to` change or a direct ticket reassign) already exists (§232)
and is unaffected — a reassigned auto-ticket keeps its state.

## 4 · Alerts (fired by the engine on auto-open)

- **In-app** — the ticket appears in the tech's `/ops` queue (OpsWorkV2 already lists open
  tickets assigned to the tech, §231) with Start/Resolve. The head sees it on `/ops-dashboard`.
- **Native push** — reuse `enqueue_push` (§34Z.55/§96, service-role/definer, quiet-hours-gated).
  On auto-open, if `assigned_to` is not null, enqueue a push to that tech: title "New ticket",
  body "<Depot> — N screens offline". Best-effort inside the engine's EXCEPTION wrap. Needs the
  tech enrolled for push (they open the APK). A NULL-owner ticket sends no push (head sees it in-app).
- **WhatsApp** — a Gujarati Utility template to the tech's `users.whatsapp_number` (§197 column).
  Server-initiated (no user gesture) → business-initiated → needs an approved Meta **Utility
  template** (like the post-call set, §120): body ~ "નવી ટિકિટ: {{1}} — {{2}} સ્ક્રીન બંધ. એપ
  ખોલો." ({{1}}=depot, {{2}}=count). Sent via the existing send-template infra / a small Edge call.
  Skipped if the tech has no `whatsapp_number`.

**Head approval alert** — the head's `/ops-dashboard` gains an "Awaiting approval" section listing
`resolved` tickets (auto + manual) with Approve/Reject. In-app (the head is at a desk). No push/WA
to the head in v1.

## 5 · Where it shows (frontend, all ops files — NOT §28 frozen)

- **Tech `/ops` (OpsWorkV2)** — auto-tickets sit in the queue beside self-reported faults (§231).
  The Start/Resolve buttons now call `ops_ticket_start`/`ops_ticket_resolve` (guarded) instead of a
  raw UPDATE; a blocked resolve toasts "Screens still down". `source='auto_offline'` shows an
  "auto" chip so the tech knows it's system-generated.
- **Head `/ops-dashboard` (OpsHeadV2)** — a new "Awaiting approval" section (resolved tickets)
  with Approve (`ops_ticket_approve`) / Reject (`ops_ticket_reject`), plus the existing ticket
  board + reassign (§232).
- **Station board `/ops-station` (OpsStationV2, §242)** — auto-tickets already flow into the
  "Open issues" KPI + the screen-wall colors (it reads `ops_tickets` open/in_progress). Approved/
  cancelled tickets drop off. No change needed beyond the new statuses being non-open.
- **Admin `/ops-admin` cockpit** — ticket-flow section already counts open/faults (§233); it picks
  up auto-tickets for free.

## RLS / security

`ops_tickets` already has the Phase-0 policies (§230): `_manage` (FOR ALL, admin/co_owner/
operation_head), `_exec_read`/`_exec_update`/`_exec_insert` (the tech on their own tickets),
`_sales_request`/`_sales_read`. The auto-ticket INSERT happens inside the SECURITY DEFINER engine
(service-role via the sync) → bypasses RLS, fine. The four action RPCs are SECURITY DEFINER with
their own role gates → the app calls them as the authenticated user; the RPC enforces who can do
what. No new table-level policy needed. The status CHECK now includes `approved`; the exec-update
policy still lets a tech move their own ticket, but the RPCs are the only sanctioned path (the UI
uses them) — a tech could technically raw-UPDATE via `_exec_update`, so the guards live in the RPC,
not RLS; acceptable for an internal trusted team (the RPC is the app's path; the head-approval +
CMS guard are the real integrity, and a raw skip would still be caught by the head's live-CMS
approve guard).

## Edge cases

- **No tech on the depot** → ticket opens `assigned_to=NULL` → head assigns on `/ops-dashboard`.
  Never skipped (a down screen must surface).
- **Blip (offline one sync, online next)** → opens then auto-cancels within ~10–20 min, before a
  tech acts. Churn is a ticket appearing then cancelling — acceptable; the tech is not pinged twice
  (push fires only on open; a cancel is silent).
- **Screen drops again after approval** → the engine finds no open auto-ticket for the depot → opens
  a fresh one. Correct (a new outage = a new ticket).
- **Tech resolves right as it recovers, then it drops again before the head approves** → the head's
  approve guard blocks (screens offline) → head rejects or waits; a fresh auto-ticket may also open.
- **Depot with a stuck `in_progress` ticket that never recovers** → stays until the tech resolves
  (guarded — can't resolve while offline) → surfaces on the head's overdue band (§233, >48h).
- **Sync fails / returns empty** → the engine's EXCEPTION wrap + the sync's own guards mean no
  tickets open/cancel on a bad pull (mirrors the §240 placeholder-retire safety).

## Testing (per §8 / real-Supabase, no mocks)

- Engine: set a depot's screens to `status='offline'` in the DB → call
  `ops_reconcile_offline_tickets()` → assert one `open` auto-ticket assigned to the depot's tech,
  `down_count` correct. Flip them `online`, call again → the untouched ticket goes `cancelled`.
  Move one to `in_progress`, flip online, call again → it stays.
- Guards: `resolve`/`approve` while a depot screen is `offline` → RAISE. Flip all online → succeed.
- Roles: a non-head calling `ops_ticket_approve` → RAISE (fail-closed on NULL role too).
- Dedup: two reconcile runs with the depot still offline → still exactly one open ticket.
- Alerts: on open, a `push_log`/enqueue row for the tech (if enrolled); a WhatsApp send (if number +
  template). VERIFY block in the SQL prints the auto-ticket count + status distribution.

## Build order (nothing blocks)

1. **Schema** — `supabase_ops_p2_auto_tickets.sql` (status/source CHECK + approved_by/at + down_count).
2. **Engine** — `ops_reconcile_offline_tickets()` + wire the call into `api/ops/sync.js` (end of run).
3. **Guards** — the four RPCs.
4. **Frontend** — OpsWorkV2 (Start/Resolve via RPC + auto chip), OpsHeadV2 ("Awaiting approval" +
   Approve/Reject). In-app is done here.
5. **Native push** — the enqueue call inside the engine (owner enrolls techs via the APK).
6. **WhatsApp** — one Meta Utility template (owner approves) + the send + populate
   `users.whatsapp_number` per tech. Ships as a fast follow; steps 1–5 work with zero Meta dependency.

## Owner-side dependencies (called out)

- **WhatsApp alert**: (a) each tech's `users.whatsapp_number`, (b) ONE Meta Utility template approved
  (business-initiated). In-app + push need neither.
- **Native push**: each tech enrolled for push (opens the APK).
- **Depot → tech assignment** (`ops_depots.assigned_to`, §240): required for auto-assign; unassigned
  tickets open but need a manual head assign.
- All the Phase-2 SQL is owner-run in Studio (§14/§154 — one combined file where safe).

## Non-goals (YAGNI)

- No real-time CMS webhook in this spec (owner deferred; a future webhook feeds the same engine).
- No per-screen tickets (owner chose per-station).
- No re-open on partial recovery (a ticket tracks the depot, not individual screens).
- No SLA-escalation automation beyond the existing >48h overdue band (§233).
- No uptime-pay coupling (approval is an accountability gate, not a pay input; uptime pay is
  computed from screen status, §232 Phase 4, independent of tickets).
