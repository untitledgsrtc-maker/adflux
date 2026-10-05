-- =====================================================================
-- supabase_phase334_followup_owner_heal2.sql
-- Phase 334 — one-time heal #2: the 17 open AUTO follow-ups that the Phase 333 heal could not see.
--
-- Phase 333 fixed leads that are STILL telecaller-owned (assigned_to NULL). These 17 sit on leads that were
-- LATER reassigned to a sales rep, so they fell outside it: the follow-up was parked on the lead's creator
-- (or a rep who has since left) by the old created_by fallback, and the Phase 130 owner-change trigger only
-- moved rows held by the PREVIOUS owner, so reassigning never moved them. Result: Jani (11), Kirti (5),
-- Mayur (1) are missing follow-ups on their own leads, and Brijesh / two inactive reps hold ones they cannot read.
-- (The trigger is now fixed in db/functions/lead_owner_change_transfer_followups.sql — run THAT first.)
--
-- NOTE: Studio shows only the LAST result of a pasted file - to SEE the PART 1 preview first, run PART 1 (the first SELECT) on its own.
-- RUN ORDER: db/functions/lead_activity_aftermath.sql, lead_activity_sync_followup.sql,
--            lead_owner_change_transfer_followups.sql  ->  THIS FILE.
--
-- WHAT THIS DOES (open AUTO follow-ups on a lead whose holder is NOT the lead's owner of record; manual rows never touched):
--   PART 1b  backs every affected row up to _bak_followups_p334 (undo recipe below).
--   PART 2   CLOSES the overdue lead_intro / legacy 'Auto-scheduled:' rows (NOT rep-typed next-action rows, which re-point instead) (section 131 precedent: no respawn branch, no stage change,
--            no push), marker "[closed: auto - ... (Phase 334)]" = the section 175 system-close, not rep work.
--   PART 3   RE-POINTS everything else (future lead_intro rows, nurture, quote_chase) to the owner of record.
--            assigned_to-only update -> fires no trigger -> silent. Overdue nurture rows are NOT closed (closing a nurture row via
--            is_done respawns the cadence, sections 60/134) - they land on the real owner.
-- Idempotent: after the run no row matches the filter. Row updates only - safe any time of day.
-- =====================================================================

-- ===== PART 1 — PREVIEW (read-only) =====
SELECT coalesce(fu.cadence_type,'legacy(NULL)') AS cadence,
       CASE WHEN fu.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'overdue' ELSE 'today_or_future' END AS bucket,
       CASE WHEN fu.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
             AND (fu.cadence_type = 'lead_intro' OR (fu.cadence_type IS NULL AND fu.note LIKE 'Auto-scheduled:%')) THEN 'CLOSE' ELSE 'RE-POINT' END AS action,
       count(*) AS n
  FROM public.follow_ups fu JOIN public.leads l ON l.id = fu.lead_id
 WHERE fu.is_done = false AND fu.auto_generated = true
   AND COALESCE(l.assigned_to, l.telecaller_id) IS NOT NULL
   AND fu.assigned_to IS DISTINCT FROM COALESCE(l.assigned_to, l.telecaller_id)
 GROUP BY 1,2,3 ORDER BY 1,2;

-- ===== PART 1b — BACKUP =====
CREATE TABLE IF NOT EXISTS public._bak_followups_p334 AS
SELECT fu.id, fu.lead_id, fu.assigned_to AS old_assigned_to, fu.is_done AS old_is_done,
       fu.done_at AS old_done_at, fu.done_note AS old_done_note, fu.follow_up_date, fu.cadence_type,
       now() AS backed_up_at
  FROM public.follow_ups fu WHERE false;                     -- structure only, first run
-- APPENDS every run: rows already backed up are skipped, so a later re-run is also covered by the undo.
INSERT INTO public._bak_followups_p334
SELECT fu.id, fu.lead_id, fu.assigned_to, fu.is_done, fu.done_at, fu.done_note, fu.follow_up_date, fu.cadence_type, now()
  FROM public.follow_ups fu JOIN public.leads l ON l.id = fu.lead_id
 WHERE fu.is_done = false AND fu.auto_generated = true
   AND COALESCE(l.assigned_to, l.telecaller_id) IS NOT NULL
   AND fu.assigned_to IS DISTINCT FROM COALESCE(l.assigned_to, l.telecaller_id)
   AND NOT EXISTS (SELECT 1 FROM public._bak_followups_p334 b WHERE b.id = fu.id);
ALTER TABLE public._bak_followups_p334 ENABLE ROW LEVEL SECURITY;   -- no policy = admin SQL only
-- UNDO (only if ever needed). Restoring is_done=false fires tg_push_followup_due -> run it OUTSIDE 09:00-21:00 IST
-- or inside a transaction that first does  SET LOCAL session_replication_role = replica;  to avoid up to ~13 pushes:
--   UPDATE public.follow_ups f SET assigned_to=b.old_assigned_to, is_done=b.old_is_done,
--          done_at=b.old_done_at, done_note=b.old_done_note
--     FROM public._bak_followups_p334 b WHERE b.id = f.id;

-- ===== PART 2 — close the overdue lead_intro / legacy rows =====
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, '[closed: auto - cadence was on the wrong owner (Phase 334)]')
  FROM public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false AND fu.auto_generated = true
   AND COALESCE(l.assigned_to, l.telecaller_id) IS NOT NULL
   AND fu.assigned_to IS DISTINCT FROM COALESCE(l.assigned_to, l.telecaller_id)
   AND fu.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND (fu.cadence_type = 'lead_intro' OR (fu.cadence_type IS NULL AND fu.note LIKE 'Auto-scheduled:%'));

-- ===== PART 3 — re-point the rest to the owner of record =====
UPDATE public.follow_ups fu
   SET assigned_to = COALESCE(l.assigned_to, l.telecaller_id)
  FROM public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false AND fu.auto_generated = true
   AND COALESCE(l.assigned_to, l.telecaller_id) IS NOT NULL
   AND fu.assigned_to IS DISTINCT FROM COALESCE(l.assigned_to, l.telecaller_id);

NOTIFY pgrst, 'reload schema';

-- ===== VERIFY (expect 0 / 0 / 0) =====
SELECT
  (SELECT count(*) FROM public.follow_ups fu JOIN public.leads l ON l.id = fu.lead_id
    WHERE fu.is_done = false AND fu.auto_generated
      AND COALESCE(l.assigned_to, l.telecaller_id) IS NOT NULL
      AND fu.assigned_to IS DISTINCT FROM COALESCE(l.assigned_to, l.telecaller_id))      AS auto_rows_on_wrong_owner,   -- 0
  (SELECT count(*) FROM public.follow_ups fu JOIN public.users u ON u.id = fu.assigned_to
    WHERE fu.is_done = false AND fu.auto_generated AND fu.lead_id IS NOT NULL
      AND u.is_active = false)                                                          AS auto_lead_rows_on_inactive, -- 0
  (SELECT count(*) FROM public.leads
    WHERE assigned_to IS NOT NULL AND telecaller_id IS NOT NULL AND assigned_to <> telecaller_id) AS leads_both_owners_differ; -- 0
