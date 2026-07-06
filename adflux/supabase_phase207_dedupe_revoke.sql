-- =====================================================================
-- Phase 207 — close the dedupe privilege-escalation hole (§67)
-- 2026-07-06
--
-- BUG: dedupe_all_phone_groups() and dedupe_phone_lead_group(text) are
--   SECURITY DEFINER (run as owner, bypass RLS) and do
--   UPDATE leads SET stage='Lost' across the WHOLE company. Phase 34v
--   GRANTed EXECUTE to `authenticated`, so ANY logged-in rep could call
--   rpc('dedupe_all_phone_groups') and mass-mark every lead Lost.
--
-- FIX: REVOKE EXECUTE from PUBLIC + authenticated on both. They are
--   admin-only maintenance functions run by hand in Supabase Studio
--   (no runtime caller in src/ or api/ — verified), so postgres /
--   service_role keep EXECUTE and nothing in the app breaks.
--
-- Additive + reversible (re-GRANT to restore). Idempotent.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.dedupe_all_phone_groups()        FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.dedupe_phone_lead_group(text)    FROM PUBLIC, authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — neither proacl may grant EXECUTE to authenticated/PUBLIC ─
-- Expect: authenticated_can_execute = false for BOTH rows.
SELECT
  p.proname,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute  -- expect false
FROM pg_proc p
WHERE p.proname IN ('dedupe_all_phone_groups', 'dedupe_phone_lead_group')
ORDER BY p.proname;

SELECT 'Phase 207 dedupe REVOKE applied' AS status;
