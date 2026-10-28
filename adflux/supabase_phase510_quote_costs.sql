-- Phase 510 - Govt Auto Hood costing per deal (owner 2026-10-26).
-- Cost lines typed on the proposal page (vendor, printing, installation, other).
-- finance_pnl_summary deducts them from Business Profit (edited in place in
-- supabase_finance_p3_rpcs.sql, the canonical). Additive: with no cost lines the P&L is identical.
-- Admin + accounts write; co_owner (government partner) reads GOVERNMENT only (section 152).

CREATE TABLE IF NOT EXISTS public.quote_costs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'vendor' CHECK (kind IN ('vendor','printing','installation','other')),
  vendor      text,
  note        text,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  cost_date   date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_costs_quote ON public.quote_costs(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_costs_date  ON public.quote_costs(cost_date);

-- Only a GOVERNMENT Auto Hood quote may carry costing lines.
CREATE OR REPLACE FUNCTION public.quote_costs_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $g$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.quotes q
                  WHERE q.id = NEW.quote_id AND q.segment='GOVERNMENT' AND q.media_type='AUTO_HOOD') THEN
    RAISE EXCEPTION 'Costing is only for Government Auto Hood quotes';
  END IF;
  RETURN NEW;
END $g$;
REVOKE EXECUTE ON FUNCTION public.quote_costs_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_quote_costs_guard ON public.quote_costs;
CREATE TRIGGER trg_quote_costs_guard BEFORE INSERT OR UPDATE OF quote_id ON public.quote_costs
  FOR EACH ROW EXECUTE FUNCTION public.quote_costs_guard();

ALTER TABLE public.quote_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_costs_admin_accounts ON public.quote_costs;
CREATE POLICY quote_costs_admin_accounts ON public.quote_costs FOR ALL
  USING (public.get_my_role() IN ('admin','accounts'))
  WITH CHECK (public.get_my_role() IN ('admin','accounts'));
DROP POLICY IF EXISTS quote_costs_govt_partner_read ON public.quote_costs;
CREATE POLICY quote_costs_govt_partner_read ON public.quote_costs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.team_role = 'government_partner')
         AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_costs.quote_id AND q.segment = 'GOVERNMENT'));
REVOKE ALL ON public.quote_costs FROM anon;

-- Cost source for the P&L (same shape idea as finance_crm_income_rows). Internal: finance_pnl_summary
-- calls it as owner, so no client grant.
CREATE OR REPLACE FUNCTION public.finance_quote_cost_rows(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_seg text DEFAULT NULL
) RETURNS TABLE(segment text, media_type text, company text, amount numeric, txn_date date)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $c$
  SELECT q.segment, q.media_type, 'Untitled Advertising'::text, c.amount, c.cost_date
    FROM public.quote_costs c
    JOIN public.quotes q ON q.id = c.quote_id
   WHERE q.segment = 'GOVERNMENT' AND q.media_type = 'AUTO_HOOD'
     AND (p_from IS NULL OR c.cost_date >= p_from)
     AND (p_to   IS NULL OR c.cost_date <= p_to)
     AND (p_seg  IS NULL OR q.segment = p_seg);
$c$;
REVOKE EXECUTE ON FUNCTION public.finance_quote_cost_rows(date,date,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finance_quote_cost_rows(date,date,text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT to_regclass('public.quote_costs') IS NOT NULL AS table_ok,
--        (SELECT count(*) FROM pg_policies WHERE tablename='quote_costs') AS policies,   -- 2
--        has_function_privilege('anon','public.finance_quote_cost_rows(date,date,text)','execute') AS anon_can; -- false
