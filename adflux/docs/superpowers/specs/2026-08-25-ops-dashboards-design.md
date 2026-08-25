# Operations dashboards — three surfaces (2026-08-25)

**Goal:** define + build what each Operations role sees. Additive; §45-safe.

## Architecture
- **admin** → NEW `/ops-admin` owner cockpit (trends · money · leaderboard · ticket-flow) + a "Live console →" link to the Head's page. The admin sidebar "Operations" entry points here.
- **Operation Head** → the built `/ops-dashboard` live console + 2 adds.
- **operation_executive** → the built `/ops` field app + 2 adds.

## A · admin `/ops-admin` (owner cockpit) — team-dashboard theme
1. **Uptime health + trend** — network uptime % today (live from `ops_screens`) + this-month avg (from `ops_uptime_daily`); a 30-day trend; worst stations (most offline).
2. **Money** (admin only) — per-tech: `monthly_salary` + uptime avg → indicative variable (SLA transform × 30% cap) + total payroll. Labelled "indicative — real pay = Salary sheet". Electricity/rent run-cost deferred (no feed).
3. **Team performance** — per-tech leaderboard: uptime held % · tickets closed (month) · avg time-to-fix · km · attendance days.
4. **Ticket flow** — open · faults this month · avg time-to-fix · photo-requests fulfilled + avg turnaround.

## B · Head `/ops-dashboard` — built console + 2 adds
- **Overdue-tickets band** at top (open > 48h).
- **Per-tech uptime %** on each tech card.

## C · exec `/ops` — built field app + 2 adds
- **"Your pay so far"** card (your month uptime % → indicative variable ₹). Shows "pay tracking starts once your manager turns it on" until Phase 4 active.
- **Navigate** button per station (Maps) + assigned-stations list.

## Data + build
- ONE aggregation RPC `ops_admin_cockpit(p_days)` — DEFINER, gated admin/co_owner/operation_head (fail-closed NULL); returns the operational jsonb. The **payroll** field is populated ONLY for admin (§153 — co_owner/Vishal must not see org-wide ops payroll).
- Server-side aggregation (§66 — never pull-and-count).
- Build order: RPC → `/ops-admin` → Head adds → exec adds → wire routes/nav.

## Honesty flags (in the UI)
1. Cockpit reads mostly zeros until real uptime + ticket history exist (aiadflux Phase 5 / Head records uptime + tickets accumulate).
2. Money = payroll only in v1 (run-cost has no feed).
3. Exec "your pay" needs Phase 4 activated (money-guarded, owner-run).
