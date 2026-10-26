
## 511.3 · Leads chart last date label no longer overlaps (26-10-2026)

LeadsCollectedChart: the always-shown last label now hides the previous stepped label when they would touch (25 Oct / 26 Oct overlapped ~5 px at 320-375 px).

## 512 · Tiny text sweep, remaining pages (26-10-2026)

454 inline fontSize 9/10/11 -> 12 across 99 jsx files (Master, Finance, Cockpit, Dashboards, Ops, Campaigns, TaPayouts, etc). PDFs untouched. Guardian PASS on frozen sales files; SalesDashboardDesktop won&paid column minWidth 100 + letter-spacing .04em for the larger label.

## 513 · Hero cards, admin batch 1 (26-10-2026)

V2Hero added to PendingApprovalsV2 (pending amount), CallLogsV2 (calls in range), ClientsV2 (won total). Skipped on purpose: pages that already carry their own hero/KPI block (Finance, Dashboard) and embedded People tabs. Rule: one hero per screen, only where the headline number is already loaded.

## 513.1 · Clients stat boxes wrap on phone (26-10-2026)

ClientsV2 stat strip: repeat(3,1fr) -> auto-fit minmax(min(150px,100
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
