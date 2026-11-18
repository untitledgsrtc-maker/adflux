-- Phase 612 — Only admin may delete a quote after Draft (owner 18-11-2026).
-- Before: any role could delete a quote in any status except Won (Phase 11b/74 rule).
-- Now (quotes_no_delete_after_draft, now matching its name):
--   * Won with payment rows: blocked for everyone (unchanged)
--   * any status other than draft: admin only (co_owner and reps can delete drafts only)
--   * draft: any role whose RLS lets them delete it (unchanged)
--   * no signed-in user (SQL / service role / cron): allowed (unchanged behaviour for cleanups)
-- Every delete that goes through is still copied to quote_delete_log (Phase 611).

CREATE OR REPLACE FUNCTION public.quotes_no_delete_after_draft()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role     text;
  v_has_pay  boolean;
BEGIN
  SELECT public.get_my_role() INTO v_role;

  -- Won-with-payments is the hard floor for every role (bank credit <-> quote <-> payment trail).
  IF OLD.status = 'won' THEN
    SELECT EXISTS (SELECT 1 FROM public.payments WHERE quote_id = OLD.id) INTO v_has_pay;
    IF v_has_pay THEN
      RAISE EXCEPTION
        'Quote % is Won and has payment rows. Delete the payments first, then this quote.',
        OLD.quote_number
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Phase 612: after Draft only admin may delete. SQL / service role (no user) passes.
  IF auth.uid() IS NOT NULL AND COALESCE(OLD.status, 'draft') <> 'draft' AND v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION
      'Quote % is % - only admin can delete a quote after Draft. Mark it Lost instead.',
      OLD.quote_number, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END $function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: the function now carries the Phase 612 rule (must be true)
SELECT position('only admin can delete a quote after Draft' in pg_get_functiondef('public.quotes_no_delete_after_draft'::regproc)) > 0 AS rule_live;
