-- supabase_phase33g_leaves_table.sql
--
-- Phase 33G.8 (item 82) — real `leaves` table.
--
-- Before this:
--   Phase 33E uses work_sessions.is_off_day as a "leave" proxy. Worked
--   for v1 but has problems:
--     - is_off_day belongs to ONE work_session row. If the rep never
--       checks in that day, no row exists, no leave can be recorded.
--     - No leave-type taxonomy (sick / personal / vacation).
--     - No approval workflow.
--     - No audit trail.
--
-- After this:
--   A dedicated leaves table. Admin or co_owner inserts a row when a
--   rep is on approved leave. compute_daily_score reads the leaves
--   table FIRST, falls back to the is_off_day proxy SECOND for
--   backward compatibility (existing Phase 33E data stays valid).
--
--   The work_sessions.is_off_day column is NOT dropped — kept as a
--   fallback path and so historical scores don't break. Future leave
--   tagging goes through the leaves table.
--
-- Idempotent:
--   CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS / CREATE POLICY,
--   CREATE OR REPLACE FUNCTION.

-- ─── 1. Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leaves (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_date    date NOT NULL,
  -- sick | personal | vacation | bereavement | other
  -- Loose enum (no CHECK) — keeps it flexible; UI can constrain.
  leave_type    text NOT NULL DEFAULT 'personal',
  reason        text,
  -- pending | approved | rejected. New rows default approved so the
  -- score function picks them up immediately; pending workflow is
  -- a future addition.
  status        text NOT NULL DEFAULT 'approved',
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz DEFAULT now(),
  -- One row per (user, date). If a rep needs a different leave type
  -- for the same day, the row gets updated, not duplicated.
  UNIQUE (user_id, leave_date)
);

CREATE INDEX IF NOT EXISTS idx_leaves_user_date
  ON public.leaves (user_id, leave_date);

CREATE INDEX IF NOT EXISTS idx_leaves_date
  ON public.leaves (leave_date);

-- ─── 2. RLS ───────────────────────────────────────────────────────
ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leaves_self_read   ON public.leaves;
DROP POLICY IF EXISTS leaves_admin_all   ON public.leaves;

-- Rep reads their own leaves.
CREATE POLICY leaves_self_read ON public.leaves
  FOR SELECT USING (user_id = auth.uid());

-- Admin / co_owner can do anything.
CREATE POLICY leaves_admin_all ON public.leaves
  FOR ALL USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

-- ─── 3. Helper function ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_leave_day(p_user_id uuid, p_date date)
RETURNS TABLE (is_leave boolean, leave_type text, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT true,
         l.leave_type,
         COALESCE(l.reason, 'Approved leave (' || l.leave_type || ')')
    FROM public.leaves l
   WHERE l.user_id = p_user_id
     AND l.leave_date = p_date
     AND l.status = 'approved'
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.is_leave_day(uuid, date) TO authenticated;

-- ─── 4. compute_daily_score — read leaves table FIRST ────────────
-- Phase 33E's function read work_sessions.is_off_day. Extend it to
-- check leaves table FIRST, then fall back to is_off_day proxy.
CREATE OR REPLACE FUNCTION public.compute_daily_score(
  p_user_id uuid, p_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done     int := 0;
  v_target   int := 5;
  v_pct      numeric;
  v_excluded boolean := false;
  v_reason   text;
  v_dow      int;
  v_off_day  boolean := false;
  v_targets  jsonb;
  v_leave    record;
BEGIN
  -- Sunday? Skip — not a workday.
  v_dow := EXTRACT(DOW FROM p_date)::int;
  IF v_dow = 0 THEN
    v_excluded := true;
    v_reason   := 'Sunday';
  END IF;

  -- National / Gujarat / company holiday?
  IF NOT v_excluded AND EXISTS (
    SELECT 1 FROM holidays
    WHERE holiday_date = p_date AND is_active = true
  ) THEN
    v_excluded := true;
    SELECT name INTO v_reason FROM holidays
      WHERE holiday_date = p_date AND is_active = true LIMIT 1;
    v_reason := COALESCE('Holiday: ' || v_reason, 'Holiday');
  END IF;

  -- Phase 33G.8 — approved leave from the new leaves table.
  -- Checked BEFORE the work_sessions.is_off_day proxy so the new
  -- table is the source of truth going forward.
  IF NOT v_excluded THEN
    SELECT * INTO v_leave FROM public.is_leave_day(p_user_id, p_date);
    IF v_leave.is_leave THEN
      v_excluded := true;
      v_reason   := v_leave.reason;
    END IF;
  END IF;

  -- Backwards-compat fallback — old is_off_day proxy on work_sessions.
  -- Stays in place so Phase 33E data still scores correctly.
  IF NOT v_excluded THEN
    SELECT COALESCE(ws.is_off_day, false), COALESCE(ws.off_reason, '')
      INTO v_off_day, v_reason
      FROM work_sessions ws
     WHERE ws.user_id = p_user_id AND ws.work_date = p_date;
    IF v_off_day THEN
      v_excluded := true;
      v_reason   := COALESCE(NULLIF(v_reason, ''), 'Approved leave (legacy)');
    END IF;
  END IF;

  -- Pull target from users.daily_targets (Phase 32M default 5).
  SELECT daily_targets INTO v_targets FROM users WHERE id = p_user_id;
  v_target := COALESCE((v_targets->>'meetings')::int, 5);

  -- Pull actual from work_sessions.daily_counters.
  SELECT COALESCE((daily_counters->>'meetings')::int, 0)
    INTO v_done
    FROM work_sessions
   WHERE user_id = p_user_id AND work_date = p_date;
  v_done := COALESCE(v_done, 0);

  -- Compute %. Cap at 100.
  IF v_target = 0 THEN
    v_pct := 100;
  ELSE
    v_pct := LEAST(100, (v_done::numeric / v_target::numeric) * 100);
  END IF;

  -- Upsert.
  INSERT INTO daily_performance (
    user_id, work_date, meetings_done, meetings_target,
    score_pct, is_excluded, excluded_reason, calculated_at
  ) VALUES (
    p_user_id, p_date, v_done, v_target,
    v_pct, v_excluded, v_reason, now()
  )
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET meetings_done    = EXCLUDED.meetings_done,
        meetings_target  = EXCLUDED.meetings_target,
        score_pct        = EXCLUDED.score_pct,
        is_excluded      = EXCLUDED.is_excluded,
        excluded_reason  = EXCLUDED.excluded_reason,
        calculated_at    = EXCLUDED.calculated_at;
END $$;

GRANT EXECUTE ON FUNCTION public.compute_daily_score(uuid, date) TO authenticated;

-- ─── 5. Backfill from existing is_off_day rows ───────────────────
-- Copy historical leaves so the new table has accurate history.
-- ON CONFLICT skips dates already in leaves (idempotent re-run).
INSERT INTO public.leaves (user_id, leave_date, leave_type, reason, status, created_by, created_at)
SELECT
  ws.user_id,
  ws.work_date,
  'personal',
  COALESCE(NULLIF(ws.off_reason, ''), 'Migrated from is_off_day proxy'),
  'approved',
  ws.user_id,
  ws.created_at
  FROM work_sessions ws
 WHERE ws.is_off_day = true
   AND ws.work_date IS NOT NULL
ON CONFLICT (user_id, leave_date) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- 1. Row count after backfill:
--    SELECT COUNT(*) FROM public.leaves;
-- 2. Helper function:
--    SELECT * FROM public.is_leave_day('<rep_uuid>', current_date);
-- 3. Mark a leave for today, then verify score function picks it up:
--    INSERT INTO leaves (user_id, leave_date, leave_type, reason)
--      VALUES ('<rep_uuid>', current_date, 'sick', 'Fever');
--    SELECT compute_daily_score('<rep_uuid>', current_date);
--    SELECT is_excluded, excluded_reason FROM daily_performance
--      WHERE user_id = '<rep_uuid>' AND work_date = current_date;
--    Expect: is_excluded=true, reason='Fever'.
