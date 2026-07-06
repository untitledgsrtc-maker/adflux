-- =====================================================================
-- Phase 209 — Supabase Security Advisor remediation (surgical, safe)
-- 2026-07-06
--
-- Two real holes the advisor surfaced (the dangerous dedupe one was
-- already closed in Phase 207; the 269 warnings are otherwise linter
-- noise on internal trigger fns + already-gated RPCs).
--
-- FIX A — regen_payment_fu_notes: SECURITY DEFINER, granted to
--   authenticated, NO role/ownership gate → any logged-in rep could
--   rewrite payment-reminder note text on any quote (supabase_phase33n).
--   ZERO client callers in src/ or api/ (verified) → the clean fix is a
--   plain REVOKE. postgres/service_role keep it for maintenance.
--
-- FIX B — approve_leave §41 NULL-guard: done in the canonical
--   db/functions/approve_leave.sql (edit-in-place per §71/§72). Run that
--   file too — it's the ONE home for the function. (Listed here for the
--   owner's run-order, not re-defined.)
--
-- Idempotent (REVOKE is). §45-safe: GRANT metadata only, no hot path.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.regen_payment_fu_notes(uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY (both expect false) ──────────────────────────────────────
SELECT
  has_function_privilege('anon',          'public.regen_payment_fu_notes(uuid)', 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', 'public.regen_payment_fu_notes(uuid)', 'EXECUTE') AS auth_can_execute;

SELECT 'Phase 209 regen_payment_fu_notes revoke applied' AS status;
