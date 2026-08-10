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
    -- (won triggers incentive/payment — an owner/admin gate, §6). NOT pinned to
    -- the old value (that would block the normal draft→sent edit); just blocked
    -- from becoming 'won'. The §11b one-way-status trigger still backstops the rest.
    AND status <> 'won'
    -- PIN the true identity/immutable columns to their CURRENT value (MVCC
    -- snapshot in WITH CHECK returns the OLD committed row). All are INSERT-only
    -- or constant-per-wizard in the edit payloads, so a legit edit passes; a
    -- Sales Head cannot move ownership, re-point the lead, or change identity.
    AND created_by   IS NOT DISTINCT FROM (SELECT q.created_by   FROM public.quotes q WHERE q.id = quotes.id)
    AND segment      IS NOT DISTINCT FROM (SELECT q.segment      FROM public.quotes q WHERE q.id = quotes.id)
    AND media_type   IS NOT DISTINCT FROM (SELECT q.media_type   FROM public.quotes q WHERE q.id = quotes.id)
    AND lead_id      IS NOT DISTINCT FROM (SELECT q.lead_id      FROM public.quotes q WHERE q.id = quotes.id)
    AND quote_number IS NOT DISTINCT FROM (SELECT q.quote_number FROM public.quotes q WHERE q.id = quotes.id)
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
