# Operations fault flow - design (24 Oct 2026)

Status: WAITING FOR OWNER APPROVAL. Nothing below is built yet. Decisions marked (owner) were answered by Brijesh in chat on 24 Oct; marked (my call) are mine and can be changed.

## 1. Goal
Any screen that goes off becomes a tracked fault, the technician works it through a simple list, it closes by itself when the screen is back, and the time lost, the history of every screen and a fair technician score all come out of that without anyone typing a report.

## 2. Today (what exists, so we only build the gap)
- Auto tickets are one per STATION (not per screen); the sync runs every 10 minutes (`api/ops/sync.js`); `ops_reconcile_offline_tickets()` opens/cancels them (section 243/259).
- Technician pages: /ops-home, /ops-tickets (Open / In process / Fixed / Me), /ops-fix, /ops-log. Head: /ops-command, /ops-dashboard, /ops-station, /ops-down. Owner: /ops-admin (rebuilt 24 Oct).
- Head approval exists (resolved -> approved) and the resolve guard refuses while any screen at the station is offline.
- Missing: per-screen fault log, auto-Fixed, 9:30 PM timer check, fault-time numbers, daily fault report, technician score.

## 3. The flow
### 3.1 Daytime fault (7 AM - 9 PM IST)
1. Screen offline for about 15 minutes (my call, avoids short blinks) -> one fault row for THAT screen + a ticket for the station owner. If a station has several screens down the technician still sees one list, one row per screen.
2. Push to the technician (inside the existing 9 AM-9 PM quiet-hours rule; a fault found at 7:30 AM is pushed at 9:00) (owner).
3. Technician taps In process, calls a contact from the station list, logs the reason for one screen or the whole station at once.
4. Ticket stays In process until the screen has been online for about 30 minutes in a row (my call). Then it moves to Fixed by itself, no head approval (owner).
5. Fault-to-fixed time is saved. Only minutes between 7 AM and 9 PM count (owner). Two numbers kept: downtime from the first offline reading, and response time from the moment the technician set In process (owner).

### 3.2 Manual fault on an online screen
Blank display, bad picture, camera dead, wrong timer. Logged by the technician as today. It cannot close by itself; the technician presses Mark fixed (owner agreed). Counts in history and score like any fault.

### 3.3 Timer fault (screen still ON after 9:30 PM)
At 9:30 PM every active screen still online gets a quiet Timer fault ticket, assigned to the station technician, no night push (my call). It closes when the screen goes off, or at 7 AM with the note "never switched off". It carries no fault-time score because the screen did not fail (my call).

### 3.4 Photo requests and office work
Photo requests stay tickets (type photo_request), not faults: no fault time, no auto-close, own line in the report ("photos asked / delivered"). Delivery counts in the technician score (owner). Office work stays a Work task in My Work and is not in ticket numbers.

## 4. Data
- NEW table `ops_screen_faults`: id, screen_id, depot_id, ticket_id, kind (offline | camera | timer | manual), started_at, in_process_at, fixed_at, fixed_by, reason, downtime_minutes (7 AM-9 PM only), response_minutes, closed_by_system boolean. RLS: head / admin / co_owner read all; a technician reads rows for their depots; no client writes (SECURITY DEFINER functions only), REVOKE from anon.
- Per-screen view `ops_screen_fault_counts`: faults total, last 30 days, last fault time, repeats within 7 days.
- Engine change: extend `ops_reconcile_offline_tickets()` (single canonical file, edit in place) to open/close fault rows per screen, apply the 15-minute and 30-minute waits, drop the head-approval step and the "ticket from a previous day never auto-closes" rule of section 259 (owner), and add the 9:30 PM timer check as its own function called by the existing cron.
- Night rule: minutes outside 07:00-21:00 IST are never counted in downtime or response.

## 5. Report and score
- Daily fault report (new RPC like `ops_my_day_report` / `ops_head_day_report`): screens that went off, fixed, still pending, timer faults, average downtime, average response, photos asked / delivered, per technician block. Technician sees own on /ops-home and can share it to WhatsApp (existing share helper); owner and head see all on /ops-admin and /ops-command; an evening push with the headline numbers goes to owner and head (owner).
- Technician score, report only, NO effect on pay (pay stays on uptime) (owner):
  fixed / raised 40, average response speed 25 (under 2 working hours = full), repeat failures within 7 days 15 (fewer is better), photo requests delivered on time 20. Weights are my call.

## 6. UI
- /ops-tickets: Open list = one row per faulty screen, worst first, with age; group by station toggle kept; In process shows contact + Call + reason; Fixed shows downtime and response time.
- Screen detail (station board tile tap): "faulty N times" and the list of past faults.
- Owner page and /ops-dashboard: "Faults today" tile; the Live console rebuilt later in the same style.
- Style: existing lead-* tokens, Gujarati-first for the technician, Lucide icons, one yellow action per page.

## 7. Out of scope
Pay changes, new alert channels (WhatsApp 95 number still blocked at Meta, error 131042), per-ticket cost, the Windows app, sales/telecaller flows.

## 8. Build order and checks
1. SQL: table, view, engine functions, dry-run in a rolled-back transaction, then apply (shadow: engine must open the same stations as today's 14 auto tickets).
2. Report RPCs + score function.
3. Technician pages, then owner / head pages.
4. Guardian review on frozen files (App.jsx / V2AppShell if nav changes), build, push, live check as admin and as a technician.
5. Record in CLAUDE.md in the same commit.

## 9. Risks
- Flapping screens: mitigated by the 15 and 30 minute waits; tune after a week.
- A real outage closing too early if the CMS reports a stale "online": mitigate by requiring the last response time to be fresh.
- Existing 33 open tickets: new engine must adopt them, not duplicate them.
