-- =====================================================================
-- Phase 567 — stale callbacks: nightly clean-up + sales-head bulk close
-- =====================================================================
-- Owner (17 Nov 2026): "close older callback on new call" + a list for the
-- sales head (Devang) to work the old pile.
-- (1) close_followups_after_real_call(): NIGHTLY (23:00 IST) closes an open,
--     due/overdue follow-up when the SAME rep later made a REAL call on the
--     SAME lead: a call_logs row of >=10 s and not 'missed', or a call
--     activity that has an outcome. A tap with no dial never counts (Phase 110
--     rule). Runs by cron, NOT as a trigger on lead_activities, so the hot
--     save path and the frozen follow-up chain (section 28) are untouched.
--     The last quote-chase step (quote_chase seq 8) is skipped: closing it moves
--     the lead to Nurture via trg_followup_after_done, and a clean-up must not
--     change lead stages. Closing a nurture check-in spawns the next 30-day one,
--     same as when a rep completes it.
--     done_note carries 'Auto-closed' so isSystemClose() treats it as a system
--     close (it never counts as the rep's done work).
-- (2) manager_close_followups(uuid[]): a sales manager closes open callbacks of
--     reps assigned to him (users.manager_id), PRIVATE leads only, same
--     'Auto-closed' marker.
-- Idempotent. Rollback: SELECT cron.unschedule('close-followups-after-call');
-- and DROP both functions.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.close_followups_after_real_call()
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_n integer;
BEGIN
  WITH c AS (
    UPDATE public.follow_ups f
       SET is_done = true,
           done_at = now(),
           done_note = 'Auto-closed: rep called this lead again (Phase 567)'
     WHERE f.is_done = false
       AND f.lead_id IS NOT NULL
       AND f.assigned_to IS NOT NULL
       AND NOT (f.cadence_type = 'quote_chase' AND f.sequence = 8)  -- closing the last chase would move the lead to Nurture (trg_followup_after_done); a clean-up must not change stages
       AND f.follow_up_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND (
         EXISTS (SELECT 1 FROM public.call_logs cl
                  WHERE cl.lead_id = f.lead_id AND cl.user_id = f.assigned_to
                    AND COALESCE(cl.call_at, cl.created_at) > f.created_at
                    AND cl.duration_seconds >= 10
                    AND COALESCE(cl.direction, '') <> 'missed')
         OR EXISTS (SELECT 1 FROM public.lead_activities la
                     WHERE la.lead_id = f.lead_id AND la.created_by = f.assigned_to
                       AND la.activity_type = 'call' AND la.outcome IS NOT NULL
                       AND la.created_at > f.created_at)
       )
    RETURNING 1)
  SELECT count(*) INTO v_n FROM c;
  RETURN v_n;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.close_followups_after_real_call() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.manager_close_followups(p_ids uuid[])
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_sales_manager(), false) THEN
    RAISE EXCEPTION 'sales manager only' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) > 500 THEN
    RETURN 0;
  END IF;
  WITH c AS (
    UPDATE public.follow_ups f
       SET is_done = true,
           done_at = now(),
           done_note = 'Auto-closed: closed in bulk by sales head (Phase 567)'
     WHERE f.id = ANY (p_ids)
       AND f.is_done = false
       AND NOT (f.cadence_type = 'quote_chase' AND f.sequence = 8)  -- same stage-change guard as the nightly clean-up
       AND f.follow_up_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND f.assigned_to IN (SELECT u.id FROM public.users u WHERE u.manager_id = auth.uid())
       AND (f.lead_id IS NULL OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = f.lead_id AND l.segment = 'PRIVATE'))
    RETURNING 1)
  SELECT count(*) INTO v_n FROM c;
  RETURN v_n;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.manager_close_followups(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.manager_close_followups(uuid[]) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'close-followups-after-call') THEN
    PERFORM cron.unschedule('close-followups-after-call');
  END IF;
  PERFORM cron.schedule('close-followups-after-call', '30 17 * * *', 'SELECT public.close_followups_after_real_call();');
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: 1 cron job; cleanup not callable by logged-in users; manager RPC callable by authenticated only.
SELECT
  (SELECT count(*) FROM cron.job WHERE jobname = 'close-followups-after-call') AS cron_job,
  has_function_privilege('authenticated', 'public.close_followups_after_real_call()', 'execute') AS cleanup_auth_exec,
  has_function_privilege('anon', 'public.manager_close_followups(uuid[])', 'execute') AS mgr_anon_exec,
  has_function_privilege('authenticated', 'public.manager_close_followups(uuid[])', 'execute') AS mgr_auth_exec;
