-- =====================================================================
-- Phase 34Z.19 — switch generate_lead_tasks signature to (p_user_id uuid)
-- 14 May 2026
--
-- WHY
--
-- Phase 33T (12 May 2026) rewrote `generate_lead_tasks` from the
-- original Phase 19 `(p_date date)` signature to `(p_user_id uuid)`.
-- Owner reported (14 May 2026) production console still 404'ing on
-- /work load:
--   POST /rest/v1/rpc/generate_lead_tasks 404 (Not Found)
--   "Could not find the function public.generate_lead_tasks(p_user_id)
--    in the schema cache. Perhaps you meant ... (p_date)"
--
-- Diagnosis: Phase 33T was never pasted into Supabase Studio for the
-- staging DB. Only the Phase 19 (p_date) function exists. PostgREST
-- caches the old signature; client now calls with p_user_id; PostgREST
-- has no overload that matches → 404.
--
-- WHAT THIS DOES
--
-- 1. DROP every overload of generate_lead_tasks. Both (p_date date)
--    and any partial/half-applied (p_user_id uuid) variant get
--    cleared. Cascade so dependent triggers (none currently) survive.
-- 2. Re-create the Phase 33T body verbatim with the (p_user_id uuid)
--    signature.
-- 3. Force a PostgREST schema cache reload via NOTIFY pgrst so the
--    new signature is visible to the REST API immediately.
--
-- Idempotent. Re-runnable safely.
-- =====================================================================

-- 1. Drop every overload of the function (date and uuid signatures).
-- -------------------------------------------------------------------------
-- generate_lead_tasks REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/generate_lead_tasks.sql
-- Do NOT re-add it here. To change it, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- 3. Reload PostgREST schema cache so REST API picks up new signature.
NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- After running:
--   * has_uuid_signature  = 1   (new function exists)
--   * has_date_signature  = 0   (old overload dropped)
SELECT
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'generate_lead_tasks'
      AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid') AS has_uuid_signature,
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'generate_lead_tasks'
      AND pg_get_function_identity_arguments(p.oid) = 'p_date date') AS has_date_signature;
