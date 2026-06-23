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

-- -------------------------------------------------------------------------
-- compute_daily_score REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/compute_daily_score.sql
-- Do NOT re-add it here. To change the score, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

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
