
## 511.3 · Leads chart last date label no longer overlaps (26-10-2026)

LeadsCollectedChart: the always-shown last label now hides the previous stepped label when they would touch (25 Oct / 26 Oct overlapped ~5 px at 320-375 px).

## 512 · Tiny text sweep, remaining pages (26-10-2026)

454 inline fontSize 9/10/11 -> 12 across 99 jsx files (Master, Finance, Cockpit, Dashboards, Ops, Campaigns, TaPayouts, etc). PDFs untouched. Guardian PASS on frozen sales files; SalesDashboardDesktop won&paid column minWidth 100 + letter-spacing .04em for the larger label.

## 513 · Hero cards, admin batch 1 (26-10-2026)

V2Hero added to PendingApprovalsV2 (pending amount), CallLogsV2 (calls in range), ClientsV2 (won total). Skipped on purpose: pages that already carry their own hero/KPI block (Finance, Dashboard) and embedded People tabs. Rule: one hero per screen, only where the headline number is already loaded.

## 513.1 · Clients stat boxes wrap on phone (26-10-2026)

ClientsV2 stat strip: repeat(3,1fr) -> auto-fit minmax(min(150px,100%),1fr); the third box was cut off at 375 px.

## 514 · Staff can reopen their own finished work task (26-10-2026)

supabase_phase514_work_reopen_own.sql: work_move_part now lets the assignee move finished -> in_process (reopen clears finish time, cost, seconds; logged as 'reopened'). Back to 'assigned' stays head-only. WorkBoard.jsx gets a Reopen button on the person's own finished cards (phone has no drag). Owner must paste the SQL in Supabase; until then the button shows the old 'only the head' error.

## 515 · Team Work: Overdue only filter (26-10-2026)

TeamWorkV2 Tasks board gets an 'Overdue only (N)' toggle beside the person/client filters: shows open, non-postponed tasks past due date. Pure frontend, no SQL.

## 515.1 · Overdue tile in Team Work hero is tappable (26-10-2026)

HeroSegs entries accept optional [label, value, sub, onClick, active]; the Overdue tile toggles the same onlyLate filter as the button. Frontend only.

## 516 · Session wrap-up, 26-10-2026 (UI/UX audit + Work module)

State after this session (all pushed to `untitled-os`, last commit `a4b8506f` + this note):

- **Phase 514 SQL is APPLIED live** (run via `supabase db query --linked -f ...`, VERIFY returned `reopen_own_allowed = true`). The 514 note above that says "owner must paste the SQL" is now stale. Staff can reopen their OWN finished work task (finished -> in_process); back to 'assigned' stays head-only. Reopen button shows only on a finished card whose assignee is the logged-in user (Team Work as admin: own tasks only).
- **Phase 515 / 515.1**: Team Work Tasks board has an "Overdue only (N)" button and the hero Overdue tile is tappable (same `onlyLate` toggle). Verified live. View-only state, not saved.
- **Phase 509-513.1** (UI audit fixes): 12 px minimum text (CSS + 454 inline spots in 99 jsx files; PDFs deliberately untouched), Finance/Ops-head phone layout, 44 px tap targets, Leads head wrap + chart label thinning, hero cards on Pending Approvals / Call Logs / Clients, Clients stat strip auto-fit. Sales/TC "My Work" nav label + 10 work_members (Phase 510).
- **Phone-width testing method**: load static same-origin `/email/gsrtc-led.html`, replace body with 375 px iframes, unregister service workers + clear caches first (Chrome window can't go below ~606 px).
- **Corrections**: `/lead-dashboard` is NOT broken, just slow (downloads all ~11.8k leads in 1000-row chunks, 10-20 s). Fix only if the page is actually used.
- **Still open**: heroes on most other pages (only where a headline number already exists), real sales/telecaller phone check (Dhara), leaderboard captions at 360 px, tab-row swipe check, leftover hardcoded navy hex + radius scale (skipped on purpose).
- **Reviewed and skipped**: `Downloads/MAP2_20_agents` (20 n8n workflows from Kaamchor AI). Not a fit (Sheets-based, small-shop use cases, duplicates built-in features). Only idea worth keeping: Invoice Chaser as a Phase 2 feature built inside the app's payments data, with owner confirmation before any outward message.
- **Gotchas**: git push and `supabase db query` from the sandbox need `dangerouslyDisableSandbox`; the auto-mode classifier can block live DB writes until the user repeats an explicit go. Vercel deploy takes ~90 s; check the chunk hash change before judging a live result.

## 517 · My Work hours: app card now matches the shared report (26-10-2026)

MyWorkV2 `doneSecs` did not subtract `break_seconds` for finished sessions, while `runSecs`, the WhatsApp share text and the server reports (Phase 382) did. Result: in-app 'Hours today' ran longer than the shared Day Summary (Safika: 7h 50m vs 7h 33m = 17m away time). Fixed doneSecs. Frontend only; hours do not change pay.

## 518 · Day score in the Work evening report (26-10-2026)

MyWorkV2 EveningCard + WhatsApp Day Summary show 'Day score: X% (N of M finished on time)'. Counts tasks finished TODAY that have a due date; on time = finished before the due day, or on the due day at/before due_time (mirrors work_ontime_stats, so the two cannot disagree). No due date = not counted. Display only, never touches pay (pay rule stays monthly_score -> work_ontime_stats). Frontend only.

## 519 · Add-forgotten-time asks AM or PM (26-10-2026)

Root cause of wrong Clock-in (Piyush 02:10 am, 26 Oct): 'Add forgotten time' uses type=time; people typed meeting times (2:10 PM / 6:30 PM) without PM, head approved, and the 02:10 entry became the day's first clock-in. Found 8 such 'added_later' rows in 30 days (4 on 26 Oct: Rana, Piyush, Khushbu, Akshar at ~02:10; 4 on 22 Oct at ~06:15-06:30). MyWorkV2 submit now asks 'Is this AM or PM?' when start is 01:00-06:59 (Change to PM shifts start/end +12 h; Keep AM sends as typed). Existing bad rows are NOT auto-fixed (history, owner decision). Frontend only.

## 520 · Early-time guard for forgotten time (26-10-2026)

Three layers so 'PM typed as AM' cannot recur: (1) app asks AM/PM for starts before 7 AM (Phase 519); (2) `supabase_phase520_work_manual_time_early_guard.sql` makes work_add_manual_time REFUSE a start before 07:00 IST unless `p_early_ok=true` (sent only when the person taps Keep AM); old 5-arg function dropped so it cannot bypass; (3) Team Work approval card shows a red 'Starts at ... check it was not meant as PM' line. Frontend sends p_early_ok only when true, so the app works before and after the SQL. SQL STATUS: written, NOT yet applied (classifier blocked the live write; owner to approve or paste). Existing 8 bad rows untouched, awaiting owner choice.

## 521 · Code-review fixes for Phases 514-520 (26-10-2026)

SQL 520 wrapped in BEGIN/COMMIT (+ header note that p_early_ok is an accident guard, head approval stays the real control; STILL NOT APPLIED live). AM/PM box: dismissing no longer means AM (explicit 'Yes, it is AM' second step; entries that run past noon skip the question). Non-head reopen limited to 48 h after finish (WorkBoard button + MyWorkV2.onMove). Team Work Overdue tile/button count comes from the filtered board items. Day score labelled 'estimate' and uses hourCycle h23. Approval early-start warning uses new workUtils.istHourOf (h23). `.wk-hseg[role=button]:focus-visible` ring. Removed the truncated duplicate 513.1 fragment.

## 522 · Clock-in ignores early hand-added entries (26-10-2026)

MyWorkV2 `firstIn` and the shared Day Summary 'Clock in' skip `source='added_later'` entries that start before 07:00 IST (a PM typed as AM). Hours are unchanged. The 8 existing bad rows (22 and 26 Oct: Rana, Piyush, Khushbu, Akshar) are NOT edited: 6 of 8 would overlap time those people already have if shifted +12 h (double count), so a data fix is held for an owner choice (shift the 2 clean ones, decline or leave the 6).
