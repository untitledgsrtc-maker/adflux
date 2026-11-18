-- Phase 618 — HR hiring card: owner salary approval gate + login details on the offer
-- (owner approved design 19-11-2026, docs/superpowers/specs/2026-11-18-hr-hiring-card-design.md).
-- * Approver = role admin only (co_owner / hr never). An admin-created offer is approved on save.
-- * No offer can be marked sent, opened or accepted until approved.
-- * From sent onward salary / role / login details are locked (cancel + new offer to change).
-- * Editing those fields on an approved offer (non-admin) drops it back to pending_approval.
-- * Legacy rows (20 converted, 4 accepted) are untouched: the guard only checks transitions.
-- ADDITIVE: new nullable columns, a widened status CHECK, 2 new triggers, fetch_offer_by_token WHERE.

ALTER TABLE public.hr_offers
  ADD COLUMN IF NOT EXISTS approved_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at    timestamptz,
  ADD COLUMN IF NOT EXISTS approval_note  text,
  ADD COLUMN IF NOT EXISTS manager_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS segment_access text,
  ADD COLUMN IF NOT EXISTS allow_ta       boolean,
  ADD COLUMN IF NOT EXISTS allow_da       boolean,
  ADD COLUMN IF NOT EXISTS allow_hotel    boolean,
  ADD COLUMN IF NOT EXISTS allow_other    boolean,
  ADD COLUMN IF NOT EXISTS min_calls      integer,
  ADD COLUMN IF NOT EXISTS min_quotes     integer,
  ADD COLUMN IF NOT EXISTS min_followups  integer,
  ADD COLUMN IF NOT EXISTS candidate_id   uuid REFERENCES public.hr_candidates(id) ON DELETE SET NULL;

ALTER TABLE public.hr_offers DROP CONSTRAINT IF EXISTS hr_offers_segment_access_check;
ALTER TABLE public.hr_offers ADD CONSTRAINT hr_offers_segment_access_check
  CHECK (segment_access IS NULL OR segment_access IN ('PRIVATE','GOVERNMENT','ALL'));

ALTER TABLE public.hr_offers DROP CONSTRAINT IF EXISTS hr_offers_status_check;
ALTER TABLE public.hr_offers ADD CONSTRAINT hr_offers_status_check
  CHECK (status IN ('draft','pending_approval','approved','sent','filled','accepted','converted_to_user','cancelled'));

-- ---------------------------------------------------------------- guard
CREATE OR REPLACE FUNCTION public.hr_offer_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_role  text := public.get_my_role();
  v_admin boolean := COALESCE(public.get_my_role() = 'admin', false);
  v_terms_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_admin THEN
      IF NEW.status IN ('draft','pending_approval','approved') THEN NEW.status := 'approved'; END IF;
      NEW.approved_by := auth.uid(); NEW.approved_at := now();
    ELSIF auth.uid() IS NOT NULL THEN
      IF NEW.status NOT IN ('draft','pending_approval') THEN
        RAISE EXCEPTION 'A new offer must go to the owner for approval first.' USING ERRCODE = 'check_violation';
      END IF;
      NEW.approved_by := NULL; NEW.approved_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  v_terms_changed := ROW(NEW.fixed_salary_monthly, NEW.incentive_sales_multiplier, NEW.incentive_new_client_rate,
                         NEW.incentive_renewal_rate, NEW.incentive_flat_bonus, NEW.position, NEW.designation_name,
                         NEW.designation_auth_role, NEW.designation_team_role, NEW.joining_date, NEW.manager_id,
                         NEW.segment_access, NEW.allow_ta, NEW.allow_da, NEW.allow_hotel, NEW.allow_other,
                         NEW.min_calls, NEW.min_quotes, NEW.min_followups)
     IS DISTINCT FROM ROW(OLD.fixed_salary_monthly, OLD.incentive_sales_multiplier, OLD.incentive_new_client_rate,
                         OLD.incentive_renewal_rate, OLD.incentive_flat_bonus, OLD.position, OLD.designation_name,
                         OLD.designation_auth_role, OLD.designation_team_role, OLD.joining_date, OLD.manager_id,
                         OLD.segment_access, OLD.allow_ta, OLD.allow_da, OLD.allow_hotel, OLD.allow_other,
                         OLD.min_calls, OLD.min_quotes, OLD.min_followups);

  -- terms are locked once the link has gone out
  IF v_terms_changed AND OLD.status IN ('sent','filled','accepted','converted_to_user') THEN
    RAISE EXCEPTION 'The offer is already sent. Cancel it and make a new one to change the terms.' USING ERRCODE = 'check_violation';
  END IF;

  -- only an admin records an approval
  IF NOT v_admin THEN
    NEW.approved_by := OLD.approved_by; NEW.approved_at := OLD.approved_at;
  END IF;
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Only the owner can approve an offer.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_by := auth.uid(); NEW.approved_at := now();
  END IF;

  -- a non-admin change to approved terms needs a fresh approval
  IF v_terms_changed AND NOT v_admin AND NEW.status = 'approved' THEN
    NEW.status := 'pending_approval'; NEW.approved_by := NULL; NEW.approved_at := NULL;
  END IF;
  -- sent back / pulled back: approval no longer stands
  IF NEW.status IN ('draft','pending_approval') AND OLD.status = 'approved' THEN
    NEW.approved_by := NULL; NEW.approved_at := NULL;
  END IF;

  IF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent' AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'The owner has not approved this offer yet.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('filled','accepted') AND OLD.status IN ('draft','pending_approval') THEN
    RAISE EXCEPTION 'This offer is not ready yet' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.hr_offer_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hr_offer_guard ON public.hr_offers;
CREATE TRIGGER trg_hr_offer_guard
  BEFORE INSERT OR UPDATE ON public.hr_offers
  FOR EACH ROW EXECUTE FUNCTION public.hr_offer_guard();

-- ---------------------------------------------------------------- pushes
CREATE OR REPLACE FUNCTION public.hr_offer_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE r record; v_body text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  IF NOT COALESCE(public.is_push_allowed_now(), false) THEN RETURN NULL; END IF;
  v_body := COALESCE(NEW.candidate_name,'-') || ' · ' || COALESCE(NEW.designation_name, NEW.position, '-')
            || ' · Rs ' || to_char(COALESCE(NEW.fixed_salary_monthly,0), 'FM99,99,99,990') || '/month';
  IF NEW.status = 'pending_approval' THEN
    FOR r IN SELECT id FROM public.users WHERE role = 'admin' AND is_active LOOP
      PERFORM public.enqueue_push(r.id, 'Offer needs your approval', v_body, '/hr/offers?offer=' || NEW.id::text, 'hro-' || NEW.id::text);
    END LOOP;
  ELSIF NEW.status = 'approved' AND TG_OP = 'UPDATE' AND NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM NEW.approved_by THEN
    PERFORM public.enqueue_push(NEW.created_by, 'Offer approved - share the link', v_body, '/hr/offers?offer=' || NEW.id::text, 'hroa-' || NEW.id::text);
  ELSIF NEW.status = 'draft' AND TG_OP = 'UPDATE' AND OLD.status = 'pending_approval' AND NEW.created_by IS NOT NULL THEN
    PERFORM public.enqueue_push(NEW.created_by, 'Offer sent back by the owner', COALESCE(NULLIF(NEW.approval_note,''), v_body), '/hr/offers?offer=' || NEW.id::text, 'hrob-' || NEW.id::text);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'hr_offer_notify failed (ignored): %', SQLERRM;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.hr_offer_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hr_offer_notify ON public.hr_offers;
CREATE TRIGGER trg_hr_offer_notify
  AFTER INSERT OR UPDATE OF status ON public.hr_offers
  FOR EACH ROW EXECUTE FUNCTION public.hr_offer_notify();

-- ---------------------------------------------------------------- public link: not before approval
CREATE OR REPLACE FUNCTION public.fetch_offer_by_token(p_token uuid)
 RETURNS TABLE(id uuid, status text, candidate_name text, candidate_email text, "position" text, territory text, joining_date date, fixed_salary_monthly numeric, incentive_text text, incentive_sales_multiplier numeric, incentive_new_client_rate numeric, incentive_renewal_rate numeric, incentive_flat_bonus numeric, place text, template_id uuid, offer_pdf_url text, accepted_terms_at timestamp with time zone, full_legal_name text, fathers_name text, dob date, mobile text, personal_email text, address_line1 text, address_line2 text, city text, district text, state text, pincode text, pan_number text, aadhaar_number text, qualification text, bank_account_number text, bank_name text, bank_ifsc text, emergency_contact_name text, emergency_contact_phone text, emergency_contact_rel text, designation_auth_role text, designation_team_role text, designation_has_incentive boolean, designation_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    id, status, candidate_name, candidate_email, "position", territory,
    joining_date, fixed_salary_monthly, incentive_text,
    incentive_sales_multiplier, incentive_new_client_rate,
    incentive_renewal_rate, incentive_flat_bonus,
    place, template_id, offer_pdf_url, accepted_terms_at,
    full_legal_name,
    -- B-pii (5 Oct 2026): the open link no longer returns the candidate's personal
    -- details. NULL placeholders keep the 41-column shape + order identical.
    NULL::text, NULL::date, NULL::text, NULL::text,
    NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
    NULL::text, NULL::text, NULL::text,
    NULL::text, NULL::text, NULL::text,
    NULL::text, NULL::text, NULL::text,
    designation_auth_role, designation_team_role,
    designation_has_incentive, designation_name
  FROM public.hr_offers
  WHERE invite_token = p_token
    AND status NOT IN ('cancelled','draft','pending_approval')   -- Phase 618: not before owner approval
  LIMIT 1;
$function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_offers'
     AND column_name IN ('approved_by','approved_at','approval_note','manager_id','segment_access','allow_ta','allow_da','allow_hotel','allow_other','min_calls','min_quotes','min_followups','candidate_id')) AS new_cols_13,
  (SELECT position('pending_approval' in pg_get_constraintdef(oid)) > 0 FROM pg_constraint WHERE conname='hr_offers_status_check') AS status_check_ok,
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_hr_offer_guard','trg_hr_offer_notify')) AS triggers_2,
  (SELECT position('pending_approval' in pg_get_functiondef('public.fetch_offer_by_token'::regproc)) > 0) AS link_gate_ok;
