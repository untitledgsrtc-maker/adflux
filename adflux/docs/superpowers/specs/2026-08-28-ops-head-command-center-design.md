# Operation-head command center — design

**Date:** 2026-08-28
**Owner ask:** finish the operation_head flow like a *manager's tool*, not a bigger tech app. "Think like you manage 10 OPEs." First cohesive piece (owner-picked): **a command-center HOME** that answers, at a glance — network health · my 10 techs (who's live + who's performing) · what needs me.

## Problem (honest gap)
The head can now SEE everything (network faults, tickets, uptime, console) but the flow isn't built to *manage people*: no per-tech scorecard to spot the slacker, no single home, and he lands on Down now (a raw fault list) instead of a cockpit. This closes the #1 gap.

## Scope — v1 (this build)
A new head landing page **`/ops-command` (OpsCommandV2)**, three stacked sections:

1. **Network health strip** — uptime % · screens down · stations affected · cameras off. Reads the existing `ops_admin_cockpit` RPC (`screens` + `tickets`). Off-hours aware (§250): "off for night" not red at night.
2. **Needs you** — a decision queue, worst-first:
   - **Unassigned faults** — active stations with offline screens but no tech assigned (`ops_depots.assigned_to IS NULL` + has offline `ops_screens`). Tap → `/ops-tickets?tab=open`.
   - **Overdue > 48h** — open `ops_tickets` with `opened_at < now()-48h`. Tap → `/ops-tickets?tab=proc`.
   - (Approvals row deferred — it needs the separate head-approval feature + RLS; not in v1.)
3. **My techs scorecard** — the heart. One row per `operation_executive`: name · uptime% (their stations, month) · fixes (month) · avg fix hrs · km. Sorted **worst-first** (lowest uptime), colour-coded (green ≥90 / amber ≥75 / red <75). Reads `ops_admin_cockpit.leaderboard`.
4. **Quick links** — Down now · Tickets · Live console · Station board (the head's existing surfaces).

Plus:
- **RootRedirect**: `operation_head` → `/ops-command` (was `/ops-down`).
- **OPS_HEAD_NAV**: add a "Command center" entry as the first item; keep the rest.

## Data
- `ops_admin_cockpit(days)` — already gated to `admin/co_owner/operation_head` (§233), SECURITY DEFINER, returns `screens`, `tickets`, `techs`, `leaderboard[]` (name/uptime_pct/tickets_closed/avg_fix_hours/km/attendance), `worst_stations[]`, `trend`. **No new SQL.**
- Two small head-readable client queries for "Needs you" (unassigned depots, overdue tickets) — §230 head FOR-ALL on ops tables covers them.

## Brand / UI (AdFlux design system — NOT the mockup's CDS tokens)
- Tokens from `tokens.css` §5: `--surface`/`-2`/`-3`, `--text`/`--text-muted`, `--danger`/`--success`/`--warning`/`--accent` (#FFE600), `-soft` tints. No raw hex.
- `lead-*` classes + the OpsAdminV2 idiom (§248). Numbers in `--font-display` (Space Grotesk) + `tabular-nums`. Lucide icons stroke 1.6. Gujarati-first labels via `opsStrings` (the head UI is English-leaning but keep the ops i18n).
- Touch targets ≥44px; colour never the only signal (icon + label + number); loading + empty + error states; mobile-first (the console is desktop-primary but the page must work at 375px).

## Frozen-file touches (additive, guardian required)
- `App.jsx` — lazy `OpsCommandV2` + `/ops-command` route under `RequireOps`; RootRedirect head → `/ops-command`.
- `V2AppShell.jsx` — one `OPS_HEAD_NAV` entry (Command center). No other nav array touched.
- OpsCommandV2 itself is a new (non-frozen) page.

## Not in v1 (follow-ups, flagged)
- **Head approves team TA/DA + leave** (the "approvals" row + a head-approval page + RLS). Owner picked command-center first; approvals is the next cohesive build.
- **Per-tech drill-down** (tap a tech → their day: stations/tickets/calls/GPS/attendance) — needs the tech `user_id` added to the cockpit leaderboard + a head-accessible per-tech view.
- **Team live-map hero** — the console already has the field-team map; a map hero on the command center is a later option.
- **Head pay model** (uptime vs flat) — money-fn change, §71 rule 3, separate sprint.

## Acceptance
As Dixita (operation_head): lands on `/ops-command` → health strip shows real network numbers · Needs-you shows real unassigned + overdue counts · scorecard lists the techs worst-first with colour-coded uptime · quick links navigate. Exec + admin unaffected. Guardian PASS on the frozen touches.
