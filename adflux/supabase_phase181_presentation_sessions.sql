-- ============================================================================
-- Phase 181 — presentation_sessions (in-app GSRTC deck timer)
-- ============================================================================
-- After a rep logs a field meeting they tap "Start Presentation" → the deck
-- opens IN-APP + a stopwatch runs → "End" writes the elapsed time here.
-- Shown on the lead timeline + the rep's My Performance log.
--
-- DELIBERATELY a STANDALONE table, NOT a lead_activities row:
--   * lead_activities has AFTER-INSERT triggers (compute_daily_score,
--     lead_activity_bump_counter, auto_heat). Writing a presentation there
--     would fire that whole chain on every "End" (§45 hot-path) and risk the
--     §33 meeting-counter / score (§34Z.66). Keeping it separate = ZERO touch
--     to the frozen sales contracts, ZERO incentive/score impact.
-- Additive only (§45): new table, new RLS, no existing object altered.
-- Idempotent (§8): IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.presentation_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id),
  lead_id          uuid REFERENCES public.leads(id),
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  duration_seconds integer,
  source           text DEFAULT 'meeting',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- columns are added defensively in case the table pre-exists from a partial run
ALTER TABLE public.presentation_sessions ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id);
ALTER TABLE public.presentation_sessions ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.presentation_sessions ADD COLUMN IF NOT EXISTS duration_seconds integer;
ALTER TABLE public.presentation_sessions ADD COLUMN IF NOT EXISTS source text DEFAULT 'meeting';

CREATE INDEX IF NOT EXISTS ps_user_started_idx ON public.presentation_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ps_lead_idx        ON public.presentation_sessions (lead_id);

ALTER TABLE public.presentation_sessions ENABLE ROW LEVEL SECURITY;

-- Rep: full access to OWN rows only (start, end, read own log).
DROP POLICY IF EXISTS ps_self_all ON public.presentation_sessions;
CREATE POLICY ps_self_all ON public.presentation_sessions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admin + co_owner: read/manage all (operational data, segment-blind per §8
-- layer 2 — this is NOT financial/P&L; mirrors fu_admin_all / gps_pings_admin_all).
DROP POLICY IF EXISTS ps_admin_all ON public.presentation_sessions;
CREATE POLICY ps_admin_all ON public.presentation_sessions
  FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY (expected results)
--   table_present     = 1
--   rls_enabled       = true
--   policy_count      = 2   (ps_self_all + ps_admin_all)
--   index_count       = 2   (ps_user_started_idx + ps_lead_idx)
-- ============================================================================
-- SELECT count(*) AS table_present FROM information_schema.tables
--   WHERE table_schema='public' AND table_name='presentation_sessions';
-- SELECT relrowsecurity AS rls_enabled FROM pg_class
--   WHERE oid='public.presentation_sessions'::regclass;
-- SELECT count(*) AS policy_count FROM pg_policies
--   WHERE schemaname='public' AND tablename='presentation_sessions';
-- SELECT count(*) AS index_count FROM pg_indexes
--   WHERE schemaname='public' AND tablename='presentation_sessions'
--     AND indexname IN ('ps_user_started_idx','ps_lead_idx');
