-- =====================================================================
-- Phase 34Z.21 — enforce users.segment_access on leads INSERT/UPDATE
-- 14 May 2026
--
-- WHY
--
-- Owner reported (14 May 2026): "He has private media only, but still
-- he can add in government lead." The JSX form was showing both
-- Government + Private radio pills to a PRIVATE-only rep. Phase 34Z.21
-- (JSX) hides the pill they can't use, but the REST API still accepts
-- the row if anyone bypasses the UI. This trigger closes the gap.
--
-- WHAT THIS DOES
--
-- BEFORE INSERT / UPDATE trigger on public.leads checks that the
-- creator's users.segment_access permits the lead's segment:
--   • ALL                → any segment
--   • PRIVATE            → only PRIVATE leads
--   • GOVERNMENT         → only GOVERNMENT leads
--   • NULL (legacy rows) → treat as ALL
--
-- Admin / co_owner / agency / sales_manager are unconditionally
-- allowed (they're cross-segment by design — CLAUDE.md §8 rule 1).
--
-- Idempotent. Re-runnable.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.leads_enforce_segment_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text;
  v_access   text;
BEGIN
  -- Pull role + segment_access for the row's creator. created_by is
  -- preferred (set by JSX); fall back to auth.uid() so direct-REST
  -- writes are also gated.
  SELECT u.role, u.segment_access
    INTO v_role, v_access
    FROM public.users u
   WHERE u.id = COALESCE(NEW.created_by, auth.uid());

  -- Admin / co_owner / agency / sales_manager bypass.
  IF v_role IN ('admin', 'co_owner', 'agency', 'sales_manager') THEN
    RETURN NEW;
  END IF;

  -- NULL access = treat as ALL (legacy compatibility).
  IF v_access IS NULL OR v_access = 'ALL' THEN
    RETURN NEW;
  END IF;

  -- Reject mismatches.
  IF NEW.segment IS NOT NULL AND NEW.segment <> v_access THEN
    RAISE EXCEPTION
      'Segment access denied — your profile is restricted to % leads, this row is %.',
      v_access, NEW.segment
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_segment_access_ins ON public.leads;
CREATE TRIGGER trg_leads_segment_access_ins
  BEFORE INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.leads_enforce_segment_access();

DROP TRIGGER IF EXISTS trg_leads_segment_access_upd ON public.leads;
CREATE TRIGGER trg_leads_segment_access_upd
  BEFORE UPDATE OF segment ON public.leads
  FOR EACH ROW
  WHEN (OLD.segment IS DISTINCT FROM NEW.segment)
  EXECUTE FUNCTION public.leads_enforce_segment_access();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Both should return 1 after the run.
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_leads_segment_access_ins') AS insert_trigger,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_leads_segment_access_upd') AS update_trigger;
