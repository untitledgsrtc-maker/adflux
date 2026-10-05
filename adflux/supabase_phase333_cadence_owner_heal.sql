-- =====================================================================
-- supabase_phase333_cadence_owner_heal.sql
-- Phase 333 — one-time heal: auto follow-ups sitting with the lead's CREATOR instead of the
-- telecaller who owns the lead. (The cause is fixed in 4 canonical functions: lead_stage_change_cadence,
-- lead_auto_create_followup, followup_after_done, lead_pause_close_auto_followups — run those FIRST,
-- otherwise new bad rows keep appearing.)
--
-- THE BUG: a telecaller-owned lead has assigned_to NULL (owner in telecaller_id, section 99.C), and the
-- cadence engine resolved the owner as COALESCE(assigned_to, created_by) -> the ORIGINAL CREATOR got every
-- auto follow-up (Dhara after her lead was reassigned to Sneha; Brijesh for every Cronberry import he
-- assigned to a telecaller). Dhara saw "Unknown lead" cards and "Lead not found or RLS denied".
--
-- WHAT THIS DOES (open AUTO follow-ups only; manual follow-ups are never touched):
--   PART 2  CLOSE the OVERDUE lead_intro / legacy rows — nobody worked them and the real owner works
--           those leads through their own follow-ups; dumping a stale backlog on them is the section 131
--           mistake. Closed with a [closed: auto ...] note (the section 175 system-close marker, so
--           dashboards don't count it as rep work). lead_intro / legacy NULL cadence has no respawn
--           branch in followup_after_done (section 131 precedent) -> no stage change, no push.
--   PART 3  RE-POINT everything else (today / future rows, plus the few overdue nurture + quote_chase
--           rows) to the lead's real owner (telecaller_id). assigned_to only changes -> no trigger fires
--           (tg_push_followup_due watches follow_up_date / is_done) -> silent.
-- Idempotent: after the run no row matches the filters. RUN OFF-PEAK is not required (row updates only).
-- =====================================================================

-- ===== PART 1 — PREVIEW (read-only): what will be touched =====
SELECT coalesce(f.cadence_type,'legacy(NULL)') AS cadence,
       CASE WHEN f.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'overdue' ELSE 'today_or_future' END AS bucket,
       CASE WHEN f.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
             AND (f.cadence_type IS NULL OR f.cadence_type = 'lead_intro') THEN 'CLOSE' ELSE 'RE-POINT' END AS action,
       count(*) AS n
  FROM public.follow_ups f JOIN public.leads l ON l.id = f.lead_id
 WHERE f.is_done = false AND f.auto_generated = true
   AND l.assigned_to IS NULL AND l.telecaller_id IS NOT NULL
   AND f.assigned_to = l.created_by AND f.assigned_to <> l.telecaller_id
 GROUP BY 1,2,3 ORDER BY 1,2;

-- ===== PART 1b — BACKUP of every row this file may change (undo = recipe below) =====
-- First run captures the ORIGINAL state; a re-run skips (table exists) and finds nothing to change anyway.
CREATE TABLE IF NOT EXISTS public._bak_followups_p333 AS
SELECT f.id, f.lead_id, f.assigned_to AS old_assigned_to, f.is_done AS old_is_done,
       f.done_at AS old_done_at, f.done_note AS old_done_note, f.follow_up_date, f.cadence_type,
       now() AS backed_up_at
  FROM public.follow_ups f JOIN public.leads l ON l.id = f.lead_id
 WHERE f.is_done = false AND f.auto_generated = true
   AND l.assigned_to IS NULL AND l.telecaller_id IS NOT NULL
   AND f.assigned_to = l.created_by AND f.assigned_to <> l.telecaller_id;
ALTER TABLE public._bak_followups_p333 ENABLE ROW LEVEL SECURITY;   -- no policy = admin SQL only
-- UNDO (only if ever needed):
--   UPDATE public.follow_ups f SET assigned_to=b.old_assigned_to, is_done=b.old_is_done,
--          done_at=b.old_done_at, done_note=b.old_done_note
--     FROM public._bak_followups_p333 b WHERE b.id = f.id;

-- ===== PART 2 — close the overdue lead_intro / legacy rows =====
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, '[closed: auto - cadence was on the wrong owner (Phase 333)]')
  FROM public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false AND fu.auto_generated = true
   AND l.assigned_to IS NULL AND l.telecaller_id IS NOT NULL
   AND fu.assigned_to = l.created_by AND fu.assigned_to <> l.telecaller_id
   AND fu.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND (fu.cadence_type IS NULL OR fu.cadence_type = 'lead_intro');

-- ===== PART 3 — re-point the rest to the real owner =====
UPDATE public.follow_ups fu
   SET assigned_to = l.telecaller_id
  FROM public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false AND fu.auto_generated = true
   AND l.assigned_to IS NULL AND l.telecaller_id IS NOT NULL
   AND fu.assigned_to = l.created_by AND fu.assigned_to <> l.telecaller_id;

NOTIFY pgrst, 'reload schema';

-- ===== VERIFY (expect 0 / 0 / 0) =====
SELECT
  (SELECT count(*) FROM public.follow_ups f JOIN public.leads l ON l.id=f.lead_id
    WHERE f.is_done=false AND f.auto_generated AND l.assigned_to IS NULL AND l.telecaller_id IS NOT NULL
      AND f.assigned_to = l.created_by AND f.assigned_to <> l.telecaller_id)               AS still_on_wrong_owner,   -- 0
  (SELECT count(*) FROM public.follow_ups f JOIN public.leads l ON l.id=f.lead_id
    WHERE f.is_done=false AND f.assigned_to = '43f13bab-2fa2-4bc8-ad72-1610bc0c4402'
      AND coalesce(l.assigned_to, l.telecaller_id) IS DISTINCT FROM f.assigned_to)         AS dhara_unreadable_open,   -- 0
  -- owner order is assigned_to -> telecaller_id (engine) vs telecaller_id -> assigned_to (inbox, nurture revisit).
  -- Equal while no lead has BOTH set to different people. If this ever shows >0, the two orders disagree for those leads.
  (SELECT count(*) FROM public.leads
    WHERE assigned_to IS NOT NULL AND telecaller_id IS NOT NULL AND assigned_to <> telecaller_id) AS leads_both_owners_differ;  -- 0
