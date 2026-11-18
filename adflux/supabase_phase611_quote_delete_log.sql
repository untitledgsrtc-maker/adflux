-- Phase 611 — Quote delete log: WHO deleted which quote, WHEN, with a full copy (owner 18-11-2026).
-- Why: nothing recorded quote deletes. Any role may delete a quote in any status except Won
--   (quotes_no_delete_after_draft blocks Won-with-payments for all, Won for non-admin).
-- BEFORE DELETE trigger (fires after quotes_block_delete, alphabetical) keeps a jsonb copy of the
-- quote row + its quote_cities lines (still present before the cascade). A blocked delete rolls the
-- log row back with it. deleted_by = signed-in user (NULL = system / SQL). Read-only for clients.

CREATE TABLE IF NOT EXISTS public.quote_delete_log (
  id           bigserial PRIMARY KEY,
  quote_id     uuid NOT NULL,
  quote_number text,
  status       text,
  segment      text,
  client       text,
  total_amount numeric,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  lead_id      uuid,
  deleted_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at   timestamptz NOT NULL DEFAULT now(),
  quote_row    jsonb NOT NULL,
  lines        jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS quote_delete_log_by_day ON public.quote_delete_log (deleted_by, deleted_at);
CREATE INDEX IF NOT EXISTS quote_delete_log_creator ON public.quote_delete_log (created_by);

CREATE OR REPLACE FUNCTION public.quote_delete_log_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.quote_delete_log
    (quote_id, quote_number, status, segment, client, total_amount, created_by, lead_id, deleted_by, quote_row, lines)
  VALUES (OLD.id, OLD.quote_number, OLD.status, OLD.segment,
          COALESCE(NULLIF(OLD.client_company,''), OLD.client_name), OLD.total_amount,
          OLD.created_by, OLD.lead_id, auth.uid(), to_jsonb(OLD),
          COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.quote_cities c WHERE c.quote_id = OLD.id), '[]'::jsonb));
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'quote_delete_log_write failed (ignored): %', SQLERRM;   -- logging must never block a delete
  RETURN OLD;
END $$;
REVOKE EXECUTE ON FUNCTION public.quote_delete_log_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_quote_delete_log ON public.quotes;
CREATE TRIGGER trg_quote_delete_log
  BEFORE DELETE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quote_delete_log_write();

ALTER TABLE public.quote_delete_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quote_delete_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.quote_delete_log TO authenticated;
GRANT ALL ON public.quote_delete_log TO service_role;
REVOKE ALL ON SEQUENCE public.quote_delete_log_id_seq FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS qdl_admin_read ON public.quote_delete_log;
CREATE POLICY qdl_admin_read ON public.quote_delete_log FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) IN ('admin','co_owner'));

DROP POLICY IF EXISTS qdl_self_read ON public.quote_delete_log;
CREATE POLICY qdl_self_read ON public.quote_delete_log FOR SELECT TO authenticated
  USING (deleted_by = (SELECT auth.uid()));

-- the sales head sees deletes made by his own reps, PRIVATE only (Phase 563/564 scope)
DROP POLICY IF EXISTS qdl_manager_read ON public.quote_delete_log;
CREATE POLICY qdl_manager_read ON public.quote_delete_log FOR SELECT TO authenticated
  USING ((SELECT public.is_sales_manager()) AND segment = 'PRIVATE'
         AND deleted_by IN (SELECT u.id FROM public.users u WHERE u.manager_id = (SELECT auth.uid())));

NOTIFY pgrst, 'reload schema';

-- VERIFY: table + trigger + 3 policies
SELECT to_regclass('public.quote_delete_log') IS NOT NULL AS table_ok,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_quote_delete_log') AS trigger_ok,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'quote_delete_log') AS policies;
