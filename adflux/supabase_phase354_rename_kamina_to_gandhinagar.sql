-- ============================================================================
-- Phase 354 - rename account "Kamina Thakor" -> "Gandhinagar", new login email, salary 0
-- ============================================================================
-- WHY (owner request 2026-10-09): "just change name from kamina to gandhinagar,
-- email gandhinagar@untitledad.in, salary 0". Same account (same id, same password, same
-- history); only the label, the login email and the monthly salary change.
--
-- WHAT CHANGES (one user, id 551dc7ce-0ce1-428b-8953-5e170f6b2c5a):
--   public.users.name / .email                       Kamina Thakor / kamina@untitledad.in
--   auth.users.email + raw_user_meta_data            -> login email + display name
--   auth.identities.identity_data (email provider)   -> keeps login in step (identities.email is generated)
--   public.staff_incentive_profiles.monthly_salary   18000 -> 0   (audited by trg_salary_audit_sip)
-- Nothing else is touched: role stays 'sales', password unchanged, no payouts exist for this user.
-- The user must sign in with the NEW email from now on (same password).
--
-- SAFE: backup of every touched value in public._bak_rename_p354 (RLS on, no policies; KEEP 30 days,
-- then DROP TABLE). Guarded: aborts unless the account is exactly as expected; re-run after success = no-op.
--
-- UNDO:
--   UPDATE public.users u SET name=b.old_name, email=b.old_email FROM public._bak_rename_p354 b WHERE b.user_id=u.id;
--   UPDATE auth.users a SET email=b.old_auth_email, raw_user_meta_data=b.old_auth_meta, updated_at=now() FROM public._bak_rename_p354 b WHERE b.user_id=a.id;
--   UPDATE auth.identities i SET identity_data=b.old_identity_data, updated_at=now() FROM public._bak_rename_p354 b WHERE b.user_id=i.user_id AND i.provider='email';
--   UPDATE public.staff_incentive_profiles s SET monthly_salary=b.old_monthly_salary FROM public._bak_rename_p354 b WHERE b.user_id=s.user_id;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public._bak_rename_p354 (
  user_id             uuid PRIMARY KEY,
  bak_at              timestamptz NOT NULL DEFAULT now(),
  old_name            text,
  old_email           text,
  old_auth_email      text,
  old_auth_meta       jsonb,
  old_identity_data   jsonb,
  old_monthly_salary  numeric
);
ALTER TABLE public._bak_rename_p354 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bak_rename_p354 FROM PUBLIC, anon, authenticated;

DO $p354$
DECLARE
  v_uid   constant uuid := '551dc7ce-0ce1-428b-8953-5e170f6b2c5a';
  v_email constant text := 'gandhinagar@untitledad.in';
  v_name  constant text := 'Gandhinagar';
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND email = v_email AND name = v_name) THEN
    RAISE NOTICE 'Phase 354: already applied - nothing to do';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND email = 'kamina@untitledad.in') THEN
    RAISE EXCEPTION 'Phase 354 aborted: account % is not in the expected state', v_uid;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email AND id <> v_uid)
     OR EXISTS (SELECT 1 FROM public.users WHERE lower(email) = v_email AND id <> v_uid) THEN
    RAISE EXCEPTION 'Phase 354 aborted: % is already used by another account', v_email;
  END IF;

  INSERT INTO public._bak_rename_p354
         (user_id, old_name, old_email, old_auth_email, old_auth_meta, old_identity_data, old_monthly_salary)
  SELECT u.id, u.name, u.email, a.email, a.raw_user_meta_data,
         (SELECT i.identity_data FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'),
         (SELECT s.monthly_salary FROM public.staff_incentive_profiles s WHERE s.user_id = u.id)
    FROM public.users u JOIN auth.users a ON a.id = u.id
   WHERE u.id = v_uid
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.users SET name = v_name, email = v_email WHERE id = v_uid;

  UPDATE auth.users
     SET email = v_email,
         raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('email', v_email, 'name', v_name),
         updated_at = now()
   WHERE id = v_uid;

  UPDATE auth.identities
     SET identity_data = identity_data || jsonb_build_object('email', v_email, 'name', v_name),
         updated_at = now()
   WHERE user_id = v_uid AND provider = 'email';

  UPDATE public.staff_incentive_profiles SET monthly_salary = 0 WHERE user_id = v_uid;
END
$p354$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only): expect name=Gandhinagar, both emails = gandhinagar@untitledad.in, identity_email same,
-- salary=0, role=sales, backup_rows=1 (old values kept there), old_salary=18000
SELECT u.name, u.email, a.email AS auth_email,
       (SELECT i.email FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email') AS identity_email,
       u.role, u.is_active,
       (SELECT s.monthly_salary FROM public.staff_incentive_profiles s WHERE s.user_id = u.id) AS salary_now,
       (SELECT count(*) FROM public._bak_rename_p354 WHERE user_id = u.id) AS backup_rows,
       (SELECT old_monthly_salary FROM public._bak_rename_p354 WHERE user_id = u.id) AS old_salary_in_backup
  FROM public.users u JOIN auth.users a ON a.id = u.id
 WHERE u.id = '551dc7ce-0ce1-428b-8953-5e170f6b2c5a';
