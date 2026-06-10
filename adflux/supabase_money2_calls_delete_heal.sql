-- =====================================================================
-- MONEY TRUTH 2 — calls counter delete-heal (sibling of phase113_3)
-- 2026-06-10
--
-- THE GAP (flagged twice — 103.E.1 line 41 + 113.3): the daily_counters
-- .calls counter is bumped on INSERT (two paths, Phase 98.H) but NEVER
-- decremented on DELETE. Deleting a lead (cascade) or a call row leaves the
-- counter high for that day. Same bug class already healed for meetings
-- (103.E.1) + new_leads (113.3) — this is the third and last sibling.
--
-- THE TWO BUMP PATHS (Phase 98.H — the recompute mirrors BOTH exactly):
--   a. call_log_bump_counter — every call_logs INSERT, dated by IST
--      COALESCE(call_at, created_at).
--   b. lead_activity_bump_counter call branch — a lead_activities 'call'
--      row bumps ONLY when NO call_logs sibling exists within 5s for the
--      same (lead, user) — dated by IST created_at.
--
-- WHAT THIS DOES (same 3-part shape as 113.3, all idempotent):
--   1. recompute_daily_calls(user, date) — SETs calls to the TRUE count per
--      the two bump paths above. Can only make the counter match reality.
--   2. AFTER DELETE triggers on call_logs + on lead_activities('call') —
--      the counter self-heals on any deletion, forever.
--   3. One-time heal of the last 7 days' sessions.
--
-- WHAT THIS DOES NOT TOUCH:
--   - The INSERT bumps (call_log_bump_counter / lead_activity_bump_counter)
--     — byte-as-is. NO frozen function replaced.
--   - The score path (compute_daily_score) — counts live, unaffected.
--   - The meetings + new_leads heals — untouched siblings.
--
-- §45 — additive only. The new triggers fire ONLY on DELETE (rare admin
-- cleanup), never on the rep tap/save hot path.
-- =====================================================================

-- ── 1. Recompute helper (mirrors the two Phase 98.H bump paths) ──────
CREATE OR REPLACE FUNCTION public.recompute_daily_calls(p_user uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_from_logs int;
  v_orphan_acts int;
BEGIN
  -- Path a: call_logs rows, dated by IST COALESCE(call_at, created_at).
  SELECT count(*)
    INTO v_from_logs
    FROM public.call_logs cl
   WHERE cl.user_id = p_user
     AND (COALESCE(cl.call_at, cl.created_at) AT TIME ZONE 'Asia/Kolkata')::date = p_date;

  -- Path b: orphan 'call' activities (no call_logs sibling within 5s for
  -- the same lead + user), dated by IST created_at.
  SELECT count(*)
    INTO v_orphan_acts
    FROM public.lead_activities la
   WHERE la.created_by    = p_user
     AND la.activity_type = 'call'
     AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_date
     AND NOT EXISTS (
       SELECT 1 FROM public.call_logs cl
        WHERE cl.lead_id = la.lead_id
          AND cl.user_id = la.created_by
          AND abs(extract(epoch FROM (cl.created_at - la.created_at))) < 5
     );

  INSERT INTO public.work_sessions (user_id, work_date, daily_counters)
  VALUES (p_user, p_date, jsonb_build_object('calls', v_from_logs + v_orphan_acts))
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET daily_counters = jsonb_set(
          COALESCE(public.work_sessions.daily_counters, '{}'::jsonb),
          '{calls}',
          to_jsonb(v_from_logs + v_orphan_acts)
        );
END
$function$;

-- Internal helper only — keep it off the public RPC surface (mirror 113.3).
REVOKE EXECUTE ON FUNCTION public.recompute_daily_calls(uuid, date) FROM PUBLIC;

-- ── 2a. Self-heal on call_logs DELETE ────────────────────────────────
CREATE OR REPLACE FUNCTION public.call_log_calls_recount_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.user_id IS NOT NULL THEN
    PERFORM public.recompute_daily_calls(
      OLD.user_id,
      (COALESCE(OLD.call_at, OLD.created_at) AT TIME ZONE 'Asia/Kolkata')::date
    );
  END IF;
  RETURN OLD;
END
$function$;

DROP TRIGGER IF EXISTS trg_call_log_calls_recount_del ON public.call_logs;
CREATE TRIGGER trg_call_log_calls_recount_del
  AFTER DELETE ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.call_log_calls_recount_on_delete();

-- ── 2b. Self-heal on lead_activities('call') DELETE ──────────────────
CREATE OR REPLACE FUNCTION public.lead_activity_calls_recount_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.activity_type = 'call' AND OLD.created_by IS NOT NULL THEN
    PERFORM public.recompute_daily_calls(
      OLD.created_by,
      (OLD.created_at AT TIME ZONE 'Asia/Kolkata')::date
    );
  END IF;
  RETURN OLD;
END
$function$;

DROP TRIGGER IF EXISTS trg_lead_activity_calls_recount_del ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_calls_recount_del
  AFTER DELETE ON public.lead_activities
  FOR EACH ROW
  WHEN (OLD.activity_type = 'call')
  EXECUTE FUNCTION public.lead_activity_calls_recount_on_delete();

-- ── 3. One-time heal — last 7 days of sessions ──────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ws.user_id, ws.work_date
      FROM public.work_sessions ws
     WHERE ws.work_date >= ((now() AT TIME ZONE 'Asia/Kolkata')::date - 7)
  LOOP
    PERFORM public.recompute_daily_calls(r.user_id, r.work_date);
  END LOOP;
END $$;

-- self-register (tolerant if the register table isn't created yet)
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_money2_calls_delete_heal.sql', 'Money Truth - calls counter delete-heal')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'recompute_daily_calls')                 AS recompute_fn,   -- 1
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_call_log_calls_recount_del')      AS log_del_trg,    -- 1
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_lead_activity_calls_recount_del') AS act_del_trg;    -- 1

SELECT 'Money 2 calls delete-heal applied' AS status;
