-- =====================================================================
-- Phase 208 — reps report their installed app version; show it on the
--             team-dashboard card (so admin sees who's on which APK)
-- 2026-07-06
--
-- WHY
--   No column stored a rep's installed app version, so the admin had no
--   way to see who updated to the new APK. This adds a self-report +
--   surfaces it on each rep card on /team-dashboard.
--
-- WHAT
--   • 3 additive nullable columns on users (no existing code reads them).
--   • set_my_app_version(text,int) — the ONLY writer. SECURITY DEFINER so
--     it can update the users row past the Phase 97.1 self-update column
--     pin, but it writes ONLY the caller's OWN 3 version columns (never
--     role / segment / anything else) → no privilege escalation.
--   • The client (AppUpdateBanner, mounted for every role in V2AppShell)
--     calls it on app open: native → real "0.96.14" + versionCode;
--     web/PWA → 'web'.
--
-- SAFE (§45): additive columns nothing else touches; the RPC writes only
--   the caller's own version fields; no hot-path trigger; no frozen
--   contract. §41 fail-closed: NULL auth.uid() → no-op.
--
-- Idempotent. Owner also re-runs supabase_phase193_team_dashboard_gated.sql
-- (its reps select gained app_version) IF the Jayna-style viewer should
-- see versions too — the admin view needs only THIS file.
-- =====================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS app_version      text,
  ADD COLUMN IF NOT EXISTS app_version_code integer,
  ADD COLUMN IF NOT EXISTS app_version_at   timestamptz;

CREATE OR REPLACE FUNCTION public.set_my_app_version(p_version text, p_code integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;                       -- §41 fail-closed: no session → no write
  END IF;
  UPDATE public.users
     SET app_version      = LEFT(COALESCE(p_version, ''), 24),
         app_version_code = p_code,
         app_version_at   = now()
   WHERE id = v_uid;              -- OWN row only — never another user
END $$;

REVOKE EXECUTE ON FUNCTION public.set_my_app_version(text, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_my_app_version(text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- cols present (3) + fn is SECURITY DEFINER + only self-executable path.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'users'
       AND column_name IN ('app_version','app_version_code','app_version_at'))  AS cols_present,        -- 3
  (SELECT prosecdef FROM pg_proc WHERE proname = 'set_my_app_version' LIMIT 1)  AS is_security_definer, -- t
  has_function_privilege('authenticated', 'public.set_my_app_version(text,integer)', 'EXECUTE') AS auth_can_execute; -- t

SELECT 'Phase 208 app-version report applied' AS status;
