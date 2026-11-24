-- supabase_phase680_hr_edit_member.sql (24-11-2026)
--
-- Bug: HR (Riya) opens Team -> Edit Member, changes a name, taps Save and gets
-- "Cannot coerce the result to a single JSON object". HR can only READ public.users
-- (no update policy), so the update touched 0 rows.
--
-- Fix: hr_update_member() lets HR change the everyday details of a staff member:
-- name, designation, WhatsApp, signature mobile, city, WhatsApp Business flag.
-- Role, segment, agency commission and signer stay admin-only (they change access
-- and pay). HR cannot edit admin / co_owner accounts. Same guard shape as
-- set_user_active (Phase 667). Function only; no table, policy or trigger change.

CREATE OR REPLACE FUNCTION public.hr_update_member(
  p_user_id          uuid,
  p_name             text,
  p_designation      text,
  p_whatsapp_number  text,
  p_signature_mobile text,
  p_city             text,
  p_wa_business      boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller text := public.get_my_role();
  v_target text;
BEGIN
  IF v_caller IS NULL OR v_caller NOT IN ('admin', 'co_owner', 'hr') THEN
    RAISE EXCEPTION 'Only admin / co_owner / HR can edit team members' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  SELECT role INTO v_target FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_caller = 'hr' AND v_target IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'HR cannot edit this account' USING ERRCODE = '42501';
  END IF;
  UPDATE public.users SET
    name             = btrim(p_name),
    designation      = NULLIF(btrim(p_designation), ''),
    whatsapp_number  = NULLIF(btrim(p_whatsapp_number), ''),
    signature_mobile = NULLIF(btrim(p_signature_mobile), ''),
    city             = NULLIF(btrim(p_city), ''),
    wa_business      = COALESCE(p_wa_business, false)
  WHERE id = p_user_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.hr_update_member(uuid, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hr_update_member(uuid, text, text, text, text, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect fn_exists = 1, anon_can_run = false
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'hr_update_member') AS fn_exists,
  has_function_privilege('anon', 'public.hr_update_member(uuid, text, text, text, text, text, boolean)', 'EXECUTE') AS anon_can_run;
