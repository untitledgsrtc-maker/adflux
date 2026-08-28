-- ============================================================================
-- supabase_ops_p4_uptime_pay.sql — Operations module Phase 4 (§230). MONEY.
-- ============================================================================
-- Turns a field tech's SCREEN UPTIME into 70/30 fixed+variable pay: more
-- downtime → less variable. Does it by writing daily_performance.score_pct
-- for each operation_executive from a SEPARATE trigger — the frozen
-- db/functions/compute_daily_score.sql is BYTE-UNTOUCHED (§72). From there the
-- existing role-agnostic chain (monthly_score → _compute_monthly_salary_base →
-- compute_monthly_salary) pays them 70/30 with ZERO edits (recon-confirmed:
-- no role gate excludes operation_executive; the pay reads only monthly_salary
-- × avg(score_pct)).
--
-- ── OWNER: THIS IS A MONEY CHANGE. RUN IT ONLY WHEN YOU ARE READY TO TURN ON
--    OPS UPTIME PAY. Read the SHADOW-COMPARE (Part 3) FIRST — it prints the
--    exact uptime→pay curve. The two SLA thresholds (90 / 97) are ONE line
--    each in ops_uptime_to_daily_performance() — tell me to change them and
--    re-run. Nothing pays until (a) this runs AND (b) real uptime rows exist
--    (the Head "Record uptime" button or the Phase 5 aiadflux sync writes
--    them; before real screen statuses, uptime reads 0 and the day is
--    EXCLUDED as "no screen data" so it can't tank anyone's pay). ──
--
-- ── NIGHT-GATE (MONEY, §250/§254.1): the uptime recompute RUNS ONLY 7 AM–9 PM IST.
--    Off-hours the LED screens are intentionally OFF (timers), so a live snapshot
--    would read all-offline → 0% → and TANK the tech's pay for hours they were never
--    expected to keep screens on. Off-hours the recompute early-RETURNs and
--    ops_uptime_daily KEEPS its last on-hours value. So the pay signal reflects only
--    operating-hours uptime — which is correct. Matches opsHours.js isOnHours() +
--    the §254.1 auto-ticket gate, so pay + tickets agree. ──
--
-- Prerequisites for an ops exec to actually be paid (recon):
--   1. A staff_incentive_profiles row with monthly_salary > 0 (auto-create is
--      sales-only → create it by hand). The 70/30 cap is hardcoded, not a column.
--   2. daily_performance rows (this file's trigger writes them from uptime).
--
-- ACTIVATION CAVEAT (review advisory 2a — a frozen-monthly_score quirk, not a
-- bug here): if a WHOLE month has zero MEASURED uptime days (every day excluded
-- because screens never reported), monthly_score's "0 working days -> full cap"
-- rule (72/143) would pay the FULL 30% variable — the OPPOSITE of the intent.
-- So turn ops uptime pay on ONLY once real daily uptime rows land every workday
-- (Phase 5 aiadflux sync live, or the Head records uptime daily). Do NOT set a
-- monthly_salary on an ops exec whose screens are not yet reporting real statuses.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Re-runnable.
-- ============================================================================

-- ── Part 1 · recompute today's uptime per tech (the pay SIGNAL source) ──────
-- Snapshots each tech's assigned depots' CURRENT screen statuses into
-- ops_uptime_daily. uptime = online / (online+offline) — 'unknown' screens
-- (no data yet) are excluded from BOTH so a pre-aiadflux day reads
-- screens_total=0 and the trigger excludes it (never a false 0%).
-- Called by: the Head "Record uptime" button (OpsHeadV2) + the Phase 5 sync.
--
-- NIGHT-GATE (MONEY, §250/§254.1): the recompute RUNS ONLY 7 AM–9 PM IST. Off-hours
-- the LED screens are intentionally OFF (timers), so a live snapshot reads all-offline
-- → uptime 0% → would TANK the tech's pay for hours they were never expected to keep
-- screens on. Off-hours the function early-RETURNs → ops_uptime_daily KEEPS its LAST
-- on-hours value. The 7 AM–9 PM window matches src/utils/opsHours.js isOnHours() and
-- the §254.1 auto-ticket engine's gate EXACTLY, so pay + tickets agree.
CREATE OR REPLACE FUNCTION public.ops_recompute_uptime_today(p_user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r       record;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_role  text := public.get_my_role();
  v_hour  int  := extract(hour FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int;
BEGIN
  -- Head/admin (or a service-role/cron call → null role) only. A known
  -- non-privileged role is blocked; the recompute is deterministic from live
  -- screen data (no caller input steers a value) so this is defence-in-depth.
  IF v_role IS NOT NULL AND v_role NOT IN ('admin', 'co_owner', 'operation_head') THEN
    RAISE EXCEPTION 'not authorized to recompute ops uptime';
  END IF;

  -- ── NIGHT-GATE (MONEY): OPERATING HOURS ONLY, 7 AM–9 PM IST ──────────────
  -- Off-hours the LED screens are intentionally OFF (timers, §250/§254.1), so a
  -- live snapshot reads all-offline → uptime 0% → would TANK the tech's uptime
  -- pay for hours they were never expected to keep screens on. Skip the recompute
  -- off-hours → ops_uptime_daily KEEPS its LAST on-hours value (the real daytime
  -- uptime). Matches src/utils/opsHours.js isOnHours() exactly (hour >= 7 AND < 21)
  -- and the §254.1 auto-ticket engine's own 7 AM–9 PM gate, so pay + tickets agree.
  IF v_hour < 7 OR v_hour >= 21 THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT u.id AS uid,
           count(s.id) FILTER (WHERE s.status IN ('online', 'offline')) AS known_total,
           count(s.id) FILTER (WHERE s.status = 'online')               AS up
      FROM public.users u
      LEFT JOIN public.ops_depots  d ON d.assigned_to = u.id AND d.is_active
      LEFT JOIN public.ops_screens s ON s.depot_id = d.id    AND s.is_active
     WHERE u.role = 'operation_executive' AND u.is_active
       AND (p_user_id IS NULL OR u.id = p_user_id)
     GROUP BY u.id
  LOOP
    INSERT INTO public.ops_uptime_daily (user_id, work_date, screens_total, screens_up, uptime_pct)
    VALUES (r.uid, v_today, r.known_total, r.up,
            CASE WHEN r.known_total > 0 THEN round(r.up::numeric / r.known_total * 100, 2) ELSE 0 END)
    ON CONFLICT (user_id, work_date) DO UPDATE
      SET screens_total = EXCLUDED.screens_total,
          screens_up    = EXCLUDED.screens_up,
          uptime_pct    = EXCLUDED.uptime_pct,
          updated_at    = now();
  END LOOP;
END;
$$;

REVOKE ALL     ON FUNCTION public.ops_recompute_uptime_today(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_recompute_uptime_today(uuid) TO authenticated, service_role;

-- ── Part 2 · uptime → daily_performance.score_pct (the pay MAPPING) ─────────
-- SLA transform: uptime <= FLOOR → score 0 (→ monthly avg < 50 → 0 variable);
-- uptime >= CEILING → score 100 (→ avg > 75 → full 30% variable); linear
-- between. is_excluded set here (compute_daily_score never runs for ops execs,
-- so nobody else marks their off-days). SECURITY DEFINER — daily_performance
-- write RLS is admin-only; the tech's own ops_uptime_daily update can't write
-- daily_performance without it.
CREATE OR REPLACE FUNCTION public.ops_uptime_to_daily_performance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_floor    numeric := 90;   -- SLA: uptime <= 90% → 0 pay signal   (owner-tunable)
  v_ceiling  numeric := 97;   -- SLA: uptime >= 97% → full pay signal (owner-tunable)
  v_score    numeric;
  v_excluded boolean;
  v_reason   text;
BEGIN
  -- Safety (review advisory 6a): only ever write daily_performance for an
  -- operation_executive. A hand-inserted ops_uptime_daily row for a sales
  -- rep's id must NOT clobber that rep's meeting-based score_pct.
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.user_id AND role = 'operation_executive') THEN
    RETURN NEW;
  END IF;

  v_score := LEAST(100, GREATEST(0,
               round((NEW.uptime_pct - v_floor) / (v_ceiling - v_floor) * 100, 2)));

  IF NEW.screens_total = 0 THEN
    -- no measurement yet (all screens 'unknown' / none) → don't count the day
    v_excluded := true;  v_reason := 'no screen data'; v_score := 0;
  ELSIF public.is_off_day(NEW.work_date) THEN
    -- Sunday / holiday parity with sales (tech is off, can't fix a screen)
    v_excluded := true;  v_reason := 'off day';
  ELSE
    v_excluded := false; v_reason := NULL;
  END IF;

  INSERT INTO public.daily_performance
    (user_id, work_date, score_pct, is_excluded, excluded_reason, calculated_at)
  VALUES
    (NEW.user_id, NEW.work_date, v_score, v_excluded, v_reason, now())
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET score_pct       = EXCLUDED.score_pct,
        is_excluded     = EXCLUDED.is_excluded,
        excluded_reason = EXCLUDED.excluded_reason,
        calculated_at   = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ops_uptime_to_dp ON public.ops_uptime_daily;
CREATE TRIGGER trg_ops_uptime_to_dp
  AFTER INSERT OR UPDATE OF uptime_pct, screens_total ON public.ops_uptime_daily
  FOR EACH ROW EXECUTE FUNCTION public.ops_uptime_to_daily_performance();

NOTIFY pgrst, 'reload schema';

-- ── Part 3 · SHADOW-COMPARE — the exact uptime → pay curve (owner: READ THIS) ─
-- Run this SELECT after the file. It shows, for a spread of monthly-average
-- uptimes, the score_pct the transform produces AND which monthly_score band
-- it lands in (>75 → FULL 30% variable · <50 → ZERO · 50–75 → proportional).
-- Change the 90/97 constants above + re-run if the cut-offs aren't what you want.
--
--   SELECT up.uptime,
--          LEAST(100, GREATEST(0, round((up.uptime - 90) / (97 - 90) * 100, 2))) AS score_pct,
--          CASE
--            WHEN LEAST(100, GREATEST(0, round((up.uptime - 90) / (97 - 90) * 100, 2))) > 75 THEN 'FULL 30% variable'
--            WHEN LEAST(100, GREATEST(0, round((up.uptime - 90) / (97 - 90) * 100, 2))) < 50 THEN 'ZERO variable'
--            ELSE 'proportional'
--          END AS monthly_band
--     FROM (VALUES (88.0),(90.0),(92.0),(93.5),(95.0),(95.5),(96.0),(97.0),(98.0),(100.0)) AS up(uptime)
--    ORDER BY up.uptime;
--
-- Expected (with 90/97): <=90 → 0 → ZERO · 93.5 → 50 → proportional · 95.5 → ~78.6 → FULL ·
--                        >=97 → 100 → FULL. So ~≥95.5% avg uptime earns the full 30%,
--                        <=90% earns none, 90–95.5% is graded. (Tunable via the two constants.)

-- ── VERIFY (structure) ──
-- SELECT
--   to_regprocedure('public.ops_recompute_uptime_today(uuid)') IS NOT NULL AS recompute_fn,
--   to_regprocedure('public.ops_uptime_to_daily_performance()') IS NOT NULL AS trigger_fn,
--   EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ops_uptime_to_dp') AS trigger_wired,
--   (SELECT prosecdef FROM pg_proc WHERE proname = 'ops_uptime_to_daily_performance') AS is_definer;
-- ============================================================================
