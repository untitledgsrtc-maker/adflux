-- ============================================================================
-- db/functions/recompute_daily_meetings.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place recompute_daily_meetings is allowed to live. EDIT THIS FILE
--    to change it; never re-paste it into a new phaseN file (§71).
--
-- WHAT IT DOES: the §33 DELETE-heal. When a meeting/site_visit lead_activity is
--    DELETED, the trigger trg_lead_activity_meeting_recount_del recomputes
--    work_sessions.daily_counters->'meetings' for that (user, day) FROM SCRATCH,
--    applying the SAME done-meeting exclusions as the insert-side counter. This
--    keeps the meeting KPI correct after deletions (the Phase 103.E.1 fix: the
--    insert bump never decremented on DELETE → drift).
--
-- ⚠ §33 LOCKSTEP PARTNER of db/functions/lead_activity_bump_counter.sql. The two
--    MUST carry the IDENTICAL exclusion set (auto-check-in + scheduled + dedup
--    by lead) or the counter and the recount disagree. With Phase 178 BOTH SQL
--    halves now live in db/functions/ (this file + lead_activity_bump_counter).
--    The THIRD surface — GpsTrackV2.jsx isScheduledMeetingRow + isAutoCheckinRow
--    — is frontend JS, still separate; keep all three in step (§33).
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 via
--    pg_get_functiondef. Single signature (uuid, date). The live body is the
--    phase103_e2 version (it has the 'Meeting scheduled%' skip); phase103_e1's
--    older body (delete-heal WITHOUT the scheduled skip) is superseded. Running
--    this file is a NO-OP. Verified to match the bump_counter exclusion set.
--
-- TRIGGER WIRING lives in supabase_phase103_e1_meeting_counter_delete_heal.sql
--    (the lead_activity_meeting_recount_del trigger fn + the
--    trg_lead_activity_meeting_recount_del trigger) — NOT here.
--
-- SUPERSEDES (Phase 178 removed the body from both; e1 keeps its trigger fn +
--    trigger):
--      supabase_phase103_e1_meeting_counter_delete_heal.sql
--      supabase_phase103_e2_exclude_scheduled_meetings.sql
--
-- LOCKED §33 CONTRACTS (a diff that removes any is a BLOCK):
--    • skip "I'm here · auto-check-in%" (companion rows)
--    • skip "Meeting scheduled%" (future appointments)
--    • count(DISTINCT COALESCE(lead_id, id)) — revisit = 1, walk-ins each 1
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_daily_meetings(p_user uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count int;
BEGIN
  SELECT count(DISTINCT COALESCE(lead_id::text, id::text)) INTO v_count
    FROM public.lead_activities
   WHERE created_by = p_user
     AND activity_type IN ('meeting', 'site_visit')
     AND created_at::date = p_date
     AND (notes IS NULL OR notes NOT LIKE 'I''m here · auto-check-in%')
     AND (notes IS NULL OR notes NOT LIKE 'Meeting scheduled%');
  INSERT INTO public.work_sessions (user_id, work_date, daily_counters)
  VALUES (p_user, p_date, jsonb_build_object('meetings', v_count))
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET daily_counters = jsonb_set(
      COALESCE(public.work_sessions.daily_counters, '{}'::jsonb),
      '{meetings}', to_jsonb(v_count));
END $function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All four must be TRUE.
-- A FALSE = an older copy was re-run and broke §33 lockstep → re-run this.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%auto-check-in%'                    AS p93_6_autocheckin_skip,
--   pg_get_functiondef(p.oid) LIKE '%Meeting scheduled%'                AS p103e2_scheduled_skip,
--   pg_get_functiondef(p.oid) LIKE '%count(DISTINCT COALESCE(lead_id%'  AS dedup_by_lead,
--   pg_get_functiondef(p.oid) LIKE '%work_sessions%'                    AS writes_counter
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'recompute_daily_meetings';
