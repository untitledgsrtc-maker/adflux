-- Phase 508 (24 Oct 2026) - camera faults go into the per-screen fault history (ops_screen_faults, kind 'camera').
-- Additive + idempotent. The screen-off engine (ops_faults_reconcile) is NOT touched; this is a separate function.
-- Camera fault = screen ONLINE and camera_active = false (screen up, camera dead). Start = the first time the sync saw it
-- (the CMS gives no "camera died at" time). Opens ~15 min after first seen, only 07:30-21:00 IST. Fixed after the camera has
-- been active 30 min in a row. The fault report + score read only kind offline/manual/timer, so scores do NOT change.
ALTER TABLE public.ops_screen_faults DROP CONSTRAINT IF EXISTS ops_screen_faults_kind_check;
ALTER TABLE public.ops_screen_faults ADD  CONSTRAINT ops_screen_faults_kind_check
  CHECK (kind IN ('offline','timer','manual','camera'));

-- when the sync FIRST saw the camera dead (used to wait 15 minutes before opening)
ALTER TABLE public.ops_screens ADD COLUMN IF NOT EXISTS camera_off_since timestamptz;

CREATE OR REPLACE FUNCTION public.ops_camera_faults_reconcile(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_h numeric := extract(hour FROM (p_now AT TIME ZONE 'Asia/Kolkata')) + extract(minute FROM (p_now AT TIME ZONE 'Asia/Kolkata')) / 60.0;
  n_open int := 0; n_fixed int := 0;
BEGIN
  IF v_h < 7.5 OR v_h >= 21 THEN
    RETURN jsonb_build_object('skipped', 'off-hours');   -- timer-off screens: nothing to judge at night
  END IF;
  -- remember when we first saw a dead camera on an online screen; forget it once the camera is fine
  UPDATE public.ops_screens s SET camera_off_since = CASE
           WHEN s.status = 'online' AND s.camera_active = false THEN COALESCE(s.camera_off_since, p_now)
           WHEN s.camera_active IS TRUE THEN NULL
           ELSE s.camera_off_since END
   WHERE s.is_active AND s.camera_off_since IS DISTINCT FROM CASE
           WHEN s.status = 'online' AND s.camera_active = false THEN COALESCE(s.camera_off_since, p_now)
           WHEN s.camera_active IS TRUE THEN NULL
           ELSE s.camera_off_since END;
  -- open
  INSERT INTO public.ops_screen_faults (screen_id, depot_id, kind, started_at, ticket_id)
  SELECT s.id, s.depot_id, 'camera', s.camera_off_since,
         (SELECT t.id FROM public.ops_tickets t WHERE t.depot_id = s.depot_id AND t.source = 'auto_camera'
             AND t.status IN ('open','in_progress') ORDER BY t.opened_at DESC LIMIT 1)
    FROM public.ops_screens s
   WHERE s.is_active AND s.depot_id IS NOT NULL AND s.status = 'online' AND s.camera_active = false
     AND s.camera_off_since <= p_now - interval '15 minutes'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n_open = ROW_COUNT;
  -- track "camera active in a row" on open camera faults (online_since doubles as camera-ok-since), close after 30 min
  UPDATE public.ops_screen_faults f SET online_since = CASE WHEN s.camera_active IS TRUE THEN COALESCE(f.online_since, p_now) ELSE NULL END
    FROM public.ops_screens s WHERE f.screen_id = s.id AND f.kind = 'camera' AND f.status = 'open';
  UPDATE public.ops_screen_faults f SET status = 'fixed', fixed_at = f.online_since, closed_by_system = true,
         downtime_minutes = public.ops_working_minutes(f.started_at, f.online_since)
   WHERE f.kind = 'camera' AND f.status = 'open' AND f.online_since IS NOT NULL AND f.online_since <= p_now - interval '30 minutes';
  GET DIAGNOSTICS n_fixed = ROW_COUNT;
  RETURN jsonb_build_object('opened', n_open, 'fixed', n_fixed);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END $$;
REVOKE ALL ON FUNCTION public.ops_camera_faults_reconcile(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_camera_faults_reconcile(timestamptz) TO service_role;
NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT (SELECT count(*) FROM pg_proc WHERE proname='ops_camera_faults_reconcile') AS fn,
--        (SELECT count(*) FROM information_schema.columns WHERE table_name='ops_screens' AND column_name='camera_off_since') AS col,
--        has_function_privilege('authenticated','public.ops_camera_faults_reconcile(timestamptz)','EXECUTE') AS client_can;  -- 1,1,false
