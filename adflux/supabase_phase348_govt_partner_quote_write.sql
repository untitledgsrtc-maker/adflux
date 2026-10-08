-- ============================================================================
-- Phase 348 - government partner (Vishal, co_owner) can CREATE / EDIT his OWN
--             GOVERNMENT quotes again.  CLAUDE.md section 152 / 303 follow-up.
-- ============================================================================
-- WHY: Phase 278 (3 Aug 2026) took co_owner out of quotes_admin_all so Vishal
-- could not read PRIVATE data. His only quote WRITE path was that policy, so
-- since then every new Govt proposal he saves fails with
--   "new row violates row-level security policy for table quotes".
-- Section 152 recorded the remedy: a creator-scoped govt-partner write policy.
--
-- SCOPE (deliberately tiny, additive):
--   * quotes        INSERT : he is an active govt partner, created_by = himself,
--                            segment = GOVERNMENT.
--   * quotes        UPDATE : only quotes HE created, GOVERNMENT, not yet won.
--   * quote_cities  INSERT / UPDATE / DELETE : only on such a quote.
--   * NO delete on quotes, NO won (incentive gate stays with admin), NO private
--     rows, NO other rep's rows. quotes_govt_partner_read (SELECT) is unchanged.
--   * The GOVERNMENT media lock (AUTO_HOOD + GSRTC_LED, CHECK
--     quotes_govt_media_check) still applies.
--   * Admin / sales / agency / telecaller / sales head policies are untouched.
-- No policy reads its OWN table (no recursion, section 172c). Idempotent.
-- ============================================================================

DROP POLICY IF EXISTS quotes_govt_partner_insert ON public.quotes;
CREATE POLICY quotes_govt_partner_insert ON public.quotes
  FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid()
               AND u.team_role = 'government_partner'
               AND u.is_active)
    AND created_by = auth.uid()
    AND segment = 'GOVERNMENT'
    AND status <> 'won'
  );

DROP POLICY IF EXISTS quotes_govt_partner_update ON public.quotes;
CREATE POLICY quotes_govt_partner_update ON public.quotes
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid()
               AND u.team_role = 'government_partner'
               AND u.is_active)
    AND created_by = auth.uid()
    AND segment = 'GOVERNMENT'
    AND status <> 'won'
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid()
               AND u.team_role = 'government_partner'
               AND u.is_active)
    AND created_by = auth.uid()
    AND segment = 'GOVERNMENT'
    AND status <> 'won'
  );

DROP POLICY IF EXISTS qc_govt_partner_write ON public.quote_cities;
CREATE POLICY qc_govt_partner_write ON public.quote_cities
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid()
               AND u.team_role = 'government_partner'
               AND u.is_active)
    AND EXISTS (SELECT 1 FROM public.quotes q
                 WHERE q.id = quote_cities.quote_id
                   AND q.created_by = auth.uid()
                   AND q.segment = 'GOVERNMENT'
                   AND q.status <> 'won')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid()
               AND u.team_role = 'government_partner'
               AND u.is_active)
    AND EXISTS (SELECT 1 FROM public.quotes q
                 WHERE q.id = quote_cities.quote_id
                   AND q.created_by = auth.uid()
                   AND q.segment = 'GOVERNMENT'
                   AND q.status <> 'won')
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect 3 rows (quotes insert, quotes update, quote_cities write).
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname='public'
--    AND policyname IN ('quotes_govt_partner_insert','quotes_govt_partner_update','qc_govt_partner_write')
--  ORDER BY tablename, policyname;
--
-- UNDO (back to read-only, Phase 278 state):
-- DROP POLICY IF EXISTS quotes_govt_partner_insert ON public.quotes;
-- DROP POLICY IF EXISTS quotes_govt_partner_update ON public.quotes;
-- DROP POLICY IF EXISTS qc_govt_partner_write ON public.quote_cities;
