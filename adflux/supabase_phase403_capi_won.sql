-- supabase_phase403_capi_won.sql
-- Phase 403: when a lead that came from a Meta instant form turns Won, queue it and send it back to Meta
-- (Conversions API for CRM, dataset 1841233447007580). Only "Won" per owner (16 Oct 2026). Adding "QuoteSent" later = one more trigger branch.
-- Sender = api/meta/capi-send.js, called every 10 min by capi_dispatch(). The secret placeholder __TA_SECRET__ is
-- substituted at apply time (same value the team-assistant-nudge job uses); it is never stored in git.
-- Idempotent.
CREATE TABLE IF NOT EXISTS public.capi_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_name  text NOT NULL DEFAULT 'Won',
  event_time  timestamptz NOT NULL DEFAULT now(),
  value       numeric,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped')),
  tries       int  NOT NULL DEFAULT 0,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  UNIQUE (lead_id, event_name)
);
ALTER TABLE public.capi_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capi_outbox_admin_read ON public.capi_outbox;
CREATE POLICY capi_outbox_admin_read ON public.capi_outbox FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','co_owner'));

CREATE OR REPLACE FUNCTION public.capi_queue_won() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stage = 'Won' AND OLD.stage IS DISTINCT FROM 'Won'
     AND EXISTS (SELECT 1 FROM public.inbound_leads il WHERE il.provider = 'meta_lead' AND il.lead_id = NEW.id) THEN
    INSERT INTO public.capi_outbox (lead_id, event_name, event_time, value)
    VALUES (NEW.id, 'Won', COALESCE(NEW.won_at, now()),
            (SELECT q.total_amount FROM public.quotes q WHERE q.id = NEW.quote_id))
    ON CONFLICT (lead_id, event_name) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'capi_queue_won failed: %', SQLERRM;   -- never block a stage change
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_capi_queue_won ON public.leads;
CREATE TRIGGER trg_capi_queue_won AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.capi_queue_won();

CREATE OR REPLACE FUNCTION public.capi_dispatch() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.capi_outbox WHERE status = 'pending') THEN RETURN; END IF;
  BEGIN
    PERFORM net.http_post(
      url := 'https://app.untitledad.in/api/meta/capi-send',
      headers := jsonb_build_object('Content-Type','application/json','x-ta-secret','__TA_SECRET__'),
      body := '{}'::jsonb, timeout_milliseconds := 25000);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'capi_dispatch failed: %', SQLERRM;
  END;
END $$;

REVOKE EXECUTE ON FUNCTION public.capi_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.capi_queue_won() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('capi-dispatch') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'capi-dispatch');
SELECT cron.schedule('capi-dispatch', '*/10 * * * *', 'SELECT public.capi_dispatch();');
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT (SELECT count(*) FROM pg_trigger WHERE tgname='trg_capi_queue_won') AS trg,
--                (SELECT count(*) FROM cron.job WHERE jobname='capi-dispatch') AS cron;   -- 1 / 1
