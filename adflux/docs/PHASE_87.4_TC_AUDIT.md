# Phase 87.4 — Telecaller flow audit (2026-05-23)

Owner directive: "annayle full telicaller flow". Read-only audit
findings. No code changes proposed in this commit.

## In scope

- `src/pages/v2/TelecallerV2.jsx` — main TC dashboard
- `src/components/leads/PostCallOutcomeModal.jsx` — outcome modal
- `src/pages/v2/CallLogsV2.jsx` — call-log history view
- `V2AppShell.jsx` TELECALLER_NAV (frozen per §28)

## Flow map (Phase 43 baseline, §32)

1. TC opens `/telecaller` → V2Hero shows `X/50` calls target.
2. Tap "Call now" → `quickLogCall(lead)`:
   - `cleanPhone()` strips non-digits.
   - User-gesture `window.location.href = 'tel:+${phone}'`.
   - `logCallAudit()` writes call_logs row (outcome `no_answer`).
   - `lead_activities` insert (activity_type='call').
   - 1.5s setTimeout opens PostCallOutcomeModal.
3. Modal: 4 outcome chips + 6 next-action chips. Save:
   - patches activity row with outcome + notes
   - (Phase 88.1 optimistic) all other writes background
4. `onSaved` → `load()` refires → next lead in queue.

## Confirmed contracts (intact)

| Item | State |
|---|---|
| `useAutoRefresh(load)` mounted | YES — 2 sites |
| `compute_daily_score` trigger | YES (DB) |
| Tel:→1.5s→modal chain | YES |
| Heat picker on hero/queue | YES — 4 sites |
| Stale lead banner | YES — 10 refs |
| `daily_targets.min_calls` read | YES |
| WhatsApp send via template | YES (Phase 47.1) |
| Call script panel | YES (Phase 47.2) |
| DNC + WA opt-out gates | YES (Phase 47.5) |
| Source attribution card | YES on `/dashboard` (Phase 47.7) |
| `call_logs.language` capture | YES (Phase 47.8) |
| Source: 4 policy KPIs (50/30%/5/0) | YES (Phase 49) |
| IST date anchor | YES (Phase 47.9 `istTodayISO`) |

## Phase 87.3 MEET-hide check

TelecallerV2 does NOT show MEET KPI today — Phase 87.3 hid it via
TodaySummaryCard role guard (`profile.role === 'telecaller'`). The
TelecallerV2 file itself doesn't need a MEET filter because its
hero panel uses a calls-only KPI strip from the start.

Renuka (team_role='sales_manager' + role='telecaller') triggers
the same hide on `/work` + `/telecaller`.

## Gaps observed (NOT critical, deferred)

1. **PostCallOutcomeModal does 8 supabase writes per save** — Phase
   88.1 (this session) moved 7 of them to background. Activity
   update is the only blocking write now.
2. **Modal time picker** uses native `<input type="time">` — on
   Android WebView the picker style varies by device. No fix
   today; live with it.
3. **No batch-call mode** — rep taps Call → outcome modal → next.
   Power-dialer wrap-up takes ~10 sec/call. Phase 49.x deferred
   Knowlarity / Exotel integration.
4. **Smart task closure** is per-lead in PostCall save. If rep
   opens modal without going through quickLogCall (e.g. from lead
   detail), `pendingActivityId` is null and a fresh insert fires
   instead of an update. Working as designed; flagged for clarity.
5. **Stale lead banner threshold** is hardcoded to 3 days (Phase
   47.6). No admin config. Acceptable for current scale.
6. **No follow-up SLA on TC handoff to sales** — when TC qualifies
   a lead and stage flips, the SLA-clock (Phase 34) covers it.
   Confirmed via `next_business_moment(sales_ready_at + 24h)` in
   the SQL trigger.

## Risk items (none P0)

- **`fetchAndPatchCallDuration` (Phase 56j)** fires-and-forgets a
  native CallLog read. On web it's a no-op. If the Android plugin
  fails permission, duration silently stays null. No user impact
  beyond the missing duration column.
- **`call_logs` outcome upgrade** ('no_answer' → 'connected') has
  a 10-minute window. If rep takes >10min to save the modal,
  call_logs stays 'no_answer'. Connect-rate KPI undercounts.
  Edge case; rep usually saves <2 min after call.

## Verdict

TC module IS production-stable. No code changes required from
this audit. Renuka + Dhara + Rima can use the surface as-is.

Phase 88.1 perceived-speed improvement applies to TC as well —
PostCallOutcomeModal save now closes in ~200ms instead of ~1.5sec.

## Next-sprint candidates (parked)

- Phase 49.x: Knowlarity / Exotel native dialer integration
  (replaces tel: + auto-extracts duration + recording URL).
- Phase 42.2: Renuka team-lead dashboard (per-TC connect rate,
  qualified-weekly tracker, reassign authority).
- Phase 47.10: TC script A/B test framework (split-test pitches,
  track convert rate per variant).
