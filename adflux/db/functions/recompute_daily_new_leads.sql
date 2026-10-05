-- db/functions/recompute_daily_new_leads.sql  —  CANONICAL home (CLAUDE.md §72). Phase 330.
--
-- The delete-heal for the stored daily "new leads" counter (work_sessions.daily_counters.new_leads).
-- Fired by trg_lead_new_leads_recount_del (AFTER DELETE ON leads, Phase 113.3) via
-- lead_new_leads_recount_on_delete(), and by the 113.3 one-time heal.
--
-- Phase 330 change (the ONLY change vs the live body captured 2026-10-05 from supabase_phase113_3):
--   the recount now ignores self-imports, exactly like the insert-time trigger no longer
--   counts them (see lead_is_self_import.sql). WITHOUT this, deleting any lead on the day a
--   rep imported a file would recount ALL rows and silently put the imported leads back into
--   "Leads today" (guardian finding F3 / score-and-money recon).
--
-- Body is otherwise byte-identical to the live function (created_at::date UTC bucketing is a
-- known pre-existing quirk, left alone on purpose - §16).
--
-- REQUIRES lead_is_self_import(uuid,uuid,uuid,uuid)  -> run db/functions/lead_is_self_import.sql FIRST.

CREATE OR REPLACE FUNCTION public.recompute_daily_new_leads(p_user uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count int;
BEGIN
  SELECT count(*)
    INTO v_count
    FROM public.leads
   WHERE created_by      = p_user
     AND created_at::date = p_date
     AND NOT public.lead_is_self_import(import_id, created_by, assigned_to, telecaller_id);

  INSERT INTO public.work_sessions (user_id, work_date, daily_counters)
  VALUES (p_user, p_date, jsonb_build_object('new_leads', v_count))
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET daily_counters = jsonb_set(
          COALESCE(public.work_sessions.daily_counters, '{}'::jsonb),
          '{new_leads}',
          to_jsonb(v_count)
        );
END
$function$;

-- Phase 330 review: the old REVOKE FROM PUBLIC alone left anon/authenticated able to call this
-- SECURITY DEFINER fn through /rpc and overwrite any user's daily counter. The delete trigger
-- calls it through lead_new_leads_recount_on_delete (SECURITY DEFINER, owner postgres) so
-- nothing needs a client grant.
REVOKE EXECUTE ON FUNCTION public.recompute_daily_new_leads(uuid, date) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY / TRIPWIRE: must be TRUE (FALSE = an old copy of this function was re-run) ───
SELECT
  pg_get_functiondef(p.oid) LIKE '%lead_is_self_import%'            AS has_phase330_self_import_skip,
  pg_get_functiondef(p.oid) LIKE '%created_by      = p_user%'       AS keeps_creator_filter,
  p.prosecdef                                                       AS is_security_definer
FROM pg_proc p
WHERE p.proname = 'recompute_daily_new_leads'
  AND p.pronamespace = 'public'::regnamespace;
