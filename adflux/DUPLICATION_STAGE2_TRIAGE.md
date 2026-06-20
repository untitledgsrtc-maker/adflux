# Stage 2 Triage — duplicated DB functions (analysis only, NO merges)

Created 2026-06-20. The map for Stage 2: collapse each duplicated Postgres function
to ONE canonical file. **Read CLAUDE.md §71 (NO NEW COPIES) before any merge.**

## Trust boundary (important)

- **RELIABLE here:** the count of real phase files per function (base snapshots
  `supabase_all_migrations.sql` + `supabase_schema.sql` excluded), and the risk score.
- **NOT auto-determined — decide by READING at merge time:**
  - *Which copy is live* — phase **numbering is not alphabetical** (`phase127` > `phase97_2`);
    a filename sort lies. Confirm against the live DB with
    `SELECT pg_get_functiondef('public.<fn>()'::regprocedure);`.
  - *Identical vs drifted* — a quick `md5` compare breaks across `$$` vs `$function$`
    dollar-quoting. Read the bodies.
  - *Dup vs OVERLOAD* — same name, different argument signature = two real functions.
    **Merging an overload creates a new bug.** Known/suspected so far:
    `next_workday` (`phase33o_next_workday_overload.sql`), `bump_daily_counter`. Verify
    signatures before touching any function.

## Per-function method (every single merge)

1. List the function's real files (script at bottom).
2. **Read each copy.** Identify the LIVE body (confirm via `pg_get_functiondef` on prod).
3. Is it an **overload** (different args)? → keep both, it is NOT a merge target.
4. Create `db/functions/<name>.sql` = the live body (one home).
5. Retire the old copies — mark each `-- SUPERSEDED by db/functions/<name>.sql (Phase NNN)`.
6. **Guardian audit.** For score-5 (money/security): **shadow-compare** new vs old on
   real data + **owner verifies the numbers** + one-command revert ready. Never mid-workday.
7. Add/confirm a tripwire monitor. Re-run `check-duplication.sh`.

## Order — risk-ascending, MONEY/SECURITY LAST

Do the low rows first to prove the method on things that can't hurt; never start with pay.

### Score 1–2 — helpers (safest, start here)
| Function | Real files | Note |
|---|---|---|
| `update_updated_at` | 2 | timestamp stamp — likely only in snapshots; may be 0 real dups, verify |
| `clients_touch_updated_at` | 2 | timestamp stamp |
| `validate_default_signer` | 2 | signer validation |
| `next_workday` | 2 | **OVERLOAD — do NOT merge**, two signatures |
| `shadow_score_compare` | 2 | audit util |

### Score 3 — display / push / counters
| Function | Files | | Function | Files |
|---|---|---|---|---|
| `lead_activity_bump_counter` | 5 | | `call_logs_dedupe_before_insert` ✓locked | 5 |
| `bump_meeting_counter` | 3 | | `bump_daily_counter` | 3 **OVERLOAD?** |
| `enqueue_push` | 3 | | `push_followup_due_reminders` | 3 |
| `tg_push_on_followup_due` | 3 | | `run_select` | 3 **security-sensitive (Co-Pilot SQL)** |
| `call_log_bump_counter` | 2 | | `tg_push_on_quote_won` | 2 |
| `tg_push_on_payment_approved` | 2 | | `tg_push_on_lead_task_insert` | 2 |
| `tg_push_on_lead_assign` | 2 | | `enqueue_attendance_reminder` | 2 |
| `tc_weekly_stats` | 2 | | `get_team_leaderboard` | 2 |
| `my_chase_counts` | 2 | | `score_history` | 2 |
| `todays_suggested_tasks` | 2 | | `regen_payment_fu_notes` | 2 |
| `dismiss_payment_notification` | 2 | | | |

### Score 4 — workflow / leads
| Function | Files | | Function | Files |
|---|---|---|---|---|
| `generate_lead_tasks` | 8 | | `campaign_conversation_ensure_lead` | 5 |
| `lead_activity_after_insert` | 5 | | `generate_quote_number` | 2 |
| `followup_after_done` ✓locked | 3 | | `tg_recompute_ta_on_ping` | 3 |
| `followup_block_on_lost_lead` ✓locked | 2 | | `auto_create_followup` | 2 |
| `lead_auto_create_followup` | 2 | | `lead_auto_assign` | 2 |
| `lead_stage_change_cadence` | 2 | | `cancel_lead_cadence` | 2 |
| `lead_pause_close_auto_followups` | 2 | | `trg_lead_close_followups_on_terminal` | 2 |
| `lead_set_handoff_sla` | 2 | | `lead_auto_heat_from_outcome` | 2 |
| `quote_before_insert_ensure_lead` | 2 | | `quote_after_delete_rollback_lead` | 2 |
| `quotes_no_delete_after_draft` | 2 | | `refresh_expired_quotes` | 2 |
| `record_checkin` | 2 | | `is_checked_in_today` | 2 |
| `auto_close_open_sessions` | 2 | | `consecutive_missed_days` | 2 |
| `tg_recompute_score_on_activity` | 2 | | `recompute_daily_meetings` | 2 |

### Score 5 — MONEY / SECURITY — LAST, shadow-compared, owner-verified
| Function | Files | | Function | Files |
|---|---|---|---|---|
| `compute_daily_score` | **10** | | `compute_monthly_salary` | **9** |
| `compute_daily_ta` | **7** | | `monthly_score` | 3 |
| `rebuild_monthly_sales` | 2 | | `_compute_monthly_salary_base` | 2 |
| `handle_payment_update` | 2 | | `handle_payment_delete` | 2 |
| `backfill_ta` | 2 | | `backfill_performance` | 2 |
| `auto_create_incentive_profile` | 2 | | `create_payment_collection_followups` | 2 |
| `approve_leave` | 2 | | `eligible_for_paid_leave` | 2 |
| `get_my_role` | 2 | | `is_sales_manager` | 2 |
| `admin_create_user` | 2 | | `submit_offer_acceptance` | 2 |
| `accept_user_profile` | 2 | | `unaccept_user_profile` | 2 |

## Reproduce the per-function file list (run any time)

```bash
SNAP="supabase_all_migrations\.sql|supabase_schema\.sql"
fn=compute_daily_score   # <- the function you're about to merge
grep -rlE "CREATE OR REPLACE FUNCTION (public\.)?${fn}\b" --include='*.sql' . \
  | grep -vE "$SNAP" | sort
```

Then READ each file, confirm the live body against prod, and follow the method above.
