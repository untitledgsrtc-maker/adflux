-- ============================================================================
-- supabase_phase323_m20_lead_activities_rls.sql   (Phase 323, audit M20)
-- lead_activities SELECT/write RLS: rewrite `lead_id IN (SELECT id FROM leads)`
-- as a correlated EXISTS. lead_activities is one of the hottest tables (a row per
-- call / meeting / note); the IN form materializes the caller's ENTIRE visible-
-- lead id-set + re-runs the full leads RLS stack per query. The EXISTS lets the
-- planner PK-probe leads per row instead.
--
-- SEMANTICALLY IDENTICAL (row set unchanged):
--   • non-null lead_id: both ask "is this lead visible to me" — both subqueries
--     run under the caller's own leads RLS, so the visible activity set is the same.
--   • null lead_id: excluded by BOTH (`NULL IN (...)` = NULL; `l.id = NULL` = false).
-- The sibling `lead_activities_admin_all` (admin) is UNTOUCHED. Idempotent.
--
-- ⚠ FROZEN §28/§40 (lead_activities RLS = the hottest table). RUN THE SHADOW BELOW
-- FIRST and confirm 0 mismatches, then run the DROP+CREATE, then smoke-test that a
-- rep sees their own call/meeting/note history and an admin sees all (app check —
-- Studio has no JWT). On modern Postgres the IN-subquery is often already planned
-- as a semi-join, so the real speed-up can be modest — this is a low-risk, correct
-- cleanup, not a dramatic win.
-- ============================================================================

-- ---------- SHADOW (run FIRST, read-only) — must return mismatches = 0 ----------
-- Proves `lead_id IN (SELECT id FROM leads)` and the correlated EXISTS pick the
-- SAME lead_activities rows over the real data (Studio = postgres role, both
-- predicates see all leads → any logical difference surfaces here).
--   SELECT count(*) AS mismatches
--   FROM public.lead_activities la
--   WHERE (la.lead_id IN (SELECT id FROM public.leads))
--         IS DISTINCT FROM
--         EXISTS (SELECT 1 FROM public.leads l WHERE l.id = la.lead_id);

-- ---------- THE CHANGE (run after the shadow = 0) ----------
DROP POLICY IF EXISTS "lead_activities_via_lead" ON public.lead_activities;
CREATE POLICY "lead_activities_via_lead" ON public.lead_activities FOR ALL
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_activities.lead_id));

NOTIFY pgrst, 'reload schema';

-- VERIFY the policy is in place with the new qual:
--   SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
--   WHERE polname = 'lead_activities_via_lead';   -- -> EXISTS ( SELECT 1 FROM leads l WHERE ...)
