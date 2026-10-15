-- supabase_phase381_work_activity.sql
-- Phase 381 - Windows activity agent, STEP 1 (database only, nothing visible changes).
-- Design: _design_reference/work_windows_app_software_design.html + docs/PLAN_creative_timeclock_structure.md section 14.
-- Rules (owner 15 Oct 2026): records ONLY while a timer runs; person must be switched on; consent first;
-- admin + heads read; screenshots 30 days; no keystrokes / mouse / productivity %.
-- Idempotent. Clients get SELECT only; every write goes through the work_agent_* / work_set_tracking_* functions.

-- ---------- 1. tables ----------
CREATE TABLE IF NOT EXISTS public.work_tracking_settings (
  id                   int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  screenshot_interval_min int NOT NULL DEFAULT 10 CHECK (screenshot_interval_min IN (0, 5, 10, 15)),   -- 0 = off
  idle_minutes         int NOT NULL DEFAULT 5  CHECK (idle_minutes IN (0, 5, 10)),                       -- 0 = off
  retention_days       int NOT NULL DEFAULT 30 CHECK (retention_days IN (7, 30, 60)),
  updated_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.work_tracking_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.work_tracking_people (
  user_id     uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT false,
  changed_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_agent_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_name   text NOT NULL,
  agent_version text,
  consent_at    timestamptz,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_name)
);

CREATE TABLE IF NOT EXISTS public.work_activity_slices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entry_id       uuid REFERENCES public.work_time_entries(id) ON DELETE CASCADE,
  slice_start    timestamptz NOT NULL,             -- start of the minute
  program        text NOT NULL,
  window_title   text,
  active_seconds int NOT NULL DEFAULT 0 CHECK (active_seconds BETWEEN 0 AND 60),
  idle_seconds   int NOT NULL DEFAULT 0 CHECK (idle_seconds BETWEEN 0 AND 60),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS work_slices_uk
  ON public.work_activity_slices (user_id, slice_start, program, md5(COALESCE(window_title, '')));
CREATE INDEX IF NOT EXISTS work_slices_user_day_idx ON public.work_activity_slices (user_id, slice_start);

CREATE TABLE IF NOT EXISTS public.work_screenshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entry_id     uuid REFERENCES public.work_time_entries(id) ON DELETE SET NULL,
  taken_at     timestamptz NOT NULL,
  storage_path text NOT NULL,
  bytes        int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, taken_at)
);
CREATE INDEX IF NOT EXISTS work_shots_user_day_idx ON public.work_screenshots (user_id, taken_at);

CREATE TABLE IF NOT EXISTS public.work_idle_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entry_id     uuid REFERENCES public.work_time_entries(id) ON DELETE SET NULL,
  idle_began   timestamptz NOT NULL,
  decision     text NOT NULL CHECK (decision IN ('still_working', 'break', 'stop', 'auto_stopped')),
  idle_seconds int NOT NULL DEFAULT 0 CHECK (idle_seconds >= 0),
  decided_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idle_began)
);

-- minutes removed from the hours when the person says "it was a break" (reports apply it in step 2)
ALTER TABLE public.work_time_entries ADD COLUMN IF NOT EXISTS break_seconds int NOT NULL DEFAULT 0;

-- ---------- 2. RLS: read only for clients ----------
ALTER TABLE public.work_tracking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_tracking_people   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_agent_devices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_activity_slices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_screenshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_idle_events       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wts_read ON public.work_tracking_settings;
CREATE POLICY wts_read ON public.work_tracking_settings FOR SELECT TO authenticated USING (public.work_is_head());
DROP POLICY IF EXISTS wtp_read ON public.work_tracking_people;
CREATE POLICY wtp_read ON public.work_tracking_people FOR SELECT TO authenticated
  USING (public.work_is_active_user() AND (user_id = auth.uid() OR public.work_is_head()));
DROP POLICY IF EXISTS wad_read ON public.work_agent_devices;
CREATE POLICY wad_read ON public.work_agent_devices FOR SELECT TO authenticated
  USING (public.work_is_active_user() AND (user_id = auth.uid() OR public.work_is_head()));
DROP POLICY IF EXISTS was_read ON public.work_activity_slices;
CREATE POLICY was_read ON public.work_activity_slices FOR SELECT TO authenticated
  USING (public.work_is_active_user() AND (user_id = auth.uid() OR public.work_is_head()));
DROP POLICY IF EXISTS wsh_read ON public.work_screenshots;
CREATE POLICY wsh_read ON public.work_screenshots FOR SELECT TO authenticated
  USING (public.work_is_active_user() AND (user_id = auth.uid() OR public.work_is_head()));
DROP POLICY IF EXISTS wie_read ON public.work_idle_events;
CREATE POLICY wie_read ON public.work_idle_events FOR SELECT TO authenticated
  USING (public.work_is_active_user() AND (user_id = auth.uid() OR public.work_is_head()));

REVOKE ALL ON public.work_tracking_settings, public.work_tracking_people, public.work_agent_devices,
              public.work_activity_slices, public.work_screenshots, public.work_idle_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_tracking_settings, public.work_tracking_people, public.work_agent_devices,
                public.work_activity_slices, public.work_screenshots, public.work_idle_events
  TO authenticated;

-- ---------- 3. private storage bucket for screenshots ----------
INSERT INTO storage.buckets (id, name, public) VALUES ('work-screenshots', 'work-screenshots', false)
  ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS work_shots_insert ON storage.objects;
CREATE POLICY work_shots_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'work-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS work_shots_select ON storage.objects;
CREATE POLICY work_shots_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'work-screenshots'
         AND ((storage.foldername(name))[1] = auth.uid()::text OR public.work_is_head()));

-- ---------- 4. functions ----------
-- internal: is this person switched on?
CREATE OR REPLACE FUNCTION public.work_is_tracked(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT enabled FROM public.work_tracking_people WHERE user_id = p_user), false);
$$;

-- the agent asks: am I tracked, how often, how long idle, have I consented on this PC
CREATE OR REPLACE FUNCTION public.work_agent_config(p_device text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); s public.work_tracking_settings%ROWTYPE; v_consent timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.work_tracking_settings WHERE id = 1;
  SELECT consent_at INTO v_consent FROM public.work_agent_devices WHERE user_id = v_uid AND device_name = p_device;
  RETURN jsonb_build_object(
    'tracked', public.work_is_tracked(v_uid),
    'screenshot_interval_min', s.screenshot_interval_min,
    'idle_minutes', s.idle_minutes,
    'consent_at', v_consent);
END;
$$;

-- first run: person accepted the notice on this PC
CREATE OR REPLACE FUNCTION public.work_agent_consent(p_device text, p_version text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_device), '') IS NULL THEN RAISE EXCEPTION 'device name needed'; END IF;
  INSERT INTO public.work_agent_devices (user_id, device_name, agent_version, consent_at, last_seen_at)
  VALUES (v_uid, left(btrim(p_device), 80), left(p_version, 30), now(), now())
  ON CONFLICT (user_id, device_name) DO UPDATE
    SET consent_at = COALESCE(public.work_agent_devices.consent_at, now()),
        agent_version = EXCLUDED.agent_version, last_seen_at = now();
END;
$$;

-- one minute-slice batch from the agent (<= 120 rows). Needs: switched on + consent + own entry.
-- [{"entry":"<uuid>","start":"2026-10-15T10:42:00+05:30","program":"Photoshop","title":"x.psd","active":50,"idle":10}]
CREATE OR REPLACE FUNCTION public.work_agent_push_activity(p_slices jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_n int := 0; j jsonb; v_entry uuid; v_start timestamptz; v_cnt int;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF NOT public.work_is_tracked(v_uid) THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_agent_devices WHERE user_id = v_uid AND consent_at IS NOT NULL) THEN RETURN 0; END IF;
  IF p_slices IS NULL OR jsonb_typeof(p_slices) <> 'array' THEN RETURN 0; END IF;
  IF jsonb_array_length(p_slices) > 120 THEN RAISE EXCEPTION 'too many slices in one call'; END IF;
  FOR j IN SELECT * FROM jsonb_array_elements(p_slices) LOOP
    v_entry := NULLIF(j->>'entry', '')::uuid;
    v_start := date_trunc('minute', (j->>'start')::timestamptz);
    -- only while a timer was running: the entry must be the caller's and cover that minute
    IF NOT EXISTS (SELECT 1 FROM public.work_time_entries e
                    WHERE e.id = v_entry AND e.user_id = v_uid AND e.started_at <= v_start + interval '59 seconds'
                      AND (e.ended_at IS NULL OR e.ended_at >= v_start)) THEN CONTINUE; END IF;
    INSERT INTO public.work_activity_slices (user_id, entry_id, slice_start, program, window_title, active_seconds, idle_seconds)
    VALUES (v_uid, v_entry, v_start, left(COALESCE(NULLIF(btrim(j->>'program'), ''), 'Unknown'), 120),
            left(NULLIF(btrim(j->>'title'), ''), 300),
            LEAST(60, GREATEST(0, COALESCE((j->>'active')::int, 0))), LEAST(60, GREATEST(0, COALESCE((j->>'idle')::int, 0))))
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_cnt = ROW_COUNT; v_n := v_n + v_cnt;
  END LOOP;
  UPDATE public.work_agent_devices SET last_seen_at = now() WHERE user_id = v_uid;
  RETURN v_n;
END;
$$;

-- before uploading a screenshot: register it and get the storage path (<uid>/<date>/<epoch>.jpg)
CREATE OR REPLACE FUNCTION public.work_agent_register_screenshot(p_entry uuid, p_taken_at timestamptz, p_bytes int DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_path text;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF NOT public.work_is_tracked(v_uid) THEN RAISE EXCEPTION 'tracking is off for you'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_agent_devices WHERE user_id = v_uid AND consent_at IS NOT NULL) THEN
    RAISE EXCEPTION 'consent needed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_time_entries e
                  WHERE e.id = p_entry AND e.user_id = v_uid AND e.started_at <= p_taken_at
                    AND (e.ended_at IS NULL OR e.ended_at >= p_taken_at)) THEN
    RAISE EXCEPTION 'no timer was running';
  END IF;
  v_path := v_uid::text || '/' || to_char(p_taken_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') || '/'
            || extract(epoch FROM p_taken_at)::bigint::text || '.jpg';
  INSERT INTO public.work_screenshots (user_id, entry_id, taken_at, storage_path, bytes)
  VALUES (v_uid, p_entry, p_taken_at, v_path, p_bytes)
  ON CONFLICT (user_id, taken_at) DO NOTHING;
  RETURN v_path;
END;
$$;

-- idle popup result. still_working: nothing changes. break: idle minutes come off the hours.
-- stop / auto_stopped: the running timer ends where idle began.
CREATE OR REPLACE FUNCTION public.work_agent_idle(p_entry uuid, p_idle_began timestamptz, p_decision text, p_idle_seconds int DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); r public.work_time_entries%ROWTYPE; v_end timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF p_decision NOT IN ('still_working', 'break', 'stop', 'auto_stopped') THEN RAISE EXCEPTION 'bad decision'; END IF;
  IF NOT public.work_is_tracked(v_uid) THEN RETURN; END IF;
  SELECT * INTO r FROM public.work_time_entries WHERE id = p_entry AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'that timer is not yours' USING ERRCODE='42501'; END IF;
  INSERT INTO public.work_idle_events (user_id, entry_id, idle_began, decision, idle_seconds)
  VALUES (v_uid, p_entry, p_idle_began, p_decision, GREATEST(0, COALESCE(p_idle_seconds, 0)))
  ON CONFLICT (user_id, idle_began) DO NOTHING;
  IF p_decision = 'break' THEN
    UPDATE public.work_time_entries SET break_seconds = break_seconds + LEAST(GREATEST(0, COALESCE(p_idle_seconds, 0)), 7200)
     WHERE id = r.id;
  ELSIF p_decision IN ('stop', 'auto_stopped') AND r.ended_at IS NULL THEN
    v_end := GREATEST(p_idle_began, r.started_at + interval '1 second');
    IF v_end > now() THEN v_end := now(); END IF;
    UPDATE public.work_time_entries SET ended_at = v_end, auto_stopped = (p_decision = 'auto_stopped') WHERE id = r.id;
    IF r.task_id IS NOT NULL THEN
      PERFORM public.work_log(r.task_id, r.part_id, 'paused',
        jsonb_build_object('seconds', extract(epoch FROM (v_end - r.started_at))::int, 'idle', p_decision));
    END IF;
  END IF;
END;
$$;

-- admin / co-owner: switch one person on or off
CREATE OR REPLACE FUNCTION public.work_set_tracking_person(p_user uuid, p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_is_active_user() OR public.get_my_role() NOT IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.work_tracking_people (user_id, enabled, changed_by, changed_at)
  VALUES (p_user, COALESCE(p_enabled, false), auth.uid(), now())
  ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, changed_by = auth.uid(), changed_at = now();
END;
$$;

-- admin / co-owner: interval, idle minutes, retention
CREATE OR REPLACE FUNCTION public.work_set_tracking_settings(p_interval int, p_idle int, p_retention int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_is_active_user() OR public.get_my_role() NOT IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  UPDATE public.work_tracking_settings
     SET screenshot_interval_min = p_interval, idle_minutes = p_idle, retention_days = p_retention,
         updated_by = auth.uid(), updated_at = now()
   WHERE id = 1;
END;
$$;

-- nightly: drop screenshots past retention (+ slices / idle events past 180 days). Storage files:
-- the row delete is the source of truth; a storage-API sweep removes orphan files (step 3).
CREATE OR REPLACE FUNCTION public.work_purge_activity() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_days int; v_n int := 0; v_paths text[];
BEGIN
  SELECT retention_days INTO v_days FROM public.work_tracking_settings WHERE id = 1;
  SELECT array_agg(storage_path) INTO v_paths FROM public.work_screenshots WHERE taken_at < now() - make_interval(days => COALESCE(v_days, 30));
  IF v_paths IS NOT NULL THEN
    BEGIN
      DELETE FROM storage.objects WHERE bucket_id = 'work-screenshots' AND name = ANY (v_paths);
    EXCEPTION WHEN OTHERS THEN NULL;       -- storage protects direct deletes on some versions; rows below still go
    END;
    DELETE FROM public.work_screenshots WHERE storage_path = ANY (v_paths);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  DELETE FROM public.work_activity_slices WHERE created_at < now() - interval '180 days';
  DELETE FROM public.work_idle_events     WHERE decided_at < now() - interval '180 days';
  RETURN v_n;
END;
$$;

-- ---------- 5. lock down functions (same pattern as phase 365) ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND (p.proname LIKE 'work\_agent\_%' OR p.proname LIKE 'work\_set\_tracking\_%'
                   OR p.proname IN ('work_is_tracked', 'work_purge_activity')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION
  public.work_agent_config(text), public.work_agent_consent(text, text),
  public.work_agent_push_activity(jsonb), public.work_agent_register_screenshot(uuid, timestamptz, int),
  public.work_agent_idle(uuid, timestamptz, text, int),
  public.work_set_tracking_person(uuid, boolean), public.work_set_tracking_settings(int, int, int)
  TO authenticated;
-- internal only: work_is_tracked, work_purge_activity (pg_cron)

-- ---------- 6. cron + first tracked person ----------
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'work-purge-activity';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('work-purge-activity', '30 20 * * *', $$SELECT public.work_purge_activity()$$);   -- 02:00 IST

-- Safika is the first tracked person (owner 15 Oct 2026). She still has to accept the consent screen on her PC.
INSERT INTO public.work_tracking_people (user_id, enabled, changed_at)
SELECT u.id, true, now() FROM public.users u
 WHERE u.is_active AND u.name ILIKE 'SAFIKA%'
ON CONFLICT (user_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect tables 6, rls_on 6, bucket 1, agent_fns 7, anon_exec false, cron 1, tracked >= 1)
-- SELECT
--  (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('work_tracking_settings','work_tracking_people','work_agent_devices','work_activity_slices','work_screenshots','work_idle_events')) AS tables,
--  (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity AND tablename IN ('work_tracking_settings','work_tracking_people','work_agent_devices','work_activity_slices','work_screenshots','work_idle_events')) AS rls_on,
--  (SELECT count(*) FROM storage.buckets WHERE id='work-screenshots' AND NOT public) AS bucket,
--  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'work\_agent\_%' OR p.proname LIKE 'work\_set\_tracking\_%')) AS agent_fns,
--  has_function_privilege('anon','public.work_agent_push_activity(jsonb)','EXECUTE') AS anon_exec,
--  (SELECT count(*) FROM cron.job WHERE jobname='work-purge-activity') AS cron,
--  (SELECT count(*) FROM public.work_tracking_people WHERE enabled) AS tracked;
