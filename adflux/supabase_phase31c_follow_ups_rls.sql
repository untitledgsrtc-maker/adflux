-- supabase_phase31c_follow_ups_rls.sql
--
-- Phase 31C — fix follow_ups RLS so quote save doesn't blow up.
--
-- Owner reported (9 May 2026): "new row violates row-level security
-- policy for table 'follow_ups'" when saving a quote.
--
-- Root cause: there's a Postgres trigger `auto_create_followup` that
-- fires when a quote.status flips to 'sent' and INSERTs a follow_ups
-- row with assigned_to = NEW.created_by. The trigger runs as the
-- calling user, so it goes through the user's RLS context.
--
-- The Phase 11g policy `fu_sales_own` only allows sales / agency to
-- INSERT — telecaller, sales_manager, and co_owner all get rejected.
-- Phase 28c extended quotes / payments / clients RLS to the broader
-- role set but missed follow_ups. Same pattern, mirroring fix.
--
-- Two-part fix:
--   1. Extend `fu_sales_own` to include telecaller + sales_manager,
--      and make the WITH CHECK clause explicit (defaults vary by
--      Postgres version when only USING is given).
--   2. Mark `auto_create_followup` as SECURITY DEFINER so the
--      auto-insert always succeeds regardless of who saved the quote.
--      Sets the search_path explicitly to neutralise the standard
--      DEFINER-function security warning.
--
-- Idempotent.

-- 1) Broaden the sales-side policy.
DROP POLICY IF EXISTS "fu_sales_own" ON public.follow_ups;
CREATE POLICY "fu_sales_own" ON public.follow_ups FOR ALL
  USING (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND assigned_to = auth.uid()
  )
  WITH CHECK (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND assigned_to = auth.uid()
  );

-- Make sure the admin-side policy also has an explicit WITH CHECK so
-- co_owner saves don't fall through.
DROP POLICY IF EXISTS "fu_admin_all" ON public.follow_ups;
CREATE POLICY "fu_admin_all" ON public.follow_ups FOR ALL
  USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- 2) Make the auto-insert trigger SECURITY DEFINER. Even after the
--    policy widening above, this is the cleaner fix because the
--    trigger is system-owned bookkeeping (auto-creates a sane default
--    follow-up 3 days after a quote is sent). It shouldn't fail
--    because of who happened to click Save.
CREATE OR REPLACE FUNCTION public.auto_create_followup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'sent' AND (OLD.status IS NULL OR OLD.status != 'sent') THEN
    INSERT INTO public.follow_ups (quote_id, assigned_to, follow_up_date, note)
    VALUES (
      NEW.id,
      NEW.created_by,
      (now() + INTERVAL '3 days')::date,
      'Auto follow-up after quote sent'
    );
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT polname, polcmd FROM pg_policy
--  WHERE polrelid = 'public.follow_ups'::regclass;
--   should list fu_admin_all + fu_sales_own (both FOR ALL).
--
-- SELECT prosecdef FROM pg_proc WHERE proname = 'auto_create_followup';
--   should be true (SECURITY DEFINER).
