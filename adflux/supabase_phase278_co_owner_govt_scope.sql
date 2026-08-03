-- =====================================================================
-- Phase 278 — scope co_owner (Vishal, government_partner) to GOVERNMENT
-- on quotes / quote_cities / payments / follow_ups / pdf_share_tokens.
-- 2026-08-03
--
-- The *_admin_all RLS policies on these 5 tables included co_owner (and a dead
-- 'owner' role, §8), so Vishal (role=co_owner, team_role=government_partner —
-- meant to be GOVERNMENT-only per §42) could read ALL-segment PRIVATE quotes,
-- line-items, payments, follow-ups, and PDF share tokens via the normal client
-- query — bypassing the team-RPC gate entirely (the §150 RPC fix was only
-- partial). Confirmed live via pg_policies 2026-08-03 (all 5 listed co_owner).
--
-- FIX (owner decision 2026-08-03: READ-ONLY for Vishal on GOVERNMENT):
--   • *_admin_all → admin ONLY (drop co_owner + dead 'owner'). Admin keeps full
--     read+write on BOTH segments (WITH CHECK defaults to USING → admin writes).
--   • + a *_govt_partner_read SELECT policy per table, scoped to GOVERNMENT,
--     mirroring the existing leads_govt_partner_read (§42, phase12:397). Vishal
--     SEES govt quotes/payments/etc but cannot edit/approve/delete them; PRIVATE
--     is fully hidden. (LEADS already work this way.)
--
-- The users-EXISTS (government_partner) is a stable per-query subquery Postgres
-- hoists to an InitPlan → for every NON-partner user it short-circuits false, so
-- the per-row segment subquery never runs → zero hot-path cost (§45). Only the
-- admin/co_owner surface moves; sales-own / creator / other policies untouched.
-- Idempotent (DROP POLICY IF EXISTS then CREATE). §8.
-- =====================================================================

-- ---- QUOTES (has its own segment column) -----------------------------------
DROP POLICY IF EXISTS quotes_admin_all         ON public.quotes;
CREATE POLICY quotes_admin_all ON public.quotes FOR ALL
  USING (public.get_my_role() = 'admin');
DROP POLICY IF EXISTS quotes_govt_partner_read ON public.quotes;
CREATE POLICY quotes_govt_partner_read ON public.quotes FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'government_partner')
    AND segment = 'GOVERNMENT'
  );

-- ---- QUOTE_CITIES (child of quotes → segment via quote_id) ------------------
DROP POLICY IF EXISTS qc_admin_all          ON public.quote_cities;
CREATE POLICY qc_admin_all ON public.quote_cities FOR ALL
  USING (public.get_my_role() = 'admin');
DROP POLICY IF EXISTS qc_govt_partner_read  ON public.quote_cities;
CREATE POLICY qc_govt_partner_read ON public.quote_cities FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'government_partner')
    AND EXISTS (SELECT 1 FROM public.quotes q
                 WHERE q.id = quote_cities.quote_id AND q.segment = 'GOVERNMENT')
  );

-- ---- PAYMENTS (child of quotes) --------------------------------------------
DROP POLICY IF EXISTS payments_admin_all         ON public.payments;
CREATE POLICY payments_admin_all ON public.payments FOR ALL
  USING (public.get_my_role() = 'admin');
DROP POLICY IF EXISTS payments_govt_partner_read ON public.payments;
CREATE POLICY payments_govt_partner_read ON public.payments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'government_partner')
    AND EXISTS (SELECT 1 FROM public.quotes q
                 WHERE q.id = payments.quote_id AND q.segment = 'GOVERNMENT')
  );

-- ---- FOLLOW_UPS (lead-tied OR quote-tied) ----------------------------------
DROP POLICY IF EXISTS fu_admin_all         ON public.follow_ups;
CREATE POLICY fu_admin_all ON public.follow_ups FOR ALL
  USING (public.get_my_role() = 'admin');
DROP POLICY IF EXISTS fu_govt_partner_read ON public.follow_ups;
CREATE POLICY fu_govt_partner_read ON public.follow_ups FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'government_partner')
    AND (
      EXISTS (SELECT 1 FROM public.quotes q
               WHERE q.id = follow_ups.quote_id AND q.segment = 'GOVERNMENT')
      OR EXISTS (SELECT 1 FROM public.leads l
                  WHERE l.id = follow_ups.lead_id AND l.segment = 'GOVERNMENT')
    )
  );

-- ---- PDF_SHARE_TOKENS (child of quotes) ------------------------------------
DROP POLICY IF EXISTS pdf_share_tokens_admin_all         ON public.pdf_share_tokens;
CREATE POLICY pdf_share_tokens_admin_all ON public.pdf_share_tokens FOR ALL
  USING (public.get_my_role() = 'admin');
DROP POLICY IF EXISTS pdf_share_tokens_govt_partner_read ON public.pdf_share_tokens;
CREATE POLICY pdf_share_tokens_govt_partner_read ON public.pdf_share_tokens FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = auth.uid() AND u.team_role = 'government_partner')
    AND EXISTS (SELECT 1 FROM public.quotes q
                 WHERE q.id = pdf_share_tokens.quote_id AND q.segment = 'GOVERNMENT')
  );

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Expect: NO 'co_owner'/'owner' in any *_admin_all qual (all = 'admin' only);
-- 5 *_govt_partner_read policies present (one per table).
SELECT tablename, policyname, cmd, qual
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('quotes','quote_cities','payments','follow_ups','pdf_share_tokens')
  AND  (policyname LIKE '%admin_all%' OR policyname LIKE '%govt_partner%')
ORDER  BY tablename, policyname;
