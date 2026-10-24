-- Phase 501 (24 Oct 2026) - Operations fault flow: one fault row per screen, auto-Fixed, timer fault, history.
-- Spec: docs/superpowers/specs/2026-10-24-ops-fault-flow-design.md (owner approved 24 Oct).
-- Additive. Idempotent. The station-level auto tickets stay (assignment + push); this adds the PER-SCREEN layer under them.
-- Sections: 1 schema · 2 helper · 3 engine · 4 timer check · 5 ticket triggers · 6 history view · 7 cron · 8 backfill · VERIFY.

-- ==== 1 · schema ===========================================================
ALTER TABLE public.ops_tickets DROP CONSTRAINT IF EXISTS ops_tickets_source_check;
ALTER TABLE public.ops_tickets ADD  CONSTRAINT ops_tickets_source_check
  CHECK (source IN ('manual','api_webhook','sales_request','auto_offline','auto_camera','auto_timer'));

CREATE TABLE IF NOT EXISTS public.ops_screen_faults (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id         uuid NOT NULL REFERENCES public.ops_screens(id) ON DELETE CASCADE,
  depot_id          uuid REFERENCES public.ops_depots(id) ON DELETE SET NULL,
  ticket_id         uuid REFERENCES public.ops_tickets(id) ON DELETE SET NULL,
  kind              text NOT NULL CHECK (kind IN ('offline','timer','manual')),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed','cancelled')),
  started_at        timestamptz NOT NULL,
  online_since      timestamptz,
  in_process_at     timestamptz,
  fixed_at          timestamptz,
  fixed_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  closed_by_system  boolean NOT NULL DEFAULT false,
  reason            text,
  note              text,
  downtime_minutes  int,
  response_minutes  int,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ops_screen_faults_one_open ON public.ops_screen_faults (screen_id, kind) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ops_screen_faults_screen ON public.ops_screen_faults (screen_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ops_screen_faults_depot_day ON public.ops_screen_faults (depot_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ops_screen_faults_ticket ON public.ops_screen_faults (ticket_id) WHERE ticket_id IS NOT NULL;

ALTER TABLE public.ops_screen_faults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_screen_faults_read ON public.ops_screen_faults;
CREATE POLICY ops_screen_faults_read ON public.ops_screen_faults FOR SELECT TO authenticated
  USING ( public.get_my_role() IN ('admin','co_owner','operation_head')
          OR EXISTS (SELECT 1 FROM public.ops_depots d WHERE d.id = ops_screen_faults.depot_id AND d.assigned_to = auth.uid()) );
REVOKE ALL ON public.ops_screen_faults FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ops_screen_faults TO authenticated;
GRANT ALL    ON public.ops_screen_faults TO service_role;

-- ==== 2 · working minutes (only 07:00-21:00 IST count) ==========================
CREATE OR REPLACE FUNCTION public.ops_working_minutes(p_from timestamptz, p_to timestamptz)
RETURNS int LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(sum(GREATEST(0, extract(epoch FROM (
           LEAST(p_to,   ((g.d::date + time '21:00') AT TIME ZONE 'Asia/Kolkata'))
         - GREATEST(p_from, ((g.d::date + time '07:00') AT TIME ZONE 'Asia/Kolkata')))) / 60.0)), 0)::int
    FROM generate_series((p_from AT TIME ZONE 'Asia/Kolkata')::date, (p_to AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') g(d)
   WHERE p_from IS NOT NULL AND p_to IS NOT NULL AND p_to > p_from AND p_to - p_from < interval '400 days';
$$;
REVOKE ALL ON FUNCTION public.ops_working_minutes(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_working_minutes(timestamptz, timestamptz) TO authenticated, service_role;

-- ==== 3 · engine: open / auto-fix per-screen faults =============================
-- Called after ops_reconcile_offline_tickets() at the end of every sync (api/ops/sync.js). p_now is for tests only.
-- Rules (owner): offline ~15 min opens a fault (not before 07:30 IST = boot grace); online ~30 min in a row closes it;
-- only 07:00-21:00 IST minutes count; no head approval. Timer faults close when the screen goes off or at 07:00.
CREATE OR REPLACE FUNCTION public.ops_faults_reconcile(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ist_h numeric := extract(hour FROM (p_now AT TIME ZONE 'Asia/Kolkata')) + extract(minute FROM (p_now AT TIME ZONE 'Asia/Kolkata')) / 60.0;
  v_on boolean := (v_ist_h >= 7 AND v_ist_h < 21);
  v_open_ok boolean := (v_ist_h >= 7.5 AND v_ist_h < 21);
  v_today7 timestamptz := ((p_now AT TIME ZONE 'Asia/Kolkata')::date + time '07:00') AT TIME ZONE 'Asia/Kolkata';
  n_open int := 0; n_fixed int := 0; n_timer int := 0; n_res int := 0; n_can int := 0; n int;
BEGIN
  IF v_open_ok THEN
    INSERT INTO public.ops_screen_faults (screen_id, depot_id, kind, started_at, ticket_id)
    SELECT s.id, s.depot_id, 'offline', COALESCE(s.last_response_at, p_now),
           (SELECT t.id FROM public.ops_tickets t WHERE t.depot_id = s.depot_id AND t.source = 'auto_offline'
               AND t.status IN ('open','in_progress') ORDER BY t.opened_at DESC LIMIT 1)
      FROM public.ops_screens s
     WHERE s.is_active AND s.status = 'offline' AND s.depot_id IS NOT NULL
       AND (s.last_response_at IS NULL OR s.last_response_at < p_now - interval '15 minutes')
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n_open = ROW_COUNT;
  END IF;

  IF v_on THEN
    -- track how long each open offline fault's screen has been online in a row
    UPDATE public.ops_screen_faults f SET online_since = CASE WHEN s.status = 'online' THEN COALESCE(f.online_since, p_now) ELSE NULL END
      FROM public.ops_screens s
     WHERE f.screen_id = s.id AND f.kind = 'offline' AND f.status = 'open';
    -- close the ones stably online for 30 minutes
    UPDATE public.ops_screen_faults f SET status = 'fixed', fixed_at = f.online_since, closed_by_system = true,
           downtime_minutes = public.ops_working_minutes(f.started_at, f.online_since),
           response_minutes = CASE WHEN f.in_process_at IS NOT NULL THEN public.ops_working_minutes(f.in_process_at, f.online_since) END
     WHERE f.kind = 'offline' AND f.status = 'open' AND f.online_since IS NOT NULL AND f.online_since <= p_now - interval '30 minutes';
    GET DIAGNOSTICS n_fixed = ROW_COUNT;
  END IF;

  -- timer faults: screen switched off = good; still on at 07:00 = give up ("never switched off")
  UPDATE public.ops_screen_faults f SET status = 'fixed', fixed_at = p_now, closed_by_system = true,
         note = COALESCE(f.note || ' ', '') || CASE WHEN s.status = 'offline' THEN '[switched off]' ELSE '[never switched off]' END
    FROM public.ops_screens s
   WHERE f.screen_id = s.id AND f.kind = 'timer' AND f.status = 'open'
     AND ( s.status = 'offline' OR (v_on AND f.started_at < v_today7) );
  GET DIAGNOSTICS n_timer = ROW_COUNT;

  IF v_on THEN
    -- station auto ticket whose screens are all fine and no fault still open: Fixed if a fault was fixed under it, else a blip (cancelled)
    UPDATE public.ops_tickets t SET
           status = CASE WHEN t.status = 'in_progress' OR EXISTS (SELECT 1 FROM public.ops_screen_faults f WHERE f.depot_id = t.depot_id AND f.kind = 'offline' AND f.status = 'fixed' AND f.fixed_at >= t.opened_at)
                         THEN 'resolved' ELSE 'cancelled' END,
           resolved_at = p_now, updated_at = p_now,
           notes = btrim(COALESCE(t.notes,'') || ' [closed by the system - screens back online]')
     WHERE t.source = 'auto_offline' AND t.status IN ('open','in_progress')
       AND NOT EXISTS (SELECT 1 FROM public.ops_screens s WHERE s.depot_id = t.depot_id AND s.is_active AND s.status = 'offline')
       AND NOT EXISTS (SELECT 1 FROM public.ops_screen_faults f WHERE f.depot_id = t.depot_id AND f.kind = 'offline' AND f.status = 'open');
    GET DIAGNOSTICS n_res = ROW_COUNT;
  END IF;

  -- timer tickets close when no open timer fault is left at the station
  UPDATE public.ops_tickets t SET status = 'resolved', resolved_at = p_now, updated_at = p_now,
         notes = btrim(COALESCE(t.notes,'') || ' [timer fault closed by the system]')
   WHERE t.source = 'auto_timer' AND t.status IN ('open','in_progress')
     AND NOT EXISTS (SELECT 1 FROM public.ops_screen_faults f WHERE f.depot_id = t.depot_id AND f.kind = 'timer' AND f.status = 'open');
  GET DIAGNOSTICS n = ROW_COUNT; n_can := n;

  RETURN jsonb_build_object('opened', n_open, 'fixed', n_fixed, 'timer_closed', n_timer, 'tickets_closed', n_res + n_can);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END $$;
REVOKE ALL ON FUNCTION public.ops_faults_reconcile(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_faults_reconcile(timestamptz) TO service_role;

-- ==== 4 · 21:30 timer check ====================================================
CREATE OR REPLACE FUNCTION public.ops_timer_fault_check(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ist_h numeric := extract(hour FROM (p_now AT TIME ZONE 'Asia/Kolkata')) + extract(minute FROM (p_now AT TIME ZONE 'Asia/Kolkata')) / 60.0;
  d record; v_tid uuid; n_f int := 0; n_t int := 0; n int;
BEGIN
  IF v_ist_h < 21.5 THEN RETURN jsonb_build_object('skipped', 'before 21:30'); END IF;
  FOR d IN SELECT dp.id, dp.assigned_to, dp.name FROM public.ops_depots dp WHERE dp.is_active LOOP
    PERFORM pg_advisory_xact_lock(hashtext('ops_timer:' || d.id::text));
    IF EXISTS (SELECT 1 FROM public.ops_screens s WHERE s.depot_id = d.id AND s.is_active AND s.status = 'online'
               AND s.last_response_at > p_now - interval '15 minutes'
               AND NOT EXISTS (SELECT 1 FROM public.ops_screen_faults f WHERE f.screen_id = s.id AND f.kind = 'timer' AND f.status = 'open') ) THEN
      SELECT t.id INTO v_tid FROM public.ops_tickets t WHERE t.depot_id = d.id AND t.source = 'auto_timer' AND t.status IN ('open','in_progress') LIMIT 1;
      IF v_tid IS NULL THEN
        INSERT INTO public.ops_tickets (type, source, status, depot_id, assigned_to, priority, opened_at, notes)
        VALUES ('fault', 'auto_timer', 'open', d.id, d.assigned_to, 'low', p_now, 'Screens still on after 9:30 PM - the timer did not switch them off.')
        RETURNING id INTO v_tid;
        n_t := n_t + 1;
      END IF;
      INSERT INTO public.ops_screen_faults (screen_id, depot_id, ticket_id, kind, started_at)
      SELECT s.id, d.id, v_tid, 'timer', p_now FROM public.ops_screens s
       WHERE s.depot_id = d.id AND s.is_active AND s.status = 'online' AND s.last_response_at > p_now - interval '15 minutes'
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT; n_f := n_f + n;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('timer_faults', n_f, 'timer_tickets', n_t);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END $$;
REVOKE ALL ON FUNCTION public.ops_timer_fault_check(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_timer_fault_check(timestamptz) TO service_role;

-- ==== 5 · ticket triggers (never raise) =======================================
-- A manual fault on a screen becomes a fault row; In process stamps the response time; Fixed closes it.
CREATE OR REPLACE FUNCTION public.ops_tickets_fault_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.source = 'manual' AND NEW.type = 'fault' AND NEW.screen_id IS NOT NULL AND NEW.status IN ('open','in_progress') THEN
        INSERT INTO public.ops_screen_faults (screen_id, depot_id, ticket_id, kind, started_at, in_process_at, reason)
        VALUES (NEW.screen_id, NEW.depot_id, NEW.id, 'manual', COALESCE(NEW.opened_at, now()),
                CASE WHEN NEW.status = 'in_progress' THEN COALESCE(NEW.opened_at, now()) END, NEW.cause)
        ON CONFLICT DO NOTHING;
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'in_progress' THEN
        UPDATE public.ops_screen_faults SET in_process_at = now()
         WHERE in_process_at IS NULL AND status = 'open'
           AND ( ticket_id = NEW.id OR (NEW.source = 'auto_offline' AND depot_id = NEW.depot_id AND kind = 'offline') );
      ELSIF NEW.status IN ('resolved','approved') THEN
        UPDATE public.ops_screen_faults SET status = 'fixed', fixed_at = now(), fixed_by = auth.uid(),
               downtime_minutes = public.ops_working_minutes(started_at, now()),
               response_minutes = CASE WHEN in_process_at IS NOT NULL THEN public.ops_working_minutes(in_process_at, now()) END
         WHERE ticket_id = NEW.id AND kind = 'manual' AND status = 'open';
      ELSIF NEW.status = 'cancelled' THEN
        UPDATE public.ops_screen_faults SET status = 'cancelled' WHERE ticket_id = NEW.id AND kind = 'manual' AND status = 'open';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ops_tickets_fault_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ops_tickets_fault_sync_ins ON public.ops_tickets;
CREATE TRIGGER trg_ops_tickets_fault_sync_ins AFTER INSERT ON public.ops_tickets FOR EACH ROW EXECUTE FUNCTION public.ops_tickets_fault_sync();
DROP TRIGGER IF EXISTS trg_ops_tickets_fault_sync_upd ON public.ops_tickets;
CREATE TRIGGER trg_ops_tickets_fault_sync_upd AFTER UPDATE OF status ON public.ops_tickets FOR EACH ROW EXECUTE FUNCTION public.ops_tickets_fault_sync();

-- ==== 6 · history per screen ===================================================
CREATE OR REPLACE VIEW public.ops_screen_fault_counts WITH (security_invoker = on) AS
SELECT screen_id,
       count(*) FILTER (WHERE status <> 'cancelled')                                         AS faults_total,
       count(*) FILTER (WHERE status <> 'cancelled' AND started_at > now() - interval '30 days') AS faults_30d,
       max(started_at)                                                                       AS last_fault_at,
       count(*) FILTER (WHERE status <> 'cancelled' AND prev_fixed IS NOT NULL AND started_at - prev_fixed <= interval '7 days') AS repeats
  FROM (SELECT f.*, lag(fixed_at) OVER (PARTITION BY screen_id ORDER BY started_at) AS prev_fixed FROM public.ops_screen_faults f) x
 GROUP BY screen_id;
GRANT SELECT ON public.ops_screen_fault_counts TO authenticated, service_role;

-- ==== 7 · cron: timer check at 21:30 IST (16:00 UTC) ===========================
DO $$ BEGIN
  PERFORM cron.unschedule('ops-timer-check');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('ops-timer-check', '0 16 * * *', $c$SELECT public.ops_timer_fault_check();$c$);

-- ==== 8 · adopt today's open manual faults =====================================
INSERT INTO public.ops_screen_faults (screen_id, depot_id, ticket_id, kind, started_at, in_process_at, reason)
SELECT t.screen_id, t.depot_id, t.id, 'manual', t.opened_at, CASE WHEN t.status = 'in_progress' THEN t.opened_at END, t.cause
  FROM public.ops_tickets t
 WHERE t.source = 'manual' AND t.type = 'fault' AND t.screen_id IS NOT NULL AND t.status IN ('open','in_progress')
ON CONFLICT DO NOTHING;
NOTIFY pgrst, 'reload schema';

-- VERIFY (expect: table 1, functions 4, triggers 2, cron 1, anon cannot run the engine)
-- SELECT to_regclass('public.ops_screen_faults') IS NOT NULL AS tbl,
--        (SELECT count(*) FROM pg_proc WHERE proname IN ('ops_working_minutes','ops_faults_reconcile','ops_timer_fault_check','ops_tickets_fault_sync')) AS fns,
--        (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_ops_tickets_fault_sync%') AS trg,
--        (SELECT count(*) FROM cron.job WHERE jobname = 'ops-timer-check') AS cron_job,
--        has_function_privilege('anon','public.ops_faults_reconcile(timestamptz)','EXECUTE') AS anon_can;
