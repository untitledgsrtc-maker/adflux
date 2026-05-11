-- =====================================================================
-- Phase 32N — Undo Phase 32M duplicate triggers.
-- 11 May 2026
--
-- Owner reported: "when login 1 meeting it showing 2 meeting count".
-- Counter screenshot showed Meetings=6 and New Leads=6 against an
-- activity timeline of 3 rows → exact 2x.
--
-- Root cause: Phase 12 (supabase_phase12_m1_m7_foundation.sql)
-- already shipped three counter triggers:
--   • trg_lead_activity_bump_counter  → bumps meetings + calls
--   • trg_call_log_bump_counter       → bumps calls (from call_logs)
--   • trg_lead_after_insert_bump_counter → bumps new_leads
--
-- I added Phase 32M triggers (trg_bump_meeting_counter, trg_bump_
-- call_counter, trg_bump_new_lead_counter) without grepping for the
-- existing ones. Both fire on every insert → 2x bump. CLAUDE.md §3
-- (module-not-patch) and §15 (pre-commit verification) violation
-- on my part — should have checked the foundation SQL first.
--
-- Fix:
--   1. DROP the three Phase 32M triggers + functions.
--   2. Halve today's work_sessions.daily_counters for any user whose
--      counters look doubled.
--
-- Idempotent: re-running is safe.
-- =====================================================================

-- ─── 1. Drop the Phase 32M triggers ─────────────────────────────────
DROP TRIGGER IF EXISTS trg_bump_meeting_counter  ON lead_activities;
DROP TRIGGER IF EXISTS trg_bump_call_counter     ON lead_activities;
DROP TRIGGER IF EXISTS trg_bump_new_lead_counter ON leads;

DROP FUNCTION IF EXISTS bump_meeting_counter()  CASCADE;
DROP FUNCTION IF EXISTS bump_call_counter()     CASCADE;
DROP FUNCTION IF EXISTS bump_new_lead_counter() CASCADE;

-- ─── 2. Halve today's doubled counters ──────────────────────────────
-- For every work_sessions row where work_date = today, halve the
-- meetings + calls + new_leads counts (rounded down). Owner's session
-- showed 6/0/6 → target 3/0/3. Floor division keeps it conservative —
-- if a counter was odd (e.g. 7), it becomes 3, slightly under-counting
-- rather than over. Reps logging more activities AFTER this SQL runs
-- will see the counter tick up correctly (only Phase 12 trigger fires).
--
-- Limited to today so we don't retroactively touch historical days
-- where the Phase 32M triggers might have run yesterday too.
-- (If yesterday's data also looks doubled, edit work_date = current_date - 1
-- and re-run this block.)

UPDATE work_sessions
   SET daily_counters = jsonb_build_object(
     'meetings',  GREATEST(0, FLOOR(COALESCE((daily_counters->>'meetings')::int,  0) / 2)),
     'calls',     GREATEST(0, FLOOR(COALESCE((daily_counters->>'calls')::int,     0) / 2)),
     'new_leads', GREATEST(0, FLOOR(COALESCE((daily_counters->>'new_leads')::int, 0) / 2))
   )
 WHERE work_date = CURRENT_DATE;

-- ─── 3. Re-load PostgREST schema ───────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ────────────────────────────────────────────────────────
-- Expected: trigger_count = 0 (Phase 32M triggers gone). Phase 12
-- triggers (trg_lead_activity_bump_counter etc.) stay in place and
-- are the single source of truth.
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('trg_bump_meeting_counter',
                     'trg_bump_call_counter',
                     'trg_bump_new_lead_counter')) AS phase_32m_trigger_count,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('trg_lead_activity_bump_counter',
                     'trg_lead_after_insert_bump_counter')) AS phase_12_trigger_count,
  (SELECT daily_counters FROM work_sessions
    WHERE work_date = CURRENT_DATE
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1) AS sample_counter_row;
