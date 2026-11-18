-- Phase 610 — Lead stage log: WHO changed a lead's stage and WHEN (owner 18-11-2026).
-- Why: 18 of Salpesh's leads went to Lost in 3 minutes on 18 Nov and nothing recorded who did it
--   (lead_activities status_change rows are written only by some screens).
-- One row per stage change, written by a trigger on leads, for EVERY path (modal, bulk, RPC, cron).
-- changed_by = the signed-in user (NULL = system / cron / SQL). Read-only for clients.
-- Shown in the rep's day Activity timeline (GpsTrackV2). ADDITIVE: no existing trigger changed.

CREATE TABLE IF NOT EXISTS public.lead_stage_log (
  id          bigserial PRIMARY KEY,
  lead_id     uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  old_stage   text,
  new_stage   text,
  lost_reason text,
  changed_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_stage_log_by_day ON public.lead_stage_log (changed_by, changed_at);
CREATE INDEX IF NOT EXISTS lead_stage_log_lead   ON public.lead_stage_log (lead_id);

CREATE OR REPLACE FUNCTION public.lead_stage_log_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.lead_stage_log (lead_id, old_stage, new_stage, lost_reason, changed_by)
  VALUES (NEW.id, OLD.stage, NEW.stage, CASE WHEN NEW.stage = 'Lost' THEN NEW.lost_reason END, auth.uid());
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'lead_stage_log_write failed (ignored): %', SQLERRM;   -- a stage change must never fail because of the log
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.lead_stage_log_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_stage_log ON public.leads;
CREATE TRIGGER trg_lead_stage_log
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.lead_stage_log_write();

ALTER TABLE public.lead_stage_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_stage_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_stage_log TO authenticated;
GRANT ALL ON public.lead_stage_log TO service_role;
REVOKE ALL ON SEQUENCE public.lead_stage_log_id_seq FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS lsl_admin_read ON public.lead_stage_log;
CREATE POLICY lsl_admin_read ON public.lead_stage_log FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) IN ('admin','co_owner'));

DROP POLICY IF EXISTS lsl_self_read ON public.lead_stage_log;
CREATE POLICY lsl_self_read ON public.lead_stage_log FOR SELECT TO authenticated
  USING (changed_by = (SELECT auth.uid()));

-- the sales head sees changes made by his own reps (same manager_id scope as Phase 563/564)
DROP POLICY IF EXISTS lsl_manager_read ON public.lead_stage_log;
CREATE POLICY lsl_manager_read ON public.lead_stage_log FOR SELECT TO authenticated
  USING ((SELECT public.is_sales_manager())
         AND changed_by IN (SELECT u.id FROM public.users u WHERE u.manager_id = (SELECT auth.uid())));

NOTIFY pgrst, 'reload schema';

-- VERIFY: table + trigger + 3 policies
SELECT to_regclass('public.lead_stage_log') IS NOT NULL AS table_ok,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_lead_stage_log') AS trigger_ok,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'lead_stage_log') AS policies;
