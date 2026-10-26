
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
