-- supabase_phase109_3_rename_hr_email.sql
-- Phase 109.3 (2026-06-01) — fix HR login email typo: roya@ → riya@.
--
-- The email lives in TWO places that must stay in sync:
--   1. auth.users.email          → the LOGIN email (Supabase Auth)
--   2. public.users.email        → the app profile email
-- (+ auth.identities, if an email-provider identity row exists.)
--
-- This renames all of them by USER ID, so the password + id are
-- UNCHANGED — every existing row tied to her (staff_incentive_profiles,
-- daily_targets, etc.) stays valid. After this she logs in with the NEW
-- email and the SAME password. A direct UPDATE skips the email-change
-- confirmation flow (admin rename, no email sent to the fake inbox).
--
-- Run ONCE in Supabase Studio → SQL Editor. Idempotent: re-running after
-- the rename is a no-op (the old email no longer matches).

DO $$
DECLARE
  v_old text := 'roya@untitledad.in';
  v_new text := 'riya@untitledad.in';
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = v_old;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'No auth user with email % — nothing to rename (already done?).', v_old;
    RETURN;
  END IF;

  -- 1. Login identity (auth.users) + the email mirrored in user metadata.
  UPDATE auth.users
     SET email = v_new,
         raw_user_meta_data = jsonb_set(
           COALESCE(raw_user_meta_data, '{}'::jsonb), '{email}', to_jsonb(v_new), true)
   WHERE id = v_uid;

  -- 2. Email-provider identity row, if one exists (harmless no-op if not).
  UPDATE auth.identities
     SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new), true)
   WHERE user_id = v_uid
     AND provider = 'email';

  -- 3. App profile (public.users).
  UPDATE public.users
     SET email = v_new
   WHERE id = v_uid;

  RAISE NOTICE 'Renamed % -> % for user %.', v_old, v_new, v_uid;
END $$;


-- VERIFY — expect exactly 1 row, both emails = riya@untitledad.in:
SELECT a.email AS auth_login_email,
       u.email AS profile_email,
       u.name,
       u.role
  FROM auth.users a
  JOIN public.users u ON u.id = a.id
 WHERE lower(a.email) = 'riya@untitledad.in';
