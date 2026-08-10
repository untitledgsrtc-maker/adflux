-- =====================================================================
-- Sales Head — MANAGER module, P1c: EDIT ANY QUOTE (2026-08-07)
-- Owner-approved. Spec: docs/SALES_HEAD_MANAGER_SPEC.md §4 P1 item 2.
-- =====================================================================
-- Lets a Sales Head (is_sales_head=true) READ + EDIT any rep's quote through
-- the EXISTING wizard code (no frozen-wizard changes) — additive RLS only.
--
-- DELIVERY CHOICE (pinned RLS, not a broad write): these policies are gated
-- on public.is_sales_head() (fail-closed, only Jayna) so a normal rep's
-- quotes_sales_own / qc_sales_own access is BYTE-UNCHANGED (permissive OR).
-- The WITH CHECK PINS the immutable/identity columns (the exact
-- users_self_update_avatar lockdown pattern, §172) so a Sales Head can only
-- edit CONTENT — she can NOT: flip status (→ won = incentive), move ownership
-- (created_by), re-point the lead (lead_id), or change segment/media/number.
-- A WON quote is off-limits (USING status <> 'won'). She gets NO insert / NO
-- delete on quotes (edit only — she can't create or delete a cross-owner quote).
-- Prerequisite: supabase_sales_head_manager_p1.sql (defines is_sales_head()).
-- =====================================================================

-- DEFINER pin-checker — reads the OLD quote bypassing RLS so the edit policy's
-- WITH CHECK does NOT self-query quotes (a correlated self-subquery trips the RLS
-- recursion guard on EVERY quotes UPDATE — the 2026-08-10 live regression;
-- see supabase_sales_head_manager_p1c_recursion_hotfix.sql). Returns whether every
-- immutable NEW value matches the stored one; NULL row → true.
CREATE OR REPLACE FUNCTION public.sh_quote_unchanged(
  p_id uuid, p_created_by uuid, p_segment text, p_media text, p_lead uuid, p_qnum text
) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT p_created_by IS NOT DISTINCT FROM q.created_by
       AND p_segment    IS NOT DISTINCT FROM q.segment
       AND p_media      IS NOT DISTINCT FROM q.media_type
       AND p_lead       IS NOT DISTINCT FROM q.lead_id
       AND p_qnum       IS NOT DISTINCT FROM q.quote_number
    FROM public.quotes q WHERE q.id = p_id
  ), true)
$$;
GRANT EXECUTE ON FUNCTION public.sh_quote_unchanged(uuid,uuid,text,text,uuid,text) TO authenticated;

-- ── quotes: read any, edit CONTENT of any non-won quote ──
DROP POLICY IF EXISTS quotes_sales_head_read ON public.quotes;
CREATE POLICY quotes_sales_head_read ON public.quotes
  FOR SELECT
  USING (public.is_sales_head());

DROP POLICY IF EXISTS quotes_sales_head_edit ON public.quotes;
CREATE POLICY quotes_sales_head_edit ON public.quotes
  FOR UPDATE
  USING (public.is_sales_head() AND status <> 'won')
  WITH CHECK (
    public.is_sales_head()
    -- status: she may edit + move a quote through non-won stages (the wizards
    -- legitimately promote draft→sent on edit), but can NEVER mark it 'won'
    -- (won triggers incentive/payment — an owner/admin gate, §6).
    AND status <> 'won'
    -- Pin the identity/immutable columns via the DEFINER checker (NOT a self-
    -- subquery — that recurses, §hotfix). She cannot move ownership, re-point
    -- the lead, or change segment/media/number.
    AND public.sh_quote_unchanged(id, created_by, segment, media_type, lead_id, quote_number)
  );

-- ── quote_cities: read any; the wizard's city-replace (delete+insert) only
--    on a non-won parent quote ──
DROP POLICY IF EXISTS qc_sales_head_read ON public.quote_cities;
CREATE POLICY qc_sales_head_read ON public.quote_cities
  FOR SELECT
  USING (public.is_sales_head());

DROP POLICY IF EXISTS qc_sales_head_insert ON public.quote_cities;
CREATE POLICY qc_sales_head_insert ON public.quote_cities
  FOR INSERT
  WITH CHECK (
    public.is_sales_head()
    AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_cities.quote_id AND q.status <> 'won')
  );

DROP POLICY IF EXISTS qc_sales_head_delete ON public.quote_cities;
CREATE POLICY qc_sales_head_delete ON public.quote_cities
  FOR DELETE
  USING (
    public.is_sales_head()
    AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_cities.quote_id AND q.status <> 'won')
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY: 5 new policies present + the edit policy pins is_sales_head + status
SELECT
  (SELECT count(*) FROM pg_policies WHERE tablename='quotes'
     AND policyname IN ('quotes_sales_head_read','quotes_sales_head_edit'))              AS quote_policies,
  (SELECT count(*) FROM pg_policies WHERE tablename='quote_cities'
     AND policyname IN ('qc_sales_head_read','qc_sales_head_insert','qc_sales_head_delete')) AS qc_policies,
  (SELECT with_check LIKE '%status%' AND with_check LIKE '%created_by%'
     FROM pg_policies WHERE tablename='quotes' AND policyname='quotes_sales_head_edit')  AS edit_pins_status_owner;
