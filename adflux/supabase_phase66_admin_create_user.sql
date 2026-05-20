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

CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email          text,
  p_password       text,
  p_name           text,
  p_role           text,
  p_team_role      text,
  p_designation    text DEFAULT NULL,
  p_signature_mobile text DEFAULT NULL,
  p_city           text DEFAULT NULL,
  p_segment_access text DEFAULT 'PRIVATE',
  p_manager_id     uuid DEFAULT NULL,
  p_allow_ta       boolean DEFAULT false,
  p_allow_da       boolean DEFAULT false,
  p_allow_hotel    boolean DEFAULT false,
  p_allow_other    boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_caller_role text;
  v_email_l     text;
  v_uid         uuid;
  v_existing    record;
BEGIN
  -- Caller must be admin or co_owner.
  SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'permission denied: admin / co_owner only';
  END IF;

  IF COALESCE(BTRIM(p_email),    '') = '' THEN RAISE EXCEPTION 'email required'; END IF;
  IF COALESCE(BTRIM(p_password), '') = '' THEN RAISE EXCEPTION 'password required'; END IF;
  IF length(p_password) < 4 THEN RAISE EXCEPTION 'password must be at least 4 chars'; END IF;

  v_email_l := LOWER(BTRIM(p_email));

  -- If auth.users row exists, reuse its id + skip insert. Password
  -- is NOT overwritten — use Studio Auth UI to change.
  SELECT id INTO v_uid FROM auth.users WHERE email = v_email_l;

  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current,
      phone_change_token, reauthentication_token,
      created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_anonymous, is_sso_user
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_uid, 'authenticated', 'authenticated', v_email_l,
      crypt(p_password, gen_salt('bf')),
      now(),
      '', '', '', '', '', '', '',
      now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', p_name, 'email', v_email_l, 'email_verified', true),
      false, false
    );
  END IF;

  -- Upsert public.users.
  INSERT INTO public.users (
    id, email, name, role, team_role, designation,
    signature_mobile, city, is_active, segment_access,
    manager_id,
    allow_ta, allow_da, allow_hotel, allow_other
  )
  VALUES (
    v_uid, v_email_l, p_name, p_role, p_team_role, p_designation,
    p_signature_mobile, p_city, true, p_segment_access,
    p_manager_id,
    COALESCE(p_allow_ta, false),
    COALESCE(p_allow_da, false),
    COALESCE(p_allow_hotel, false),
    COALESCE(p_allow_other, true)
  )
  ON CONFLICT (id) DO UPDATE
    SET role             = EXCLUDED.role,
        team_role        = EXCLUDED.team_role,
        designation      = COALESCE(EXCLUDED.designation, public.users.designation),
        signature_mobile = COALESCE(EXCLUDED.signature_mobile, public.users.signature_mobile),
        city             = COALESCE(EXCLUDED.city, public.users.city),
        is_active        = true,
        segment_access   = COALESCE(EXCLUDED.segment_access, public.users.segment_access),
        manager_id       = COALESCE(EXCLUDED.manager_id, public.users.manager_id),
        allow_ta         = EXCLUDED.allow_ta,
        allow_da         = EXCLUDED.allow_da,
        allow_hotel      = EXCLUDED.allow_hotel,
        allow_other      = EXCLUDED.allow_other;

  RETURN jsonb_build_object(
    'id',    v_uid,
    'email', v_email_l
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_create_user(text, text, text, text, text, text, text, text, text, uuid, boolean, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text, text, text, text, text, uuid, boolean, boolean, boolean, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'admin_create_user RPC ready' AS status;
