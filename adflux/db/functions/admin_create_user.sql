-- ============================================================================
-- db/functions/admin_create_user.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place admin_create_user lives (§71). Was in phase66 + phase109.
-- WHAT: provisions a user — creates the auth.users row (bcrypt pw) if absent +
--   upserts public.users. Powers Team→Add Member + HR→Add Member.
-- 🔒 LOCKED (security — the §109 HR-login widen):
--   • Caller gate WITH NULL short-circuit: `v_caller_role IS NULL OR NOT IN
--     ('admin','co_owner','hr')` (the §41 guard — keep the IS NULL arm).
--   • PRIVILEGE CEILING — an `hr` caller CANNOT mint `admin`/`co_owner`
--     (`IF v_caller_role='hr' AND p_role IN ('admin','co_owner') THEN RAISE`).
--     Removing this lets HR self-escalate. KEEP IT.
--   • Existing auth.users row is REUSED (id kept, password NOT overwritten).
--   • public.users upsert preserves designation/city/signature/manager/segment
--     via COALESCE on conflict.
-- PROVENANCE: live dump 2026-06-24 (phase109 body). SECURITY DEFINER +
--   search_path public,extensions,auth. SUPERSEDES the phase66 caller-check
--   (if phase66 is ever re-run, re-run THIS file after it — §109 note).
-- SUPERSEDES: supabase_phase66_admin_create_user.sql · supabase_phase109_hr_login.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_user(p_email text, p_password text, p_name text, p_role text, p_team_role text, p_designation text DEFAULT NULL::text, p_signature_mobile text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_segment_access text DEFAULT 'PRIVATE'::text, p_manager_id uuid DEFAULT NULL::uuid, p_allow_ta boolean DEFAULT false, p_allow_da boolean DEFAULT false, p_allow_hotel boolean DEFAULT false, p_allow_other boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth'
AS $function$
DECLARE
  v_caller_role text;
  v_email_l     text;
  v_uid         uuid;
  v_existing    record;
BEGIN
  -- Caller must be admin / co_owner / hr.
  SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'co_owner', 'hr') THEN
    RAISE EXCEPTION 'permission denied: admin / co_owner / hr only';
  END IF;

  -- Privilege ceiling: HR onboards staff but cannot mint admins /
  -- co-owners. Only an existing admin / co_owner can create those.
  IF v_caller_role = 'hr' AND p_role IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'permission denied: HR cannot create admin / co_owner accounts';
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
END $function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: LIKE '%v_caller_role IS NULL OR%' (null guard) AND
--         '%HR cannot create admin%' (mint ceiling) — both TRUE.
