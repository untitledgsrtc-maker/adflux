# Operation-executive ticket dashboard — design

**Date:** 2026-08-27
**Owner-approved via clickable mockup** (visualize widget `ops_exec_daily_flow`, this session).
The mockup is the visual source of truth; this doc locks the data mapping + contracts.

## 1 · What it is

The operation_executive's single daily home: an assigned-city filter + **3 status tabs
(Open · In process · Fixed)** that carry a screen fault from "it's offline" to "it's fixed",
recording the fix-it call like a sales call along the way.

**This CONSOLIDATES the three overlapping ops-exec surfaces the owner keeps calling cluttered**
(§240-§245): the Down-now offline view (`/ops-down`), the Log-issue screen (`/ops-log`), and the
OpsWorkV2 ticket queue (`/ops`) collapse into ONE tabbed dashboard. Check-in stays (top-of-page).
No new offline/issue/queue surface is invented — the tabs ARE those three, unified.

## 2 · The flow (as approved)

1. **City dropdown** — the exec's assigned stations (`ops_depots` where `assigned_to = me`) + an
   "All my stations" option. Filters all three tabs.
2. **Open tab** (default) — offline screens needing a ticket, from the LIVE CMS data
   (`ops_screens.status='offline'` in the exec's depots, with no open/in_process ticket).
   Toggle **Grouped** (one card per station → tap a screen, or "Log the whole station" = one ticket
   per offline screen at that station) or **Individual** (flat list).
3. **Issue capture** — tap a screen (or the whole station) → sheet: **What was wrong** (dropdown =
   `ops_issue_types` active rows, the owner's 10 from §244, + "Other → type it") + **Notes** +
   **Add a photo** (optional) → **Submit → In process**. Creates/advances `ops_tickets`.
4. **In process tab** — the exec's tickets `status='in_progress'`. Each card shows the station·screen·issue
   + the **depot contact** (`ops_depot_contacts`) with a **Call** button.
5. **Call the contact** — Call dials the contact (`tel:`) AND records the call like sales
   (`call_logs` row, ticket-linked). Call ends → **outcome sheet** (Reached / No answer / Will come /
   Fixed on call) + optional note → saved. Multiple calls per ticket accumulate as a call history.
6. **Mark fixed** → ticket `status='resolved'` → moves to the **Fixed tab** (station·screen·issue·who·when
   + the call history kept).

## 3 · Data model — REUSE, near-zero new schema

All live from §230 Phase-0 + §240/§241 real aiadflux sync. No new tables.

| Surface | Table | Notes |
|---|---|---|
| City filter | `ops_depots` (`assigned_to`, `name`, `is_active`) | assigned-to-me stations |
| Open tab | `ops_screens` (`status`, `name`, `depot_id`, `is_active`) | live CMS status; offline + no open ticket |
| Issue dropdown | `ops_issue_types` (`issue_en/gu`, `is_active`, `display_order`) | owner's 10 (§244) |
| Ticket | `ops_tickets` (`status`, `type='fault'`, `source='manual'`, `cause`, `notes`, `photo_path`, `screen_id`, `depot_id`, `issue_type_id`, `assigned_to`) | the lifecycle |
| Contact | `ops_depot_contacts` (`role_en/gu`, `name`, `phone`, `display_order`) | who to call |
| Photo | `ops-photos` private bucket | signed-URL read |
| Call | `call_logs` + **NEW nullable `ops_ticket_id`** | ticket-linked call (§3.1) |

### 3.1 The ONE new column: `call_logs.ops_ticket_id` (nullable uuid → ops_tickets)
"Record every call like sales" = a real `call_logs` row per call. Sales calls key on `lead_id`;
an ops fix-it call has no lead (§230 foot-gun: ops calls aren't lead-keyed → the sales
duration-capture util is skipped, accepted). So we add a nullable `ops_ticket_id` FK so an ops
call attaches to its ticket + shows in the ticket's call history. Sales `call_logs` rows keep it
NULL — **zero impact on the sales call flow, the §92 STOP-rule, or §170/§173 dedup** (an ops call
has a NULL `lead_id`, is ticket-keyed, and never enters the sales queue). Additive column only.

The post-call outcome sheet writes: `call_logs` row (`user_id=me`, `client_phone=contact.phone`,
`direction='outgoing'`, `outcome` ∈ reached|no_answer|will_come|fixed_on_call, `notes`,
`ops_ticket_id`). Duration is best-effort/absent (§230 — no lead-keyed capture; acceptable).

## 4 · The close model (Mark fixed) — the ONE decision to confirm

§243 built `ops_ticket_resolve` which **HARD-blocks** a close while the CMS still shows the screen
offline. §244 the owner **rejected the head-approval lifecycle**. For this exec flow:
- **Fixed = `status='resolved'`. NO head approval** (dropped per §244). The §243 approval RPCs
  stay dormant / head-only and are not in the exec path.
- **CMS still-offline on Mark fixed = SOFT warn, not hard block** (recommended). A tech may finish
  the physical fix before the 10-min CMS re-sync flips the screen online; a hard block traps them.
  → a confirm ("the CMS still shows this offline — mark fixed anyway?"), then allow. The §243
  auto-engine reconciles status separately. If the owner prefers the hard block, we reuse
  `ops_ticket_resolve` as-is.

## 5 · Where it lives / navigation (consolidation)

- This becomes the operation_executive's **primary landing** (the tabbed dashboard). Route
  `/ops-tickets` (or repoint `/ops`); RootRedirect `operation_executive → this page`.
- **Consolidation:** the three current exec surfaces fold in — Open tab replaces `/ops-down`'s
  offline view, issue capture replaces `/ops-log`, the In-process/Fixed tabs replace OpsWorkV2's
  queue. Keep the old routes reachable (deep-links) during the transition to avoid breaking
  anything live (§45), then retire them once this is confirmed.
- **Check-in** (OpsWorkV2's daily gate + GPS, §231) stays — surfaced at the top of the dashboard
  or kept as the CheckInGate. operation_executive stays GPS-tracked (§231 — must NOT enter the
  V2AppShell GPS skip list).
- operation_head keeps `/ops-down` (Down now, §245), `/ops-dashboard` (Live console), `/ops-station`
  (Station board), `/ops-admin` (cockpit). This spec is the EXEC surface only.

## 6 · Contracts / reuse / what NOT to touch

- **Reuse the §243 guarded RPCs** for state transitions (`ops_ticket_start` open→in_progress on
  Submit, a resolve for Mark fixed) — fail-closed NULL role (§41), REVOKE+GRANT posture kept.
- **`call_logs.ops_ticket_id` is the only schema add.** Additive, nullable — no sales-flow,
  §92, §170/§173, or dedup impact.
- Gujarati-first UI (`opsStrings`, §231) with the ગુ/EN toggle. Lucide icons, app tokens (§5/§7).
- NOT a §28-frozen sales file. Frozen touches (App.jsx route/redirect, V2AppShell nav) are additive
  → sales-module-guardian before commit (§28/§40).
- §45 no-slowdown: all queries are ops-table + per-exec scoped; no hot sales-path load. The offline
  list reads `ops_screens` (already synced every 10 min, §241) — no per-render CMS call.

## 7 · Out of scope (this spec)

Head approval (rejected §244), the head/admin ops consoles (§240/§241/§245 — done), uptime pay
(§240 p4, money, separate), the auto-ticket engine (§243 — runs underneath; its auto-opened rows
simply appear in the Open/In-process tabs). Photo-request tickets (sales bridge §232) are a
different ticket type and unaffected.

## 8 · Acceptance (proves it works)

- An exec picks a city → Open tab lists that city's offline screens (grouped + individual).
- Submit an issue on a screen → it leaves Open, appears in In process as a ticket with the issue +
  the depot contact.
- Call the contact → a `call_logs` row is written with `ops_ticket_id` set + the chosen outcome;
  the ticket shows the call in its history; a second call adds a second row.
- Mark fixed → ticket resolves → appears in Fixed with who·when + the call history; leaves In process.
- A sales rep's call flow, the §92 STOP-rule, and sales `call_logs` are byte-unchanged (ops_ticket_id
  NULL on every sales row).
