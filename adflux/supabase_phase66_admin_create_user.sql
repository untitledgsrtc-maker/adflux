-- supabase_phase66_admin_create_user.sql
--
-- Phase 66 (21 May 2026) — admin one-shot user creation RPC.
--
-- Owner directive: "HR will add user". Today HRNewUserV2 form only
-- inserts public.users + crashes because it sends 'phone' column
-- (which doesn't exist — should be signature_mobile). And there's
-- no password field — admin had to open Supabase Studio Auth UI
-- to set a login password manually.
--
-- This RPC fixes both:
--   1. Creates auth.users row with bcrypt-hashed password + email
--      confirmed (no confirmation email needed).
--   2. Creates matching public.users row with same id.
--   3. Phase 64 trigger fires on the public.users insert → profile
--      auto-created from designation salary.
--
-- Auth: only admin / co_owner can call. RLS would block direct
-- INSERT INTO auth.users from anon, hence the RPC SECURITY DEFINER
-- wrapper. The caller-role check inside the body keeps it safe
-- against an anon key being smuggled into a client.
--
-- Idempotent: returns the existing row's id if the email already
-- exists. Password is NOT updated on conflict (admin must use the
-- Studio Auth UI to change a password — keeps this RPC append-only).

-- -------------------------------------------------------------------------
-- admin_create_user REMOVED from this file (Phase 178). Canonical: db/functions/admin_create_user.sql
-- Do NOT re-add (§71). Trigger/grant wiring stays.
-- -------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_create_user(text, text, text, text, text, text, text, text, text, uuid, boolean, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text, text, text, text, text, uuid, boolean, boolean, boolean, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'admin_create_user RPC ready' AS status;
