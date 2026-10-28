-- Phase 511 - costing lines are quantity x price (owner 2026-10-28).
-- A line = qty (rickshaws) x unit_price. amount = qty x unit_price. For vendor / printing / installation lines the
-- total qty of that type on one quote cannot pass the quote's total rickshaws (sum of quote_cities.qty), so vendor 2
-- can only take what vendor 1 left. 'other' has no cap. Additive; existing rows (0 today) keep qty 1.
ALTER TABLE public.quote_costs ADD COLUMN IF NOT EXISTS qty        numeric(12,2) NOT NULL DEFAULT 1 CHECK (qty > 0);
ALTER TABLE public.quote_costs ADD COLUMN IF NOT EXISTS unit_price numeric(14,2);

CREATE OR REPLACE FUNCTION public.quote_costs_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $g$
DECLARE v_total numeric; v_used numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.quotes q
                  WHERE q.id = NEW.quote_id AND q.segment='GOVERNMENT' AND q.media_type='AUTO_HOOD') THEN
    RAISE EXCEPTION 'Costing is only for Government Auto Hood quotes';
  END IF;
  IF NEW.unit_price IS NOT NULL THEN
    NEW.amount := round(NEW.qty * NEW.unit_price, 2);
  END IF;
  IF NEW.kind IN ('vendor','printing','installation') THEN
    SELECT COALESCE(SUM(c.qty),0) INTO v_total FROM public.quote_cities c WHERE c.quote_id = NEW.quote_id;
    IF v_total > 0 THEN
      SELECT COALESCE(SUM(x.qty),0) INTO v_used FROM public.quote_costs x
       WHERE x.quote_id = NEW.quote_id AND x.kind = NEW.kind AND x.id <> NEW.id;
      IF v_used + NEW.qty > v_total THEN
        RAISE EXCEPTION 'Only % of % are left for this type (already used %)', trim_scale(v_total - v_used), trim_scale(v_total), trim_scale(v_used);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $g$;
REVOKE EXECUTE ON FUNCTION public.quote_costs_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_quote_costs_guard ON public.quote_costs;
CREATE TRIGGER trg_quote_costs_guard BEFORE INSERT OR UPDATE OF quote_id, qty, unit_price, kind, amount ON public.quote_costs
  FOR EACH ROW EXECUTE FUNCTION public.quote_costs_guard();
NOTIFY pgrst, 'reload schema';
