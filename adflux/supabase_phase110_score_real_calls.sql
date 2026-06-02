-- supabase_phase110_score_real_calls.sql
-- Phase 110 (#5) — a telecaller's daily SCORE counted EVERY 'call'
-- activity, including ones where the rep tapped Call but never dialed
-- (quickLogCall inserts a lead_activities 'call' row on tap, outcome=NULL,
-- with no qualifying call_logs row). That inflated the TC score → inflated
-- incentive.
--
-- Owner-confirmed rule (2026-06-02): a call counts toward the score ONLY
-- when it really happened —
--     (a) the rep saved an outcome   → lead_activities.outcome IS NOT NULL
--   OR (b) the call connected ≥10s   → a matching call_logs row,
--          duration_seconds >= 10, direction not 'missed'
-- (Same ≥10s rule the rep's own "calls today" already uses.)
--
-- ⚠ BASE = the LIVE Phase 97.2 body (supabase_phase97_2_rpc_role_gates.sql),
--   NOT phase52. Phase 97.2 added the F-102 security gate
--   `_assert_self_or_admin(p_user_id)` (a rep can't compute/read another
--   rep's score) + F-104 `SET search_path = public, pg_temp`. Both are
--   PRESERVED here. (A security audit caught an earlier draft that based
--   off phase52 and would have silently reverted those — do NOT reintroduce
--   that mistake; if compute_daily_score is ever re-derived, start from the
--   latest definition, not an older phase file.)
--
-- ONLY the telecaller branch (v_activity='call') is gated. The sales /
-- agency / staff branch (meetings) is byte-identical to phase97.2 —
-- untouched. Idempotent.
--
-- ⚠ INCENTIVE-AFFECTING. RUN THE READ-ONLY "BEFORE/AFTER" QUERY AT THE
--   BOTTOM FIRST. The function change only affects FUTURE recomputes
--   (trigger fires on new activity). To correct THIS MONTH's stored
--   scores, run the OPTIONAL backfill block at the very bottom AFTER
--   reviewing the before/after.

CREATE OR REPLACE FUNCTION public.compute_daily_score(p_user_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role       text;
  v_targets    jsonb;
  v_target     int;
  v_done       int;
  v_pct        numeric;
  v_excluded   boolean := false;
  v_reason     text    := NULL;
  v_off_day    boolean := false;
  v_dow        int;
  v_activity   text;
BEGIN
  -- Phase 97.2 F-102 — caller may only compute their own score (admin/
  -- co_owner exempt). PRESERVED.
  PERFORM public._assert_self_or_admin(p_user_id);

  v_dow := EXTRACT(ISODOW FROM p_date);

  IF v_dow = 7 THEN
    v_excluded := true;
    v_reason   := 'Sunday';
  END IF;

  IF NOT v_excluded AND EXISTS (
    SELECT 1 FROM holidays WHERE holiday_date = p_date AND is_active = true
  ) THEN
    v_excluded := true;
    SELECT name INTO v_reason FROM holidays
      WHERE holiday_date = p_date AND is_active = true LIMIT 1;
    v_reason := COALESCE('Holiday: ' || v_reason, 'Holiday');
  END IF;

  IF NOT v_excluded THEN
    SELECT COALESCE(is_off_day, false), COALESCE(off_reason, '')
      INTO v_off_day, v_reason
      FROM work_sessions
     WHERE user_id = p_user_id AND work_date = p_date;
    IF v_off_day THEN
      v_excluded := true;
      v_reason   := COALESCE(NULLIF(v_reason, ''), 'Approved leave');
    END IF;
  END IF;

  SELECT role, daily_targets
    INTO v_role, v_targets
    FROM users
   WHERE id = p_user_id;

  IF v_role = 'telecaller' THEN
    v_target   := COALESCE((v_targets->>'calls')::int, 50);
    v_activity := 'call';
  ELSE
    v_target   := COALESCE((v_targets->>'meetings')::int, 5);
    v_activity := 'meeting';
  END IF;

  -- Phase 110 (#5) — gate the CALL count so a tapped-but-not-dialed call
  -- never earns score. Meeting count (sales) keeps the original query.
  IF v_activity = 'call' THEN
    SELECT COUNT(*)
      INTO v_done
      FROM lead_activities la
     WHERE la.created_by    = p_user_id
       AND la.activity_type = 'call'
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_date
       AND (
         la.outcome IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM call_logs cl
            WHERE cl.user_id = p_user_id
              AND cl.lead_id = la.lead_id
              AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date = p_date
              AND cl.duration_seconds >= 10
              AND (cl.direction IS NULL OR cl.direction <> 'missed')
         )
       );
  ELSE
    SELECT COUNT(*)
      INTO v_done
      FROM lead_activities la
     WHERE la.created_by    = p_user_id
       AND la.activity_type = v_activity
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_date;
  END IF;

  IF v_target = 0 THEN
    v_pct := 100;
  ELSE
    v_pct := LEAST(100, (v_done::numeric / v_target::numeric) * 100);
  END IF;

  INSERT INTO daily_performance (
    user_id, work_date, meetings_done, meetings_target,
    score_pct, is_excluded, excluded_reason, calculated_at
  ) VALUES (
    p_user_id, p_date, v_done, v_target,
    v_pct, v_excluded, v_reason, now()
  )
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET meetings_done   = EXCLUDED.meetings_done,
        meetings_target = EXCLUDED.meetings_target,
        score_pct       = EXCLUDED.score_pct,
        is_excluded     = EXCLUDED.is_excluded,
        excluded_reason = EXCLUDED.excluded_reason,
        calculated_at   = now();
END $function$;

GRANT EXECUTE ON FUNCTION public.compute_daily_score(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY — all three must be true ─────────────────────────────────
SELECT
  (pg_get_functiondef('public.compute_daily_score(uuid,date)'::regprocedure)
     ILIKE '%_assert_self_or_admin%')                       AS security_gate_present, -- F-102 preserved
  (pg_get_functiondef('public.compute_daily_score(uuid,date)'::regprocedure)
     ILIKE '%call_logs%')                                   AS call_gate_present,     -- Phase 110 applied
  (pg_get_functiondef('public.compute_daily_score(uuid,date)'::regprocedure)
     ILIKE '%public, pg_temp%')                             AS pg_temp_hardening;     -- F-104 preserved


-- ════════════════════════════════════════════════════════════════════
-- BEFORE / AFTER — READ-ONLY. Run this to see, per telecaller for TODAY
-- (IST), the OLD call count (all 'call' activities) vs the NEW gated
-- count (real calls only). Zero writes.
-- ════════════════════════════════════════════════════════════════════
WITH d AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today
)
SELECT
  u.name,
  (SELECT COUNT(*) FROM lead_activities la, d
     WHERE la.created_by = u.id AND la.activity_type = 'call'
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.today)            AS old_calls,
  (SELECT COUNT(*) FROM lead_activities la, d
     WHERE la.created_by = u.id AND la.activity_type = 'call'
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.today
       AND ( la.outcome IS NOT NULL
          OR EXISTS (SELECT 1 FROM call_logs cl, d d2
                      WHERE cl.user_id = u.id AND cl.lead_id = la.lead_id
                        AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date = d2.today
                        AND cl.duration_seconds >= 10
                        AND (cl.direction IS NULL OR cl.direction <> 'missed')) )) AS new_calls
  FROM public.users u
 WHERE u.role = 'telecaller' AND u.is_active = true
 ORDER BY u.name;


-- ════════════════════════════════════════════════════════════════════
-- OPTIONAL BACKFILL — corrects THIS MONTH's stored scores. Run ONLY after
-- reviewing the before/after. Recomputes every (telecaller, day) from the
-- 1st of the current IST month to today. Uncomment to run.
-- ════════════════════════════════════════════════════════════════════
-- DO $$
-- DECLARE r record; d date;
--   m_start date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)::date;
--   m_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
-- BEGIN
--   FOR r IN SELECT id FROM public.users WHERE role = 'telecaller' LOOP
--     d := m_start;
--     WHILE d <= m_today LOOP
--       PERFORM public.compute_daily_score(r.id, d);
--       d := d + 1;
--     END LOOP;
--   END LOOP;
-- END $$;
