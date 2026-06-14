-- =====================================================================
-- PHASE 153 — flip 3 advisor-flagged views to security_invoker
-- 2026-06-14
--
-- Supabase advisor (CRITICAL ×3): leads_needing_geocode,
-- lead_phone_duplicates, push_failures are SECURITY DEFINER views, each
-- with GRANT SELECT TO authenticated. A SECURITY DEFINER view reads its
-- base tables with the VIEW OWNER's privileges (postgres → BYPASSRLS),
-- so ANY logged-in user can query them via PostgREST and read:
--   * leads_needing_geocode / lead_phone_duplicates → every rep's lead
--     phone / company / assignee, bypassing the per-rep RLS on `leads`
--   * push_failures → admin-only push logs, bypassing the admin/co_owner
--     RLS on `push_log`
--
-- FIX: security_invoker = on → the view reads base tables with the
-- QUERYING role's privileges → the existing RLS applies:
--   * a rep sees only their own leads (or zero push rows)
--   * admin / co_owner still sees everything
--   * the only SQL reader, dedupe_all_phone_groups() (SECURITY DEFINER),
--     runs as postgres → still sees all phone groups → UNCHANGED.
--
-- Additive + reversible (SET security_invoker = off restores the old
-- behaviour). No view body change, no column change, grants preserved.
-- Zero frontend / edge-function consumers (verified 2026-06-14). Run in
-- the NEW project (app.untitledad.in — the team's live app).
-- =====================================================================

ALTER VIEW public.leads_needing_geocode SET (security_invoker = on);
ALTER VIEW public.lead_phone_duplicates SET (security_invoker = on);
ALTER VIEW public.push_failures         SET (security_invoker = on);

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — each row's reloptions must contain {security_invoker=on} ─
SELECT relname, reloptions
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('leads_needing_geocode','lead_phone_duplicates','push_failures')
ORDER BY relname;
