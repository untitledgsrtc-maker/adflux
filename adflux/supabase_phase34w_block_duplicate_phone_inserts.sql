-- =====================================================================
-- Phase 34W — block duplicate-phone lead inserts at the DB level
-- 13 May 2026
--
-- WHY
--
-- Frontend dedup at insert time (Phase 33D.6 findLeadByPhone) is
-- enforced in every lead-creating surface today:
--   * LogMeetingModal      — phone-first lookup, type-time + save-time
--   * LeadFormV2           — blur-time + save-time
--   * LeadUploadV2 (CSV)   — per-row check against existingPhones Set
--
-- But Phase 34V cleanup found seven historical duplicates for a
-- single phone, proving rows had slipped through (legacy, programmatic
-- inserts, network-race double-tap, edge cases). Owner asked to
-- guarantee "no repeat lead ever added again".
--
-- This migration adds a BEFORE INSERT trigger that does the same
-- phone lookup the frontend does, BUT only rejects when there's an
-- existing OPEN lead with that phone (stage NOT IN 'Won', 'Lost').
-- The Lost/Won case is allowed because:
--   * A Lost lead may be re-engaged later — rep wants a fresh row.
--   * A Won deal still allows new leads for the same client (renewal
--     scenarios use a different code path, but a manual re-add is
--     legit).
--
-- WHAT IT DOES
--
-- 1. BEFORE INSERT trigger `trg_leads_block_dup_phone` on leads.
--    Computes the normalized digits of NEW.phone. If any existing
--    lead row has the same normalized digits AND a non-terminal
--    stage, raises a friendly exception that contains the canonical
--    lead's ID so the frontend can deep-link.
--
-- 2. New helper function `find_open_lead_id_by_phone(phone)` returning
--    just the uuid of the canonical open lead for a phone, or null.
--    Frontend uses this for the type-time hint (cheaper than the
--    multi-field find_lead_by_phone).
--
-- Idempotent. Frontend keeps doing what it does today; this is a
-- safety net for paths that bypass it.
-- =====================================================================

-- ─── 1. Helper: find_open_lead_id_by_phone ──────────────────────────
CREATE OR REPLACE FUNCTION public.find_open_lead_id_by_phone(p_phone text)
RETURNS uuid
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_bare   text;
  v_key    text;
  v_id     uuid;
BEGIN
  IF length(v_digits) < 10 THEN RETURN NULL; END IF;
  v_bare := CASE WHEN length(v_digits) = 12 AND v_digits LIKE '91%' THEN substring(v_digits, 3) ELSE v_digits END;
  v_key  := CASE WHEN length(v_digits) = 10 THEN '91' || v_digits ELSE v_digits END;

  SELECT id INTO v_id
    FROM public.leads
   WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN (v_digits, v_key, v_bare)
     AND stage NOT IN ('Won', 'Lost')
   ORDER BY created_at ASC
   LIMIT 1;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_open_lead_id_by_phone(text) TO authenticated;


-- ─── 2. Trigger: block duplicate-phone inserts ──────────────────────
CREATE OR REPLACE FUNCTION public.leads_block_dup_phone()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_existing uuid;
BEGIN
  -- No phone on the new row → nothing to dedup.
  IF NEW.phone IS NULL OR length(regexp_replace(NEW.phone, '\D', '', 'g')) < 10 THEN
    RETURN NEW;
  END IF;

  -- Find any OPEN lead (stage not terminal) with same phone.
  v_existing := public.find_open_lead_id_by_phone(NEW.phone);

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION
      'Phone % is already in an open lead (id %). Open that lead instead, or mark it Lost first before re-adding.',
      NEW.phone, v_existing
      USING HINT = 'Frontend phone-dedup should have caught this — see Phase 33D.6 findLeadByPhone.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_block_dup_phone ON public.leads;
CREATE TRIGGER trg_leads_block_dup_phone
  BEFORE INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.leads_block_dup_phone();


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc
    WHERE proname='find_open_lead_id_by_phone') AS helper_exists,
  (SELECT count(*) FROM pg_proc
    WHERE proname='leads_block_dup_phone') AS trigger_fn_exists,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname='trg_leads_block_dup_phone') AS trigger_exists;
