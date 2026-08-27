# Operations Module — Untitled OS

The Operations module runs the **physical GSRTC LED screen network** (screen-maintenance
field ops), separate from the sales/telecaller module. It tells you which screens are down,
gets a field technician to fix them, records the calls, and pays the tech on how well the
screens stay up.

Last updated: 2026-08-27.

---

## 1 · The two roles

| Role | Who | Device | Lands on |
|---|---|---|---|
| `operation_head` | Desk manager who runs the network + manages the field team | Desktop | `/ops-down` (Down now) |
| `operation_executive` | Roving field technician (GPS-tracked, ₹3/km travel) | Mobile | `/ops-home` (the one home) |

Both are real user roles (created via **HR → Add Member**). The head is a desk role
(no GPS tracking); the executive is tracked like a sales rep (background GPS on login,
TA from GPS pings).

---

## 2 · The screens (routes)

### Operation executive (field tech)
The tech's whole experience is **one consolidated home** + a personal trio.

| Sidebar | Route | What it is |
|---|---|---|
| **Home** | `/ops-home` | The one dashboard: check-in nudge · pay + uptime card · live "N of your screens down" strip · worst-first fault list · Log a fault · In-process/Fixed pills · this-month fixes/calls. |
| My Performance | `/ops-performance` | Uptime → pay card (ring + Base/Variable/Projected + milestones) + fixes/calls/stations + salary slip. |
| My Calls | `/calls` | Every depot call the tech made (reuses the sales call-log page). |
| My Offer | `/my-offer` | Offer letter + Travel (TA) + Leave (reuses the sales offer page). |

Mobile bottom bar = **Home · Down now · Log** (the trio moves to the ⋯ avatar drawer).
The deeper operational pages (Tickets `/ops-tickets`, Down `/ops-down`, Log `/ops-log`,
Check-in `/ops`) stay reachable from the home's strip + buttons.

### Operation head (desk)
| Sidebar | Route | What it is |
|---|---|---|
| Down now | `/ops-down` | Live board of everything offline right now, worst-first, who's on it. |
| Log issue | `/ops-log` | Log a screen fault. |
| Live console | `/ops-dashboard` | Screen/station grid · **assign a station to a tech** · ticket board · field-team map. |
| Station board | `/ops-station` | Per-station view: KPIs · screen wall · depot contacts · issue→solution reference. |
| + the personal trio (My Performance / My Calls / My Offer) |

### Admin / owner
| Route | What it is |
|---|---|
| `/ops-admin` | Owner cockpit: uptime health + trend · money (admin-only payroll) · per-tech leaderboard · ticket flow · **Record uptime** button. |

---

## 3 · How the data flows (the chain)

```
aiadflux CMS  ──(sync, every 10 min)──▶  ops_screens (real status, per screen)
                                              │  linked by depot_id
                                              ▼
                                         ops_depots (one per station)
                                              │  assigned_to = a tech   ◀── MANUAL step
                                              ▼
   the tech's Home / Tickets / My Performance are scoped to  ops_depots WHERE assigned_to = them
                                              │
              offline screens ──▶ fault list (7 AM–9 PM rule) ──▶ tech logs/fixes ──▶ ops_tickets
                                              │
              screen statuses ──▶ Record uptime ──▶ ops_uptime_daily ──▶ score_pct ──▶ PAY
```

**The one thing that makes a tech see anything: their stations must be assigned to them**
(`ops_depots.assigned_to`). Nothing auto-assigns it — it's a manual head step. An
unassigned tech is scoped to zero and sees an empty module even though the 265 CMS screens
are real. (This was the "no data" root cause, 2026-08-27.)

---

## 4 · Setup checklist (get a tech seeing real data)

1. **Create the ops team** — HR → Add Member: 1+ `operation_head` + N `operation_executive`.
   Run `supabase_ops_team_wire.sql` (points each exec's `manager_id` at the head).
2. **aiadflux CMS sync** — set Vercel envs `AIADFLUX_API_KEY`, `OPS_SYNC_SECRET`,
   `AIADFLUX_API_URL`. Fire once: `GET /api/ops/sync?run=1&secret=<OPS_SYNC_SECRET>`
   (or wait for the 10-min cron). Real screens flow in.
3. **Assign stations to techs** — `/ops-dashboard` → Screens by station → Assigned tech,
   OR bulk via `supabase_ops_assign_stations.sql`. **This is the step that lights up the
   module.**
4. **Depot contacts** — add "who to call" per station (Live console / Station board).
5. **Pay (optional, money-gated)** — run `supabase_ops_p4_uptime_pay.sql` (read Part 3 first),
   set each exec's `staff_incentive_profiles.monthly_salary`, then `/ops-admin` → Record
   uptime.

Confirm anytime with `supabase_ops_exec_nodata_diagnostic.sql` (4 read-only checks).

---

## 5 · Fault rules

### Operating window — 7 AM to 9 PM IST
Screens are meant to run **07:00–21:00**. A fault = actual state ≠ expected:
- **On-hours (7 AM–9 PM):** a screen that's OFFLINE = a fault (fix it).
- **Off-hours (9 PM–7 AM):** offline is normal; a screen still ONLINE = a **timer fault**
  (the timer didn't turn it off).

The fault list is **worst-first**: a severity stripe (red = down >2 days or a whole station;
amber = >6h; grey = recent) + station · screen(s) · type · age.

### Tickets never auto-close a lingering fault
A screen down **more than 1 day never auto-closes** even if it flickers back online — it
stays open until a tech confirms + closes it. Only a fresh blip (≤1 day, untouched, screen
recovered) auto-clears. A tech's manual "Mark fixed" is never affected.

---

## 6 · Pay model (70/30, uptime-driven)

- Field-tech pay = **70% base + 30% variable**, the variable driven by **screen uptime**.
- Uptime = share of the tech's screens live during 7 AM–9 PM, averaged over the month.
- **Full variable at ~97% uptime, zero below 90%**, scaling in between.
- The head is paid on the **whole network's** uptime (same 70/30). *(Display today; the pay
  engine's p4 trigger currently pays only the executive — extending it to the head is a
  documented money follow-up.)*
- Pay is **indicative on-screen** until uptime is recorded; the real payslip runs through the
  shared `compute_monthly_salary` chain (same as sales). TA (₹3/km) comes from GPS pings,
  independent of pay.

---

## 7 · Tables (`ops_*`)

| Table | Holds |
|---|---|
| `ops_depots` | One row per station. `assigned_to` = the tech responsible. `external_group_id` links to the CMS group. |
| `ops_screens` | One row per screen. `status` (online/offline/unknown), `depot_id`, `external_id` (CMS), `last_response_at`. |
| `ops_tickets` | A fault/photo-request. `status` (open/in_progress/resolved/approved/cancelled), `source` (manual/auto_offline/sales_request), `assigned_to`, `issue_type_id`. |
| `ops_issue_types` | The "what was wrong" list (bilingual gu/en). |
| `ops_depot_contacts` | Who to call per station (electrician / depot manager / internet tech). |
| `ops_uptime_daily` | Per-tech daily uptime % → feeds pay. |
| `ops_bot_flows` etc. | (unrelated — WhatsApp campaign) |

Screen data comes from the **aiadflux CMS** (api.adfluxcms.com) via `api/ops/sync.js`.
Field-tech GPS/attendance/TA reuse the sales infra (`gps_pings`, `work_sessions`, `daily_ta`,
`call_logs`).

---

## 8 · SQL files + run order

| File | What it does | When |
|---|---|---|
| `supabase_ops_p0_foundation.sql` | roles + all `ops_*` tables + RLS + seed | once (done) |
| `supabase_ops_p1_screen_sync.sql` | `ops_depots.external_group_id` + head work_sessions policy | once |
| `supabase_ops_p3_issue_types.sql` | the 10 real "what was wrong" types | once |
| `supabase_ops_p3_ticket_calls.sql` | `call_logs.ops_ticket_id` (attach calls to tickets) | once |
| `supabase_ops_p5_sync.sql` | the 10-min aiadflux sync cron | once |
| `supabase_ops_p6_admin_cockpit.sql` | `ops_admin_cockpit` + `ops_my_uptime_pay` RPCs | once |
| `supabase_ops_p2_auto_tickets.sql` | auto-ticket engine + the >1-day-no-close rule | once |
| `supabase_ops_p4_uptime_pay.sql` | uptime → 70/30 pay (MONEY — read Part 3) | when ready |
| `supabase_ops_assign_stations.sql` | bulk-assign stations to a tech | setup helper |
| `supabase_ops_set_salary.sql` | set a tech's monthly_salary | setup helper |
| `supabase_ops_exec_nodata_diagnostic.sql` | 4 read-only "why empty" checks | diagnostic |

All are idempotent — safe to re-run.

---

## 9 · Known gaps / to-do

- **7 AM–9 PM rule in the auto-engine** — the fault LIST honors it; the auto-ticket
  *engine* (`ops_reconcile_offline_tickets`) doesn't yet, so it would open false tickets
  for every screen the timer correctly turns off at 9 PM. Fix before it runs unattended.
- **Uptime % window** — uptime should count only the 7 AM–9 PM window; counting the whole
  day makes a perfect screen read low. Align before ops pay goes fully live.
- **Head pay** — the head's card shows network-uptime variable, but the p4 pay trigger pays
  only the executive today. Extend the trigger to the head (money change, needs sign-off).
- **Sync depot-link** — `ops_screens.depot_id` is set by a fire-and-forget PATCH in the
  sync (no error check). If it silently fails, screens exist but link to no station. The
  diagnostic query 3 (`screens_with_NO_station`) is the check; harden if >0.
- **CMS group duplicates** — the aiadflux CMS has typo/duplicate station groups; the sync
  normalizes what it can, but the permanent fix is deduping the groups in the CMS.
- **Camera / audience / uptime API** — the aiadflux API exposes camera-audience and
  per-screen uptime endpoints not yet wired into the module.
