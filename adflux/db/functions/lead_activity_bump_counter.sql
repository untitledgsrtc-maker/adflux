-- ============================================================================
-- db/functions/lead_activity_bump_counter.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place lead_activity_bump_counter is allowed to live. EDIT THIS FILE
--    to change it; never re-paste it into a new phaseN file (§71). It lived in
--    5 files (phase12, 93.7.1, 98.h, 103.e2, 127) — the WORST kind of sprawl,
--    because this is the meeting-KPI counter the owner has been burned by ~3×
--    (§33). Every new way to write a non-done meeting row re-inflated it until
--    excluded; each re-paste risked dropping an exclusion.
--
-- WHAT IT DOES: AFTER-INSERT trigger on lead_activities → bumps
--    daily_counters (meetings / calls). The "done meeting" definition + its
--    exclusions are a FROZEN §33 contract. NOT money directly, but the counter
--    feeds dashboards + the evening report → guardian before ANY change.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 via
--    pg_get_functiondef. Single signature (trigger fn). Running this file is a
--    NO-OP. The live body is the PHASE 127 SUPERSET — it kept phase103_e2's
--    scheduled-meeting skip AND added the Phase 127 prior-must-be-done refinement.
--    So §33's "canonical = phase103_e2" note is SUPERSEDED by this file
--    (phase127 ran later and is a strict superset; verified by the dump).
--
-- ⚠ §33 THREE-SURFACE LOCKSTEP — the meeting exclusions below MUST stay
--    byte-identical across THREE places. Change one → change ALL THREE:
--      1. this insert trigger (lead_activity_bump_counter)
--      2. recompute_daily_meetings()  — the DELETE-heal (still in
--         supabase_phase103_e2_*.sql; its own consolidation is pending)
--      3. GpsTrackV2.jsx  — isScheduledMeetingRow + isAutoCheckinRow (frontend)
--
-- TRIGGER WIRING lives in supabase_phase12_m1_m7_foundation.sql
--    (trg_lead_activity_bump_counter) — NOT here. This canonical owns the body.
--
-- SUPERSEDES (Phase 178 removed the body from each; triggers / siblings /
--    recompute_daily_meetings stay):
--      supabase_phase12_m1_m7_foundation.sql           (keeps 7 fns + 6 triggers)
--      supabase_phase93_7_1_counter_dedup.sql
--      supabase_phase98_h_calls_counter_repair.sql     (real fn + stale rollback comment)
--      supabase_phase103_e2_exclude_scheduled_meetings.sql (keeps recompute_daily_meetings)
--      supabase_phase127_meeting_revisit_dedup_fix.sql
--
-- LOCKED §33 CONTRACTS in the body (a diff that removes any is a BLOCK):
--    • Phase 93.6   — skip "I'm here · auto-check-in%" companion rows.
--    • Phase 103.E.2 — skip "Meeting scheduled%" future appointments.
--    • Phase 93.7   — revisit dedup: same lead, same day = 1 meeting
--                     (walk-ins lead_id IS NULL always bump).
--    • Phase 127    — the "prior visit" that makes THIS a revisit must itself
--                     be a DONE meeting (exclude bookings + auto-checkins from
--                     the prior-count, else a 10:48 booking eats the 13:00 real
--                     meeting — the kirti 0-bug).
--    • Phase 98.H   — calls branch: a call activity within 5s of a call_logs
--                     row is the same event → bump once.
--    NEW-MEETING RULE (§33): any new feature writing activity_type meeting/
--    site_visit for a NON-done purpose MUST add a notes-prefix exclusion HERE
--    and in the two lockstep surfaces above, same commit.
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_activity_bump_counter()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_already_today int;
  v_sibling_call  int;
BEGIN
  -- ── Calls branch (Phase 98.H) — byte-identical ──
  IF NEW.activity_type = 'call' THEN
    SELECT count(*)
      INTO v_sibling_call
      FROM public.call_logs cl
     WHERE cl.lead_id = NEW.lead_id
       AND cl.user_id = NEW.created_by
       AND abs(extract(epoch FROM (cl.created_at - NEW.created_at))) < 5;

    IF v_sibling_call = 0 THEN
      PERFORM public.bump_daily_counter(
        NEW.created_by,
        'calls',
        1,
        (COALESCE(NEW.created_at, now())
           AT TIME ZONE 'Asia/Kolkata')::date
      );
    END IF;
    RETURN NEW;
  END IF;

  -- ── Meeting / site_visit branch ──
  IF NEW.activity_type IN ('meeting', 'site_visit') THEN
    -- Phase 93.6 — skip "I'm here · auto-check-in" companion rows.
    IF NEW.notes IS NOT NULL
       AND NEW.notes LIKE 'I''m here · auto-check-in%' THEN
      RETURN NEW;
    END IF;

    -- Phase 103.E.2 — skip SCHEDULED FUTURE meetings. PostCallOutcomeModal
    -- logs "Meeting scheduled · <date>" as activity_type='meeting'; it is
    -- an appointment, not a done meeting, so it must not bump the KPI.
    IF NEW.notes IS NOT NULL
       AND NEW.notes LIKE 'Meeting scheduled%' THEN
      RETURN NEW;
    END IF;

    -- Phase 93.7 — revisit detection. Walk-ins (lead_id IS NULL) always
    -- bump (can't be dedupe'd).
    IF NEW.lead_id IS NOT NULL THEN
      SELECT count(*)
        INTO v_already_today
        FROM public.lead_activities prev
       WHERE prev.created_by      = NEW.created_by
         AND prev.lead_id         = NEW.lead_id
         AND prev.activity_type   IN ('meeting', 'site_visit')
         AND prev.created_at::date = NEW.created_at::date
         AND prev.id              <> NEW.id
         -- Phase 127 — a "prior visit" that makes THIS row a revisit must
         -- itself be a DONE meeting. A booking ("Meeting scheduled%") or
         -- an auto-check-in companion is NOT a done meeting, so it must
         -- not suppress a real meeting (the kirti 0-bug: a 10:48 booking
         -- ate the 13:00 real meeting's bump). Exclude BOTH.
         AND (prev.notes IS NULL
              OR (prev.notes NOT LIKE 'I''m here · auto-check-in%'
                  AND prev.notes NOT LIKE 'Meeting scheduled%'));

      IF v_already_today > 0 THEN
        RETURN NEW;
      END IF;
    END IF;

    PERFORM public.bump_daily_counter(NEW.created_by, 'meetings', 1);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- A FALSE = an older copy was re-run and stripped a §33 exclusion → re-run this.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%auto-check-in%'              AS p93_6_autocheckin_skip,
--   pg_get_functiondef(p.oid) LIKE '%Meeting scheduled%'          AS p103e2_scheduled_skip,
--   pg_get_functiondef(p.oid) LIKE '%v_already_today%'            AS p93_7_revisit_dedup,
--   pg_get_functiondef(p.oid) LIKE '%prev.notes NOT LIKE%'        AS p127_prior_must_be_done,
--   pg_get_functiondef(p.oid) LIKE '%bump_daily_counter%'         AS bumps_counter,
--   pg_get_functiondef(p.oid) LIKE '%< 5%'                        AS p98h_call_sibling_dedup
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'lead_activity_bump_counter';
