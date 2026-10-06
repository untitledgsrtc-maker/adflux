-- =====================================================================
-- db/functions/get_lead_quote.sql  -  THE CANONICAL HOME (section 71/72)
-- Phase 344 (2026-10-06): the CURRENT OWNER of a lead can open + send the PRIVATE
-- quote that hangs off that lead, even though a different person created the quote.
--
-- WHY: quotes RLS shows a sales / telecaller rep only the quotes she CREATED
--   (quotes_sales_own: created_by = auth.uid()). When a lead is reassigned the quote
--   stays with its creator, so the new owner pressed "View quote" and got
--   "Quote not found" (owner report 2026-10-06: lead Anee Marcom -> Rima, quote by
--   Brijesh). 34 quotes in the fleet (16 live) had this gap.
--
-- WHY A FUNCTION AND NOT A POLICY: a broad SELECT policy on quotes is per-USER, not
--   per-PAGE (sections 84 / 116). It would change what EVERY RLS-reliant query returns
--   for the new owner - the /quotes list, totals, Co-Pilot, search, the day summary.
--   So no policy on quotes / quote_cities / payments / leads / users is added or
--   changed. The new owner reads ONE quote through this gated function only.
--
-- CONTRACT (frozen - do NOT regress):
--   * is_lead_quote_owner(quote_id): TRUE only for an ACTIVE sales / agency / telecaller
--     with segment_access ALL or PRIVATE who CURRENTLY owns the lead the PRIVATE quote
--     hangs off (leads.telecaller_id OR leads.assigned_to). The lead is read LIVE:
--     nothing is copied onto the quote, so a later reassign removes access by itself.
--     It is the ONE definition of "who may open this quote because of the lead" and is
--     used by get_lead_quote AND by the two pdf_share_tokens policies (phase 344 file).
--   * get_lead_quote(ref): ONE quote (uuid or quote_number) as jsonb in the same nested
--     shape as select('*, quote_cities(*)') PLUS its approved payments PLUS a view_only
--     flag, or NULL. NULL means "not found OR not yours" (no existence oracle).
--   * SELECT only. Never changes created_by (created_by drives the incentive, so it is
--     NEVER touched). Fires no trigger.
--   * Strips govt_commission_percent. Payments are a WHITELIST (amount, mode, date, is_final,
--     approval_status only) - no UTR, notes, TDS, commission or received/approved-by names.
--   * authenticated may EXECUTE; anon and PUBLIC may not.
--   * Foot-gun: a NEW sensitive column on quotes is returned automatically (denylist).
--     Review this function when quotes gains a column.
--   * Foot-gun: do NOT create quote-keyed follow-ups for the new owner (section 324).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_lead_quote_owner(p_quote_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT p_quote_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.is_active = true
              AND u.role IN ('sales', 'agency', 'telecaller')
              AND COALESCE(u.segment_access, 'ALL') IN ('ALL', 'PRIVATE'))
     AND EXISTS (
           SELECT 1
             FROM public.quotes q
             JOIN public.leads  l ON l.id = q.lead_id
            WHERE q.id = p_quote_id
              AND q.segment = 'PRIVATE'
              AND (l.telecaller_id = auth.uid() OR l.assigned_to = auth.uid()));
$fn$;

CREATE OR REPLACE FUNCTION public.get_lead_quote(p_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_q   public.quotes%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR v_ref = '' THEN
    RETURN NULL;
  END IF;

  -- same two lookup shapes useQuotes.fetchQuoteById accepts
  IF v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_q FROM public.quotes q WHERE q.id = v_ref::uuid;
  ELSE
    SELECT * INTO v_q FROM public.quotes q WHERE q.quote_number = v_ref;
  END IF;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- the ONE access definition (also used by the pdf_share_tokens policies)
  IF NOT public.is_lead_quote_owner(v_q.id) THEN
    RETURN NULL;
  END IF;

  RETURN (to_jsonb(v_q) - 'govt_commission_percent')
    || jsonb_build_object(
         'view_only', (v_q.created_by IS DISTINCT FROM v_uid),
         'quote_cities', COALESCE(
            (SELECT jsonb_agg(to_jsonb(qc))
               FROM public.quote_cities qc
              WHERE qc.quote_id = v_q.id), '[]'::jsonb),
         -- APPROVED payments only, WHITELISTED columns (security review 2026-10-06): the new
         -- lead owner needs paid / balance / is_final, NOT another rep's UTR, bank notes,
         -- TDS, commission or who received/approved it. Same totals maths, nothing else.
         'payments', COALESCE(
            (SELECT jsonb_agg(
                      jsonb_build_object(
                        'id',               p.id,
                        'quote_id',         p.quote_id,
                        'amount_received',  p.amount_received,
                        'payment_mode',     p.payment_mode,
                        'payment_date',     p.payment_date,
                        'is_final_payment', p.is_final_payment,
                        'approval_status',  p.approval_status,
                        'created_at',       p.created_at)
                      ORDER BY p.payment_date DESC, p.created_at DESC)
               FROM public.payments p
              WHERE p.quote_id = v_q.id
                AND p.approval_status = 'approved'), '[]'::jsonb)
       );
END;
$fn$;


-- Phase 344: the WhatsApp inbox "Send quote" picker lists a chat's lead quotes with a direct
-- read (created_by = me), so a lead owner who did not create the quote saw an EMPTY list.
-- This returns id / number / total / status of the quotes she may open - same gate, no oracle
-- (a lead she does not own just returns []). Merged client-side with the direct read.
CREATE OR REPLACE FUNCTION public.get_lead_quotes_brief(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', q.id, 'quote_number', q.quote_number,
           'total_amount', q.total_amount, 'status', q.status) ORDER BY q.created_at DESC), '[]'::jsonb)
    FROM (SELECT id, quote_number, total_amount, status, created_at
            FROM public.quotes
           WHERE lead_id = p_lead_id
             AND public.is_lead_quote_owner(id)
           ORDER BY created_at DESC
           LIMIT 20) q;
$fn$;

COMMENT ON FUNCTION public.get_lead_quotes_brief(uuid) IS
  'Phase 344: brief list of the PRIVATE quotes on a lead the caller currently owns (same gate as get_lead_quote). [] when none / not hers.';

COMMENT ON FUNCTION public.is_lead_quote_owner(uuid) IS
  'Phase 344: single definition of who may open/send a PRIVATE quote because they currently own its lead. Used by get_lead_quote and the pdf_share_tokens lead-owner policies.';
COMMENT ON FUNCTION public.get_lead_quote(text) IS
  'Phase 344: read-only single-quote read for the CURRENT owner of the quote''s lead (PRIVATE only). NULL = not found / not yours. Never widen quotes RLS instead.';

REVOKE ALL ON FUNCTION public.is_lead_quote_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_lead_quote(text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_lead_quotes_brief(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_lead_quote_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_lead_quote(text)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_lead_quotes_brief(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY / TRIPWIRE (read-only; every column must be TRUE)
-- =====================================================================
-- SELECT
--   to_regprocedure('public.get_lead_quote(text)')       IS NOT NULL                                              AS fn_rpc_exists,
--   to_regprocedure('public.is_lead_quote_owner(uuid)')  IS NOT NULL                                              AS fn_helper_exists,
--   to_regprocedure('public.get_lead_quotes_brief(uuid)') IS NOT NULL AND NOT has_function_privilege('anon','public.get_lead_quotes_brief(uuid)','EXECUTE') AS brief_fn_ok,
--   (SELECT bool_and(p.prosecdef) FROM pg_proc p WHERE p.oid IN ('public.get_lead_quote(text)'::regprocedure, 'public.is_lead_quote_owner(uuid)'::regprocedure)) AS both_definer,
--   NOT has_function_privilege('anon', 'public.get_lead_quote(text)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.is_lead_quote_owner(uuid)', 'EXECUTE')                       AS anon_locked,
--   has_function_privilege('authenticated', 'public.get_lead_quote(text)', 'EXECUTE')
--     AND has_function_privilege('authenticated', 'public.is_lead_quote_owner(uuid)', 'EXECUTE')                  AS authenticated_ok,
--   pg_get_functiondef('public.is_lead_quote_owner(uuid)'::regprocedure) LIKE '%telecaller_id = auth.uid()%'
--     AND pg_get_functiondef('public.is_lead_quote_owner(uuid)'::regprocedure) LIKE '%assigned_to = auth.uid()%'
--     AND pg_get_functiondef('public.is_lead_quote_owner(uuid)'::regprocedure) LIKE '%is_active = true%'
--     AND pg_get_functiondef('public.is_lead_quote_owner(uuid)'::regprocedure) LIKE '%''PRIVATE''%'              AS gate_text_intact,
--   pg_get_functiondef('public.get_lead_quote(text)'::regprocedure) LIKE '%is_lead_quote_owner%'
--     AND pg_get_functiondef('public.get_lead_quote(text)'::regprocedure) LIKE '%WHITELISTED%'
--     AND pg_get_functiondef('public.get_lead_quote(text)'::regprocedure) NOT LIKE '%to_jsonb(p)%'
--     AND pg_get_functiondef('public.get_lead_quote(text)'::regprocedure) LIKE '%IS DISTINCT FROM v_uid%'        AS rpc_text_intact,
--   NOT EXISTS (SELECT 1 FROM pg_policies
--                WHERE schemaname = 'public' AND tablename IN ('quotes', 'quote_cities', 'payments', 'leads', 'users')
--                  AND (COALESCE(qual, '') || COALESCE(with_check, '')) ILIKE '%is_lead_quote_owner%')            AS no_policy_widening_on_quote_tables;

-- =====================================================================
-- ROLLBACK (no data touched). Soft kill-switch, no deploy needed:
--   REVOKE EXECUTE ON FUNCTION public.get_lead_quote(text) FROM authenticated;
--   (the page then falls back to today's "Quote not found")
-- Hard rollback: drop the two pdf_share_tokens policies (phase 344 share file) FIRST, then
--   DROP FUNCTION IF EXISTS public.get_lead_quotes_brief(uuid);
--   DROP FUNCTION IF EXISTS public.get_lead_quote(text);
--   DROP FUNCTION IF EXISTS public.is_lead_quote_owner(uuid);
-- =====================================================================
