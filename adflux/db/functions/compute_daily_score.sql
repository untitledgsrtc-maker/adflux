-- ============================================================================
-- db/functions/compute_daily_score.sql  —  THE CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ This is the ONE place compute_daily_score is allowed to live.
--    To change the daily score, EDIT THIS FILE (re-paste the whole body here)
--    and run it once in Supabase Studio. NEVER write a new phaseN file that
--    re-pastes compute_daily_score — that is exactly what made this function
--    live in 10 files and silently revert itself (§69 / §70 / §71).
--
-- WHY this exists: compute_daily_score → daily_performance.score_pct → monthly
--    incentive. It is a MONEY function (audit risk-score 5). It was previously
--    CREATE OR REPLACE'd in 10 different SQL files; re-running an OLDER one
--    stripped a newer fix and broke incentive. See DUPLICATION_AUDIT_2026-06-17.md.
--
-- PROVENANCE: captured byte-for-byte from the LIVE staging database on
--    2026-06-23 via  pg_get_functiondef('public.compute_daily_score'::regprocedure).
--    Running this file now is a NO-OP (it reinstalls the identical body already
--    running). It changes ZERO numbers. That is the point — capture, don't change.
--
-- SUPERSEDES (do NOT re-run the compute_daily_score block in any of these —
--    Phase 178 removed that block from each; their OTHER functions stay live):
--      supabase_phase33e_performance_score.sql
--      supabase_phase33g_leaves_table.sql
--      supabase_phase33i_fixes.sql
--      supabase_phase34z66_daily_performance_autocompute.sql
--      supabase_phase34z70_audit_round2_fixes.sql
--      supabase_phase52_score_tc_aware.sql
--      supabase_phase97_2_rpc_role_gates.sql
--      supabase_phase110_score_real_calls.sql
--      supabase_phase113_score_target_and_meeting_fix.sql
--      supabase_phase127_meeting_revisit_dedup_fix.sql
--
-- LOCKED CONTRACTS baked into the body below (a diff that removes any of these
--    is a BLOCK per §71 — they are the fixes that took months to land):
--      • Phase 97.2 F-102   — _assert_self_or_admin(p_user_id) self/admin gate.
--      • Phase 113 (#1)     — telecaller target reads daily_targets.min_calls
--                             (the table the screen shows), NOT users.daily_targets
--                             JSONB. No JSONB fallback. (§44.8 / §49 / §115)
--      • Phase 110 (#5)     — a call earns score only if it really happened
--                             (outcome NOT NULL, or a call_logs row ≥10s and not
--                             'missed'). A tapped-but-not-dialed call earns nothing.
--      • Phase 113 (#2)+127 — meeting branch applies the §33 done-meeting
--                             exclusions ('Meeting scheduled%' + auto-check-in)
--                             AND dedupes by lead (a revisit = 1 meeting).
--
-- OWNER DECISION (do NOT "fix" without his sign-off): the CALL branch counts a
--    call on  outcome IS NOT NULL OR ≥10s  — looser than the ≥10s-only counter.
--    Tightening it to ≥10s-only would lower some reps' scores/pay. Owner said
--    LEAVE IT (§65 / §67, 13–16 Jun 2026). The looseness is intentional.
--
-- REVERT: re-run this file. It is the single source of truth.
-- TRIPWIRE: the VERIFY block at the bottom proves the live function still
--    contains every locked fix. Run it any time. Any FALSE = an old copy was
--    re-run → re-run this file to restore.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_daily_score(p_user_id uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    -- Phase 113 (#1) — read the SAME target the rep's screen shows: the
    -- daily_targets TABLE min_calls (active row, effective_to IS NULL),
    -- NOT the abandoned users.daily_targets JSONB. NULLIF(min_calls,0)
    -- mirrors the screen's `min_calls || 50` so 0/blank → 50, never the
    -- v_target=0 → 100% guard. No JSONB fallback (screen has none).
    SELECT NULLIF(dt.min_calls, 0)
      INTO v_target
      FROM daily_targets dt
     WHERE dt.user_id = p_user_id AND dt.effective_to IS NULL
     LIMIT 1;
    v_target   := COALESCE(v_target, 50);
    v_activity := 'call';
  ELSE
    v_target   := COALESCE((v_targets->>'meetings')::int, 5);
    v_activity := 'meeting';
  END IF;

  -- Phase 110 (#5) — gate the CALL count so a tapped-but-not-dialed call
  -- never earns score. PRESERVED byte-identical.
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
    -- Phase 113 (#2) — apply the §33 done-meeting exclusions so the
    -- SCORE matches the live counter + GPS-track + evening-report
    -- counts. Scheduled future meetings ("Meeting scheduled · <date>")
    -- and auto-check-in companion rows ("I'm here · auto-check-in…")
    -- are NOT done meetings → must not earn score → incentive. The
    -- (notes IS NULL OR …) guard keeps null-note real meetings counted.
    --
    -- Phase 127 — DEDUPE by lead. A rep who meets the SAME lead twice in
    -- a day = 1 done meeting (owner rule: a revisit is not a new meeting),
    -- matching recompute_daily_meetings + the GPS-track headline + the
    -- evening report. COUNT(*) over-counted revisits → inflated score →
    -- inflated incentive. COALESCE(lead_id,id) keeps walk-ins unique.
    SELECT COUNT(DISTINCT COALESCE(la.lead_id::text, la.id::text))
      INTO v_done
      FROM lead_activities la
     WHERE la.created_by    = p_user_id
       AND la.activity_type = v_activity
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_date
       AND (la.notes IS NULL OR la.notes NOT LIKE 'Meeting scheduled%')
       AND (la.notes IS NULL OR la.notes NOT LIKE 'I''m here · auto-check-in%');
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

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- A FALSE means an older copy of compute_daily_score was re-run and stripped a
-- locked fix → re-run this file to restore the canonical version.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%_assert_self_or_admin%'              AS has_97_2_self_gate,
--   pg_get_functiondef(p.oid) LIKE '%min_calls%'                          AS has_113_tc_target,
--   pg_get_functiondef(p.oid) LIKE '%duration_seconds >= 10%'             AS has_110_call_gate,
--   pg_get_functiondef(p.oid) LIKE '%Meeting scheduled%'                  AS has_33_sched_excl,
--   pg_get_functiondef(p.oid) LIKE '%auto-check-in%'                      AS has_33_autocheckin_excl,
--   pg_get_functiondef(p.oid) LIKE '%COUNT(DISTINCT COALESCE(la.lead_id%' AS has_127_lead_dedup
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'compute_daily_score';
