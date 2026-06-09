-- =====================================================================
-- Campaign — Segments (saved, reusable lead audiences)
-- 2026-06-09
--
-- A segment = a named set of filter rules over the existing leads table
-- (stage / heat / source / city / exclude opted-out). The Segments page counts
-- the matching leads live and saves the rule set so you can re-use it (and, in
-- Broadcast/#3, send to it). Rules live in rules_json; the count is a cached
-- convenience (recomputed on the page).
--
-- SAFE (§45): a NEW campaign table. No live-app table touched — the page READS
-- leads (count only) through normal RLS; nothing writes leads. Admin/co_owner
-- only. Idempotent (IF NOT EXISTS + DROP POLICY IF EXISTS).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.campaign_segments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  rules_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_count integer,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_segments ENABLE ROW LEVEL SECURITY;

-- Admin / co_owner full control (config surface, like campaigns).
DROP POLICY IF EXISTS seg_admin_all ON public.campaign_segments;
CREATE POLICY seg_admin_all ON public.campaign_segments
  FOR ALL
  USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'campaign_segments')          AS table_present,  -- 1
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'campaign_segments')             AS policy_count;   -- 1

SELECT 'Campaign segments table applied' AS status;
