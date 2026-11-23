-- =============================================================================
-- Phase 656 · Sales head daily checklist (2026-11-23, owner-approved)
--
-- One row per hand-ticked item per day (9:50 morning meeting, old callbacks,
-- 1 PM / 4 PM team checks, Team Evening tips). Auto items (team checked in,
-- approvals cleared, evening reports shared) are read live, not stored.
-- RLS: the head writes/reads his own rows; admin + co_owner read all (to see
-- whether the routine is followed). New table only, nothing existing touched.
-- Safe to re-run.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.head_checklist (
  user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day      date NOT NULL,
  item     text NOT NULL,
  done_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, item)
);
ALTER TABLE public.head_checklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS head_checklist_self ON public.head_checklist;
CREATE POLICY head_checklist_self ON public.head_checklist
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS head_checklist_admin_read ON public.head_checklist;
CREATE POLICY head_checklist_admin_read ON public.head_checklist
  FOR SELECT USING ((SELECT public.get_my_role()) IN ('admin', 'co_owner'));

GRANT SELECT, INSERT, DELETE ON public.head_checklist TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT count(*) FROM pg_policies WHERE tablename = 'head_checklist';   -- 2
