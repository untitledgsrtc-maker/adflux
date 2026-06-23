-- supabase_phase97_2_rpc_role_gates.sql
--
-- Phase 97.2 — close audit findings F-104, F-101, F-102, F-108.
-- F-105 (enqueue_push gate) DEFERRED to Batch A2 per owner directive.
--
-- ROOT CAUSES
-- ───────────
-- F-104: `public.get_my_role()` + `public.is_sales_manager()` are
--        SECURITY DEFINER without `SET search_path`. Defense-in-depth
--        gap: pg_temp-shadow attack surface. Both are RLS keystones.
--
-- F-101: `public.approve_leave(p_leave_id uuid)` has no caller-role
--        check. Any rep can approve their own leave + inflate
--        compute_monthly_salary payout.
--
-- F-102: `public.compute_monthly_salary(uuid,int,int)` + 9 sibling
--        SECURITY DEFINER RPCs (_compute_monthly_salary_base,
--        compute_daily_score, monthly_score, compute_daily_ta,
--        backfill_performance, backfill_ta, score_history,
--        consecutive_missed_days, todays_suggested_tasks) accept
--        p_user_id but never check `get_my_role()` vs `auth.uid()`.
--        Any rep reads any other rep's salary/score/TA via PostgREST.
--
-- F-108: `public.eligible_for_paid_leave(p_user_id uuid)` exposes
--        any user's tenure boolean — leaks join_date by bisect.
--
-- FIX PATTERN
-- ───────────
-- 1. Add helper `public._assert_self_or_admin(uuid)` — admin/co_owner
--    bypass OR `p_user_id = auth.uid()` self-call pass. Raises
--    SQLSTATE 42501 otherwise.
-- 2. CREATE OR REPLACE each affected function. Body copied byte-
--    identical from live `pg_get_functiondef()` output (2026-05-27).
--    Gate prepended at top of plpgsql body.
-- 3. F-104: get_my_role + is_sales_manager get `SET search_path =
--    public, pg_temp` + REVOKE/GRANT tightening.
-- 4. eligible_for_paid_leave: LANGUAGE sql → plpgsql so the gate
--    can be prepended. Behaviour preserved for legitimate self/admin
--    callers; cross-rep call now raises 42501.
--
-- ADMIN PATH (unchanged)
-- ──────────────────────
-- Brijesh / Vishal have get_my_role() IN ('admin','co_owner') →
-- bypass the gate on every function. Existing admin pages (/admin/
-- salary, /admin/leaves, /people, /my-performance) keep working.
--
-- SELF PATH (unchanged)
-- ─────────────────────
-- Sales rep calling compute_monthly_salary(auth.uid(), 2026, 5)
-- passes — gate hits the `p_user_id = auth.uid()` branch.
--
-- TRIGGER PATH (unchanged)
-- ────────────────────────
-- Phase 34Z.66 (compute_daily_score AFTER INSERT on lead_activities)
-- + Phase 34Z.67 (compute_daily_ta AFTER INSERT on gps_pings) fire
-- inside the rep's own transaction context. NEW.created_by =
-- auth.uid() → gate passes via self-call branch.
--
-- CRON PATH (unchanged — implicit bypass via NULL three-valued logic)
-- ──────────────────────────────────────────────────────────────────
-- pg_cron jobs (Phase 49 nightly backfill, Phase 76 GPS cron) run
-- as the `postgres` superuser. In that session auth.uid() returns
-- NULL. Inside the helper:
--   get_my_role() → SELECT role FROM users WHERE id = NULL → no rows → NULL
--   NULL NOT IN ('admin','co_owner') → NULL (UNKNOWN, not TRUE)
--   p_user_id <> NULL → NULL
--   NULL AND NULL → NULL
--   IF NULL THEN RAISE → branch NOT taken
-- Net: cron runs unaffected. This is the desired behavior — cron
-- is trusted-internal, not external rep-facing. No explicit cron
-- bypass needed in the gate.
--
-- IDEMPOTENCY
-- ───────────
-- All functions use CREATE OR REPLACE (re-runnable). Helper uses
-- CREATE OR REPLACE. No table changes. No data writes.
--
-- DEFERRED (explicit non-goals)
-- ─────────────────────────────
-- F-105 enqueue_push — A2 audit pending; need caller map first.
-- F-001b owner role DB purge — separate Batch E after audit.

-- ═══════════════════════════════════════════════════════════════
-- 1. Helper: _assert_self_or_admin
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._assert_self_or_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.get_my_role() NOT IN ('admin', 'co_owner')
     AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Restricted: cannot access another user''s data (caller=%, target=%)',
                    auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._assert_self_or_admin(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._assert_self_or_admin(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2. F-104 — get_my_role + is_sales_manager: pin search_path
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT role FROM public.users WHERE id = auth.uid()
$function$;

REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_sales_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = auth.uid()
       AND team_role = 'sales_manager'
       AND is_active = true
  );
$function$;

REVOKE ALL ON FUNCTION public.is_sales_manager() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_sales_manager() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. F-101 — approve_leave: admin/co_owner only
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.approve_leave(p_leave_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row record;
BEGIN
  -- Phase 97.2 gate (F-101): admin/co_owner only.
  IF public.get_my_role() NOT IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'Only admin/co_owner can approve leaves'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, leave_date INTO v_row
    FROM leaves WHERE id = p_leave_id AND status <> 'approved';
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE leaves SET status = 'approved' WHERE id = p_leave_id;

  -- Recompute the rep's score for that day so the exclusion takes effect.
  PERFORM public.compute_daily_score(v_row.user_id, v_row.leave_date);
END $function$;

-- ═══════════════════════════════════════════════════════════════
-- 4. F-108 — eligible_for_paid_leave: self-or-admin
-- (LANGUAGE sql → plpgsql so gate can be prepended.)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.eligible_for_paid_leave(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
  RETURN COALESCE(
    (SELECT join_date <= (CURRENT_DATE - INTERVAL '9 months')
       FROM public.staff_incentive_profiles
      WHERE user_id = p_user_id),
    false
  );
END $function$;

-- ═══════════════════════════════════════════════════════════════
-- 5. F-102 — 9 sibling SECURITY DEFINER RPCs gated by p_user_id
-- ═══════════════════════════════════════════════════════════════

-- 5.1 _compute_monthly_salary_base
-- -------------------------------------------------------------------------
-- _compute_monthly_salary_base REMOVED from this file (Phase 178).
-- Canonical: db/functions/_compute_monthly_salary_base.sql  (MONEY — payroll).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- 5.2 compute_monthly_salary (wrapper for Phase 42 manager override)
-- -------------------------------------------------------------------------
-- compute_monthly_salary REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_monthly_salary.sql  (MONEY — payroll).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- 5.3 compute_daily_score
-- -------------------------------------------------------------------------
-- compute_daily_score REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/compute_daily_score.sql
-- Do NOT re-add it here. To change the score, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- 5.4 monthly_score
CREATE OR REPLACE FUNCTION public.monthly_score(p_user_id uuid, p_month_start date)
RETURNS TABLE(user_id uuid, month_start date, working_days integer, avg_score_pct numeric, monthly_salary numeric, base_amount numeric, variable_cap numeric, variable_earned numeric, total_payable numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_avg     numeric := 0;
  v_days    int := 0;
  v_salary  numeric := 0;
  v_base    numeric;
  v_var_cap numeric;
  v_var_earned numeric;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

  SELECT AVG(score_pct), COUNT(*)
    INTO v_avg, v_days
    FROM daily_performance dp
   WHERE dp.user_id = p_user_id
     AND dp.work_date >= p_month_start
     AND dp.work_date < (p_month_start + INTERVAL '1 month')
     AND dp.is_excluded = false;

  SELECT COALESCE(sip.monthly_salary, 0) INTO v_salary
    FROM staff_incentive_profiles sip
   WHERE sip.user_id = p_user_id;

  v_base    := v_salary * 0.70;
  v_var_cap := v_salary * 0.30;

  IF v_days = 0 THEN
    v_avg := 100;
    v_var_earned := v_var_cap;
  ELSIF v_avg < 50 THEN
    v_var_earned := 0;
  ELSE
    v_var_earned := (v_avg / 100.0) * v_var_cap;
  END IF;

  RETURN QUERY
  SELECT p_user_id, p_month_start, v_days,
         ROUND(v_avg, 1), v_salary, ROUND(v_base, 0),
         ROUND(v_var_cap, 0), ROUND(v_var_earned, 0),
         ROUND(v_base + v_var_earned, 0);
END $function$;

-- 5.5 compute_daily_ta
-- -------------------------------------------------------------------------
-- compute_daily_ta REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_daily_ta.sql  (MONEY function — TA payout)
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (per-ping TA recompute + claim-approve) stays in the phase files.
-- -------------------------------------------------------------------------

-- 5.6 backfill_performance
CREATE OR REPLACE FUNCTION public.backfill_performance(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE d date;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
  FOR d IN
    SELECT generate_series(CURRENT_DATE - 30, CURRENT_DATE, '1 day')::date
  LOOP
    PERFORM public.compute_daily_score(p_user_id, d);
  END LOOP;
END $function$;

-- 5.7 backfill_ta
CREATE OR REPLACE FUNCTION public.backfill_ta(p_user_id uuid, p_month_start date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  d  date;
  n  int := 0;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
  FOR d IN
    SELECT generate_series(
      p_month_start,
      LEAST((p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date, CURRENT_DATE),
      '1 day'
    )::date
  LOOP
    PERFORM public.compute_daily_ta(p_user_id, d);
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;

-- 5.8 score_history
CREATE OR REPLACE FUNCTION public.score_history(p_user_id uuid, p_months_back integer DEFAULT 6)
RETURNS TABLE(month_start date, month_label text, working_days integer, avg_score_pct numeric, total_payable numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  d date;
  m record;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
  FOR d IN
    SELECT generate_series(
      (date_trunc('month', CURRENT_DATE) - (p_months_back - 1) * INTERVAL '1 month')::date,
      date_trunc('month', CURRENT_DATE)::date,
      '1 month'
    )::date
  LOOP
    SELECT * INTO m FROM public.monthly_score(p_user_id, d);
    month_start    := d;
    month_label    := to_char(d, 'Mon');
    working_days   := COALESCE(m.working_days, 0);
    avg_score_pct  := COALESCE(m.avg_score_pct, 0);
    total_payable := COALESCE(m.total_payable, 0);
    RETURN NEXT;
  END LOOP;
END $function$;

-- 5.9 consecutive_missed_days
CREATE OR REPLACE FUNCTION public.consecutive_missed_days(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count int := 0;
  v_check date := CURRENT_DATE - 1;
  v_row   record;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
  WHILE v_count < 30 LOOP
    SELECT score_pct, is_excluded
      INTO v_row
      FROM daily_performance
     WHERE user_id = p_user_id AND work_date = v_check;

    EXIT WHEN NOT FOUND;
    IF v_row.is_excluded THEN
      v_check := v_check - 1;
      CONTINUE;
    END IF;
    IF v_row.score_pct < 50 THEN
      v_count := v_count + 1;
      v_check := v_check - 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  RETURN v_count;
END $function$;

-- 5.10 todays_suggested_tasks
CREATE OR REPLACE FUNCTION public.todays_suggested_tasks(p_user_id uuid)
RETURNS TABLE(kind text, lead_id uuid, quote_id uuid, primary_text text, secondary_text text, priority integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

  RETURN QUERY
  SELECT 'new_lead'::text, l.id, NULL::uuid,
         ('Reach out to ' || COALESCE(l.name, l.company, 'lead'))::text,
         (COALESCE(l.company, '') || ' · new')::text,
         1
    FROM leads l
   WHERE l.assigned_to = p_user_id
     AND l.stage = 'New'
     AND COALESCE(l.last_contact_at, l.created_at) < (now() - INTERVAL '24 hours')
   ORDER BY l.created_at ASC
   LIMIT 5;

  RETURN QUERY
  SELECT 'chase_quote'::text, NULL::uuid, q.id,
         ('Chase quote ' || COALESCE(q.quote_number, q.id::text))::text,
         (q.client_company || ' · sent ' || (CURRENT_DATE - q.updated_at::date) || 'd ago')::text,
         2
    FROM quotes q
   WHERE q.created_by = p_user_id
     AND q.status IN ('sent', 'negotiating')
     AND q.updated_at < (now() - INTERVAL '5 days')
     AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.quote_id = q.id)
   ORDER BY q.updated_at ASC
   LIMIT 3;

  RETURN QUERY
  SELECT 'collect_payment'::text, NULL::uuid, q.id,
         ('Collect from ' || q.client_company)::text,
         ('Won · ₹' || to_char(q.total_amount, 'FM99,99,99,999') || ' outstanding')::text,
         3
    FROM quotes q
   WHERE q.created_by = p_user_id
     AND q.status = 'won'
     AND NOT EXISTS (
       SELECT 1 FROM payments p
        WHERE p.quote_id = q.id
          AND p.approval_status = 'approved'
          AND p.created_at > (now() - INTERVAL '14 days')
     )
   ORDER BY q.updated_at ASC
   LIMIT 3;
END $function$;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (paste in Studio after applying — 5 queries)
-- ═══════════════════════════════════════════════════════════════
--
-- 1. Helper exists:
--    SELECT proname, pg_get_function_identity_arguments(oid) AS args
--      FROM pg_proc
--     WHERE pronamespace = 'public'::regnamespace
--       AND proname = '_assert_self_or_admin';
--    → 1 row, args = "p_user_id uuid".
--
-- 2. get_my_role + is_sales_manager have search_path pinned:
--    SELECT proname, proconfig
--      FROM pg_proc
--     WHERE pronamespace = 'public'::regnamespace
--       AND proname IN ('get_my_role', 'is_sales_manager');
--    → 2 rows, both proconfig contains 'search_path=public, pg_temp'.
--
-- 3. All 14 functions now have SET search_path:
--    SELECT proname, COALESCE(array_to_string(proconfig, ','), '<none>') AS cfg
--      FROM pg_proc
--     WHERE pronamespace = 'public'::regnamespace
--       AND proname IN (
--         'get_my_role','is_sales_manager','approve_leave',
--         'eligible_for_paid_leave','compute_monthly_salary',
--         '_compute_monthly_salary_base','compute_daily_score',
--         'monthly_score','compute_daily_ta','backfill_performance',
--         'backfill_ta','score_history','consecutive_missed_days',
--         'todays_suggested_tasks','_assert_self_or_admin')
--     ORDER BY proname;
--    → 15 rows. Each cfg should mention 'search_path'.
--
-- 4. Live block test — sales rep impersonation.
--    NOTE: replace BOTH uids below before running:
--      • v_uid           — IMPERSONATED rep (any active sales rep).
--      • target uid arg  — DIFFERENT rep (to trigger the cross-rep block).
--    Find both via: SELECT id, name, role FROM users
--                    WHERE role='sales' AND is_active=true ORDER BY name;
--    Pre-filled here: caa6236a-844b-4097-8d93-f71d9b28ffae=Dixita,
--                     8d37a7d1-dd41-4b5d-a422-d1f7114a1aa8=Mayur.
--    Confirm both exist in your DB before running.
--    DO $$
--    DECLARE v_uid uuid := 'caa6236a-844b-4097-8d93-f71d9b28ffae';
--    BEGIN
--      PERFORM set_config('role','authenticated',true);
--      PERFORM set_config('request.jwt.claims',
--        json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
--      BEGIN
--        PERFORM public.compute_monthly_salary(
--          '8d37a7d1-dd41-4b5d-a422-d1f7114a1aa8'::uuid,  -- MAYUR uid, not Dixita
--          2026, 5);
--        RAISE NOTICE 'F102_TEST=FAIL_CROSS_USER_ALLOWED';
--      EXCEPTION WHEN insufficient_privilege THEN
--        RAISE NOTICE 'F102_TEST=PASS_BLOCKED %', SQLERRM;
--      END;
--    END $$;
--    → expect NOTICE: F102_TEST=PASS_BLOCKED ...
--
-- 5. Live self-call test as same sales rep — must succeed:
--    DO $$
--    DECLARE v_uid uuid := 'caa6236a-844b-4097-8d93-f71d9b28ffae';
--    DECLARE r jsonb;
--    BEGIN
--      PERFORM set_config('role','authenticated',true);
--      PERFORM set_config('request.jwt.claims',
--        json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
--      r := public.compute_monthly_salary(v_uid, 2026, 5);
--      RAISE NOTICE 'F102_SELF=PASS net=%', r->>'net_payable';
--    END $$;
--    → expect NOTICE: F102_SELF=PASS net=...

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (only if regression observed — paste in Studio)
-- ═══════════════════════════════════════════════════════════════
-- Each function reverts to pre-Phase-97.2 body. Helper kept (no
-- harm — unused unless other phase calls it).
--
-- Symptoms that mean rollback needed:
--   • admin /admin/salary page errors with 42501
--   • Phase 34Z.66 score trigger raises 42501 inside rep transaction
--   • Phase 34Z.67 TA trigger raises 42501 inside rep transaction
--   • Phase 36 leave approval errors
--   • Cron jobs (Phase 49) errors on backfill_performance
--
-- Paste this block to revert:
--
-- CREATE OR REPLACE FUNCTION public.get_my_role()
-- RETURNS text LANGUAGE sql SECURITY DEFINER
-- AS $$ SELECT role FROM users WHERE id = auth.uid() $$;
--
-- CREATE OR REPLACE FUNCTION public.is_sales_manager()
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
-- AS $$
--   SELECT EXISTS (
--     SELECT 1 FROM public.users
--      WHERE id = auth.uid()
--        AND team_role = 'sales_manager'
--        AND is_active = true
--   );
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.approve_leave(p_leave_id uuid)
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER
-- SET search_path TO 'public' AS $$
-- DECLARE v_row record;
-- BEGIN
--   SELECT user_id, leave_date INTO v_row
--     FROM leaves WHERE id = p_leave_id AND status <> 'approved';
--   IF NOT FOUND THEN RETURN; END IF;
--   UPDATE leaves SET status = 'approved' WHERE id = p_leave_id;
--   PERFORM public.compute_daily_score(v_row.user_id, v_row.leave_date);
-- END $$;
--
-- CREATE OR REPLACE FUNCTION public.eligible_for_paid_leave(p_user_id uuid)
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
-- SET search_path TO 'public' AS $$
--   SELECT COALESCE(
--     (SELECT join_date <= (CURRENT_DATE - INTERVAL '9 months')
--        FROM public.staff_incentive_profiles
--       WHERE user_id = p_user_id),
--     false
--   );
-- $$;
--
-- For the 10 sibling RPCs — inline rollback bodies below. Each is
-- byte-identical to the live (pre-Phase-97.2) body, with the
-- `PERFORM public._assert_self_or_admin(p_user_id);` line REMOVED
-- and `SET search_path TO 'public'` restored (the original).
-- Helper kept in DB after rollback — harmless, unused unless re-
-- deployed.
--
-- _compute_monthly_salary_base rollback body REMOVED (Phase 178). Stale pre-97.2 copy.
-- To restore, re-run db/functions/_compute_monthly_salary_base.sql (canonical).
--
-- compute_monthly_salary rollback body REMOVED (Phase 178). Stale pre-97.2 copy.
-- To restore, re-run db/functions/compute_monthly_salary.sql (canonical).
--
-- compute_daily_score rollback body REMOVED (Phase 178). It was a stale
-- pre-Phase-110/113/127 version (calls-JSONB target, no call-gate, no meeting
-- exclusions). To restore the score, re-run db/functions/compute_daily_score.sql
-- — the single canonical source. Do NOT uncomment an old body.
--
-- For brevity, the remaining 7 (monthly_score, compute_daily_ta,
-- backfill_performance, backfill_ta, score_history,
-- consecutive_missed_days, todays_suggested_tasks) — copy from the
-- Phase 97.2 forward bodies above and DELETE the
-- `PERFORM public._assert_self_or_admin(p_user_id);` line + change
-- SET search_path back to TO 'public'. Each is independent + idempotent.
-- The 3 inlined above cover the highest-risk path (salary +
-- score). The 7 truncated functions follow the same mechanical
-- recipe — apply if a rollback ever fires; safe to delay since
-- removing the gate only OPENS the door, doesn't break the door.
--
-- NOTIFY pgrst, 'reload schema';
