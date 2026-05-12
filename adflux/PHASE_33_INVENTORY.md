# Phase 33 SQL Inventory

**Generated:** 2026-05-13 (Sprint C of the May 13 audit plan).

Phase 33 ran from 11 May 2026 onwards across **23 SQL files** under
`supabase_phase33*.sql`. The May 13 audit flagged this as the worst
case of patch-chain accumulation in the codebase (CLAUDE.md §3 calls
this anti-pattern out by name). Squashing the files is unsafe — every
one has already been applied to staging Supabase and the dependency
graph between them is non-trivial. Instead this document records what
each file did, which ones are deprecated by later patches, and which
ones any future re-squash effort would need to be careful with.

The pattern is recoverable but the answer is **never run Phase 33 like
this again**. Phase 34 onwards must respect §3: one cohesive migration
per module, not a stream of fixes.

---

## File map

| File | Sub-phase | What it does | Notes |
|------|-----------|--------------|-------|
| `supabase_phase33b_message_templates.sql` | 33B | `message_templates` master table + 6 stage seeds. | Active master config. |
| `supabase_phase33d_lead_photos.sql` | 33D | `lead_photos` table + `lead-photos` storage bucket + OCR slots. | Active. PhotoCapture.jsx depends on it. |
| `supabase_phase33d3_lead_fields.sql` | 33D.3 | Adds `designation` + `website` columns to `leads`. | **Duplicates designation from Phase 26** — column adds are guarded by IF NOT EXISTS so re-running is safe, but the file should not have re-added the column. |
| `supabase_phase33d4_auto_lead_followup.sql` | 33D.4 | Extends `follow_ups` with `lead_id`, `follow_up_time`, `auto_generated`. Adds `trg_lead_auto_followup` so every new lead gets a tomorrow-10:00 follow-up. | Active. **Duplicates `lead_id` add from Phase 14 (quotes column)**, though here it's on `follow_ups`, not `quotes` — separate concern, not actually a duplicate. |
| `supabase_phase33d5_action_templates.sql` | 33D.5 | Post-action WhatsApp templates table. | Active. |
| `supabase_phase33d6_full_cadence.sql` | 33D.6 | Full follow-up cadence system — rules + scheduler. | Active. Cooperates with the 33T smart-task fix. |
| `supabase_phase33e_performance_score.sql` | 33E | Performance scoring + variable salary tables. | Active. |
| `supabase_phase33g_leaves_table.sql` | 33G.8 | Real `leaves` table replacing the prior placeholder. | Active. |
| `supabase_phase33g_payment_followups_on_won.sql` | 33G.7 | Auto-create payment collection follow-ups when a quote flips to Won. | Active. Reads `follow_ups` (set up by 33D.4). |
| `supabase_phase33g_score_ambiguity_fix.sql` | 33G.5 | Fixes "column reference user_id is ambiguous" in the score RPC. | **Hotfix for 33E** — patch chain marker. |
| `supabase_phase33h_ta_module.sql` | 33H | Travel Allowance (TA) auto-calculator + tables. | Active. |
| `supabase_phase33i_fixes.sql` | 33I | Fixes audit issues B4 + B5 surfaced after 33H ship. | **Hotfix** — patch chain marker. |
| `supabase_phase33j_fix.sql` | 33J fix | Removes a bogus `valid_until` reference from quote queries. | **Hotfix** — patch chain marker. Now caught at lint time by `scripts/check-sql-schema.sh` denylist. |
| `supabase_phase33j_hygiene.sql` | 33J hygiene | Misc hygiene — guard conditions, missing indexes. | **Hotfix** — patch chain marker. |
| `supabase_phase33l_history_workflow.sql` | 33L | Three pieces: history table + workflow + view changes. | Active. Mixed concerns — a Phase 34 redo would split this. |
| `supabase_phase33n_ref_number_fix.sql` | 33N fix 3 | Removes `ref_number` from payment-FU functions (column never existed). | **Hotfix** — denylist now blocks the original mistake. |
| `supabase_phase33n_smoke_tests.sql` | 33N | Smoke tests for the critical SQL surface area. | Active — runs at the bottom as a one-shot test. Useful pattern. |
| `supabase_phase33o_next_workday_overload.sql` | 33O | Fix the stage-change error owner caught on `/leads/:id`. | **Hotfix** for 33D.6 cadence logic. |
| `supabase_phase33q_rep_workflows.sql` | 33Q | Rep-side workflow RPCs (directives #5, #12, #13, #16). | Active. |
| `supabase_phase33r_push_subscriptions.sql` | 33R | Push notification subscriptions table. | Active. |
| `supabase_phase33t_smart_task_fix.sql` | 33T | Rewrites `generate_lead_tasks()` RPC. Broken since 33D.6. | **Hotfix** for 33D.6. **Phase 34 supersedes the SLA half** of this fix — see "Phase 34 supersession" below. |
| `supabase_phase33w_fix.sql` | 33W fix | Removes `ALTER DATABASE SET` which Supabase SQL editor can't run. | **Hotfix** — Supabase environment-specific. |
| `supabase_phase33w_push_triggers.sql` | 33W | Auto-fire push notifications on real events. | Active. Depends on 33R. |

---

## Hotfix density (the real problem)

Of the 23 files, **9 are explicit hotfixes** for an earlier 33-letter
file: 33G score-ambiguity-fix, 33I, 33J fix, 33J hygiene, 33N
ref-number-fix, 33O, 33T smart-task-fix, 33W fix. That's a 39 % churn
rate inside a single phase. CLAUDE.md §3 was added precisely because
of this pattern — the rule says future phases must be one cohesive
migration with a module-level acceptance criteria.

---

## Phase 34 supersession

The May 13 follow-up audit (`AUDIT_2026_05_05.md` notes + this file)
found that the SLA + follow-up logic from Phase 33 sub-phases is
structurally wrong in three places:

* `lead_set_handoff_sla()` checks `stage = 'SalesReady'`, removed in
  Phase 30A. The trigger body never executes.
* SLA arithmetic uses wall-clock UTC, ignoring IST and the
  `holidays` table.
* `lead_activities.next_action_date` never flows to `follow_ups`,
  so the date sits orphaned on activity rows.
* `leads.assigned_to` defaults to NULL with no round-robin filler.

`supabase_phase34_followup_consolidation.sql` (committed 2026-05-13)
supersedes the SLA path in Phase 33T and adds the missing
auto-assignment + activity-sync triggers. **Phase 33T stays in the
repo** — the smart-task RPC body it ships is still load-bearing for
`/work` task generation. Only the handoff-SLA function inside it is
now overridden by Phase 34.

---

## Squash policy

| Phase | Squash safe? | Reason |
|-------|--------------|--------|
| Phase 4 (a–f) | **Yes**, in a future cleanup. Foundation only; no production data risk. |
| Phase 11 (b–l) | Risky. RLS + storage policies depend on prior state. **Document, don't squash.** |
| Phase 33 (this file) | **No.** Hotfix interleaving + interdependent function bodies. **Document, don't squash.** |

A "fresh-setup.sql" that bundles the equivalent of phases 4 → 33
into one runnable file would have to be written from scratch, not
generated by `cat`. Out of scope for Sprint C; defer to a dedicated
fresh-install effort.

---

## Action items the inventory surfaces

1. The 9 hotfix files prove the patch-chain rule had to be written.
   Future work re-reads CLAUDE.md §3 before any new sub-letter.
2. `scripts/check-sql-schema.sh` now lints for the bug patterns
   that drove 33J fix + 33N fix (denylist on `valid_until`,
   `ref_number`, `recorded_by`, `next_follow_up_at`).
3. Phase 34 explicitly supersedes the SLA path of 33T. Any further
   SLA / handoff work edits `supabase_phase34_followup_consolidation.sql`,
   not a new sub-letter.
