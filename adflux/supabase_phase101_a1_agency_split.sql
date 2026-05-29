-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 101.A1
-- Agency role split — SQL backend (commission-only, no salary)
-- 2026-05-29 (Brijesh Solanki)
-- =====================================================================
--
-- WHY (owner directive 2026-05-29):
--   Phase 11g (4 May 2026) made agency = sales-equivalent at the RLS +
--   incentive-trigger layer. Owner reversed: agency is commission-only
--   partner channel — no salary, no incentive slab, no KPI score, no
--   TA/DA, no leave, no attendance. Agency keeps quote ownership and
--   commission earned on Won quotes (subtotal × commission_percent).
--
-- WHAT THIS FILE DOES (idempotent, run before Phase 101.A2 JSX):
--   1. Add users.agency_commission_percent NUMERIC(5,2) DEFAULT 5.00,
--      CHECK 0..100. Backfill existing agency rows to 5.00.
--   2. Drop 'agency' from auto_create_incentive_profile() so future
--      agency users do NOT get a staff_incentive_profiles row.
--   3. New deactivate_incentive_on_agency_flip() function +
--      users_agency_deactivate_incentive AFTER UPDATE OF role trigger.
--      Sales→agency role flip deactivates the existing incentive
--      profile row. SECURITY DEFINER + SET search_path so admin
--      edits via TeamMemberModal succeed regardless of caller RLS.
--      Tightly scoped: only fires on role transition INTO 'agency';
--      only touches the affected user's own row.
--   4. compute_monthly_salary wrapper: agency short-circuit AFTER
--      _assert_self_or_admin auth check (no role-leak to other users).
--      Returns full snake_case key set matching consumers
--      (TotalPayableCard, SalaryAdminV2, RepProfileV2 etc.) so no
--      interim UI crash during the SQL-before-JSX rollout window.
--   5. Deactivate existing agency rows in staff_incentive_profiles
--      (monthly_salary preserved for audit, just is_active=false).
--
-- WHAT THIS FILE DOES NOT TOUCH (deferred to A2 / later):
--   - _compute_monthly_salary_base inner RPC (other callers may read)
--   - users_auto_incentive_profile INSERT trigger DDL
--   - quotes / payments / follow_ups / sip / ip / msd RLS (agency
--     still owns its quotes and payments via existing policies)
--   - frontend (Phase 101.A2 ships after VERIFY V1-V10 PASS)
--
-- ROLLOUT: Phase 101.A1 SQL first → owner runs in Studio + reports
-- VERIFY V1-V10. Phase 101.A2 JSX ships after A1 verified live.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- (1) users.agency_commission_percent column
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS agency_commission_percent numeric(5,2)
  DEFAULT 5.00;

-- Range CHECK constraint. Postgres has no IF NOT EXISTS for CHECK,
-- so wrap in DO block that catches duplicate_object on re-run.
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.users
      ADD CONSTRAINT users_agency_commission_percent_range
      CHECK (agency_commission_percent IS NULL
             OR (agency_commission_percent >= 0
                 AND agency_commission_percent <= 100));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Backfill existing agency rows. DEFAULT 5.00 applies to new INSERTs
-- only — existing rows get NULL after ADD COLUMN.
UPDATE public.users
   SET agency_commission_percent = 5.00
 WHERE role = 'agency'
   AND agency_commission_percent IS NULL;


-- ─────────────────────────────────────────────────────────────────────
-- (2) auto_create_incentive_profile — drop 'agency'
-- ─────────────────────────────────────────────────────────────────────
-- Phase 11g body: IF NEW.role NOT IN ('sales','agency') THEN RETURN.
-- Phase 101.A1: narrow to sales only. Telecaller / office_staff /
-- admin / co_owner / hr / accounts / staff never had an auto-created
-- profile in the first place. Agency leaves the door, commission-only.

CREATE OR REPLACE FUNCTION public.auto_create_incentive_profile()
RETURNS TRIGGER AS $$
DECLARE
  s incentive_settings%ROWTYPE;
BEGIN
  IF NEW.role NOT IN ('sales') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM staff_incentive_profiles WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM incentive_settings LIMIT 1;

  INSERT INTO staff_incentive_profiles (
    user_id, monthly_salary, sales_multiplier,
    new_client_rate, renewal_rate, flat_bonus,
    join_date, is_active
  ) VALUES (
    NEW.id, 0,
    COALESCE(s.default_multiplier, 5),
    COALESCE(s.new_client_rate, 0.05),
    COALESCE(s.renewal_rate, 0.02),
    COALESCE(s.default_flat_bonus, 10000),
    CURRENT_DATE, true
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ─────────────────────────────────────────────────────────────────────
-- (3) Role-change guard — deactivate incentive when role → agency
-- ─────────────────────────────────────────────────────────────────────
-- Phase 11g auto_create_incentive_profile trigger is AFTER INSERT only
-- (per supabase_schema.sql + supabase_all_migrations.sql confirmed
-- 2026-05-29). A sales→agency UPDATE leaves stale active rows.
--
-- New function: scoped to the affected user, only fires on transition
-- INTO 'agency'. Reverse transition (agency → sales) does NOT
-- auto-reactivate — admin reactivates manually via StaffModal if needed
-- (owner Q-101-1 default accepted 2026-05-29).
--
-- SECURITY DEFINER + SET search_path = public, pg_temp so the UPDATE
-- bypasses caller-side RLS on staff_incentive_profiles. Admin via
-- TeamMemberModal already has full access via sip_admin_all; this is
-- belt-and-braces for any future caller path. Search_path pinned per
-- Phase 97.2 doctrine (no schema-resolution surprise).
--
-- Scope tightness: UPDATE clause narrows to user_id = NEW.id AND
-- is_active = true. No SELECT against other users. No DELETE.

CREATE OR REPLACE FUNCTION public.deactivate_incentive_on_agency_flip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only act when role transitions INTO 'agency'. Reverse path
  -- (agency → anything else) is a no-op per owner directive.
  IF NEW.role = 'agency'
     AND COALESCE(OLD.role, '') <> 'agency' THEN
    UPDATE public.staff_incentive_profiles
       SET is_active = false
     WHERE user_id = NEW.id
       AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger fires on role UPDATE only. WHEN clause filters to
-- actual role changes (NULL-safe IS DISTINCT FROM).
DROP TRIGGER IF EXISTS users_agency_deactivate_incentive ON public.users;
CREATE TRIGGER users_agency_deactivate_incentive
  AFTER UPDATE OF role ON public.users
  FOR EACH ROW
  WHEN (NEW.role IS DISTINCT FROM OLD.role)
  EXECUTE FUNCTION public.deactivate_incentive_on_agency_flip();


-- ─────────────────────────────────────────────────────────────────────
-- (4) compute_monthly_salary — agency short-circuit AFTER auth
-- ─────────────────────────────────────────────────────────────────────
-- Source authority: supabase_phase97_2_rpc_role_gates.sql:326-375
-- (wrapper). Inner _compute_monthly_salary_base RPC unchanged.
--
-- Critical order:
--   a) PERFORM public._assert_self_or_admin(p_user_id) FIRST.
--      Without this, the agency check below would leak target's role
--      to any caller (admin/self gate enforced before role disclosure).
--   b) THEN fetch target role.
--   c) THEN agency short-circuit with full snake_case payload.
--
-- Compatibility window: A1 ships before A2 JSX. During that window,
-- existing UI (TotalPayableCard, SalaryAdminV2, RepProfileV2) may
-- still call this RPC on an agency user. Returned payload includes
-- every snake_case key those callers read with `Number(salary.X || 0)`
-- defensive defaults, so all numbers degrade to 0 — no NaN, no crash.

CREATE OR REPLACE FUNCTION public.compute_monthly_salary(
  p_user_id uuid,
  p_year    integer,
  p_month   integer
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role             text;
  v_result           jsonb;
  v_is_manager       boolean;
  v_override_pct     numeric;
  v_team_revenue     numeric;
  v_override_amount  numeric := 0;
  v_month_year       text := lpad(p_year::text, 4, '0') || '-' || lpad(p_month::text, 2, '0');
  v_fy               text;
BEGIN
  -- (a) Auth gate FIRST. Blocks cross-user reads. Self / admin /
  --     co_owner reach the next line; everyone else 42501.
  PERFORM public._assert_self_or_admin(p_user_id);

  -- (b) Fetch target role under the gate.
  SELECT role INTO v_role FROM public.users WHERE id = p_user_id;

  -- (c) Phase 101.A1 agency short-circuit. Returns the full
  --     consumer-snake_case key set with zeros. `ok=false` lets
  --     future code discriminate; legacy code reading individual
  --     fields with `|| 0` defaults degrades cleanly.
  IF v_role = 'agency' THEN
    v_fy := public.fy_for_date(make_date(p_year, p_month, 1));
    RETURN jsonb_build_object(
      'ok',                false,
      'reason',            'agency role — commission-only, no salary',
      'user_id',           p_user_id,
      'year',              p_year,
      'month',             p_month,
      'fy',                v_fy,
      'monthly_salary',    0,
      'base',              0,
      'variable',          0,
      'score_pct',         0,
      'working_days',      0,
      'incentive',         0,
      'ta_da',             0,
      'ta_from_pings',     0,
      'ta_from_claims',    0,
      'leave_days_total',  0,
      'leave_days_paid',   0,
      'leave_days_unpaid', 0,
      'paid_quota',        0,
      'paid_used_ytd',     0,
      'unpaid_divisor',    26,
      'unpaid_deduction',  0,
      'net_payable',       0
    );
  END IF;

  -- (d) Non-agency path — verbatim from
  --     supabase_phase97_2_rpc_role_gates.sql:343-374.
  SELECT (team_role = 'sales_manager') INTO v_is_manager
    FROM public.users WHERE id = p_user_id;
  v_is_manager := COALESCE(v_is_manager, false);

  SELECT public._compute_monthly_salary_base(p_user_id, p_year, p_month) INTO v_result;

  IF v_is_manager THEN
    SELECT incentive_override_pct INTO v_override_pct
      FROM public.staff_incentive_profiles
     WHERE user_id = p_user_id;

    IF v_override_pct IS NOT NULL AND v_override_pct > 0 THEN
      SELECT COALESCE(SUM(COALESCE(new_client_revenue, 0) + COALESCE(renewal_revenue, 0)), 0)
        INTO v_team_revenue
        FROM public.monthly_sales_data
       WHERE staff_id IN (SELECT id FROM public.users WHERE manager_id = p_user_id)
         AND month_year = v_month_year;

      v_override_amount := round(v_team_revenue * (v_override_pct / 100.0));

      v_result := v_result
        || jsonb_build_object(
             'team_revenue',     v_team_revenue,
             'override_pct',     v_override_pct,
             'override_amount',  v_override_amount,
             'incentive',        (COALESCE((v_result->>'incentive')::numeric, 0) + v_override_amount),
             'net_payable',      (COALESCE((v_result->>'net_payable')::numeric, 0) + v_override_amount)
           );
    END IF;
  END IF;

  RETURN v_result;
END $function$;

GRANT EXECUTE ON FUNCTION public.compute_monthly_salary(uuid, integer, integer) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- (5) Deactivate existing agency staff_incentive_profiles
-- ─────────────────────────────────────────────────────────────────────
-- Owner directive: do NOT delete history (Q-101-1 / Q11). Just flip
-- is_active=false. monthly_salary stays for audit visibility.

UPDATE public.staff_incentive_profiles
   SET is_active = false
 WHERE user_id IN (SELECT id FROM public.users WHERE role = 'agency')
   AND is_active = true;


-- ─────────────────────────────────────────────────────────────────────
-- Refresh PostgREST schema cache
-- ─────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY (run after applying — paste into Studio one by one)
-- =====================================================================
--
-- V1: column present + default + numeric type
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'users'
--      AND column_name = 'agency_commission_percent';
--   Expected: 1 row, numeric, 5.00
--
-- V2: CHECK constraint present
--   SELECT conname FROM pg_constraint
--    WHERE conname = 'users_agency_commission_percent_range';
--   Expected: 1 row
--
-- V3: existing agency users backfilled to 5.00
--   SELECT COUNT(*) FROM public.users
--    WHERE role = 'agency' AND agency_commission_percent IS NULL;
--   Expected: 0
--
-- V4: auto_create_incentive_profile excludes agency
--   SELECT pg_get_functiondef(oid) ~ 'NEW\.role NOT IN \(\s*''sales''\s*\)' AS sales_only
--     FROM pg_proc WHERE proname = 'auto_create_incentive_profile';
--   Expected: t
--
-- V5: deactivate trigger exists on users
--   SELECT tgname FROM pg_trigger
--    WHERE tgname = 'users_agency_deactivate_incentive';
--   Expected: 1 row
--
-- V6: deactivate trigger function exists with SECDEF + search_path
--   SELECT
--     prosecdef                                AS is_secdef,
--     proconfig                                AS configs
--     FROM pg_proc
--    WHERE proname = 'deactivate_incentive_on_agency_flip';
--   Expected: 1 row, is_secdef=t,
--             configs contains 'search_path=public, pg_temp'
--
-- V7: compute_monthly_salary asserts BEFORE role check + has agency branch
--   SELECT
--     pg_get_functiondef(oid) ~ '_assert_self_or_admin'                      AS asserts_present,
--     pg_get_functiondef(oid) ~ 'agency role — commission-only, no salary'   AS has_agency_branch,
--     position('_assert_self_or_admin' IN pg_get_functiondef(oid))
--       <
--     position('IF v_role = ''agency''' IN pg_get_functiondef(oid))          AS auth_before_role_check
--     FROM pg_proc
--    WHERE proname = 'compute_monthly_salary' AND pronargs = 3;
--   Expected: t, t, t
--
-- V8: existing agency staff_incentive_profiles deactivated
--   SELECT COUNT(*) FROM public.staff_incentive_profiles sip
--     JOIN public.users u ON u.id = sip.user_id
--    WHERE u.role = 'agency' AND sip.is_active = true;
--   Expected: 0
--
-- V9 (live smoke — paste an actual agency user_id):
--   SELECT public.compute_monthly_salary(
--     '<existing_agency_user_id>'::uuid, 2026, 5
--   );
--   Expected: jsonb containing
--     "ok": false,
--     "reason": "agency role — commission-only, no salary",
--     "net_payable": 0,
--     "base": 0,
--     "variable": 0,
--     (plus all snake_case keys at zero)
--
-- V10 (live smoke — paste a sales user_id, e.g. Sondarva):
--   SELECT public.compute_monthly_salary(
--     '<existing_sales_user_id>'::uuid, 2026, 5
--   );
--   Expected: jsonb WITHOUT "ok" key; numbers reflect real
--   monthly_score / incentive_payouts / daily_ta / leaves math.
--   Sales math byte-identical to pre-A1 behavior.
--
-- =====================================================================
-- ROLLBACK (paste in Studio only if VERIFY reveals an issue)
-- =====================================================================
--
-- a) Drop the role-change trigger + function
--   DROP TRIGGER IF EXISTS users_agency_deactivate_incentive ON public.users;
--   DROP FUNCTION IF EXISTS public.deactivate_incentive_on_agency_flip();
--
-- b) Re-activate the deactivated staff_incentive_profiles rows
--    (lossless — only is_active flag was flipped)
--   UPDATE public.staff_incentive_profiles
--      SET is_active = true
--    WHERE user_id IN (SELECT id FROM public.users WHERE role = 'agency');
--
-- c) Restore auto_create_incentive_profile to Phase 11g body
--    (copy from supabase_phase11g_agency_role_parity.sql:35-65 — that
--    body's first line is `IF NEW.role NOT IN ('sales', 'agency')`).
--
-- d) Restore compute_monthly_salary to Phase 97.2 body
--    (copy from supabase_phase97_2_rpc_role_gates.sql:326-375 — drop
--    the v_role DECLARE + the entire agency branch).
--
-- e) Drop the new column + constraint
--   ALTER TABLE public.users
--     DROP CONSTRAINT IF EXISTS users_agency_commission_percent_range;
--   ALTER TABLE public.users
--     DROP COLUMN IF EXISTS agency_commission_percent;
--
-- f) Refresh PostgREST
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
