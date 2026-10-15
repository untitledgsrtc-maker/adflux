-- supabase_phase389_agent_seen.sql
-- Phase 389 - the Windows app reports its REAL installed version on every start (agent_version used to be
-- written only at consent time, so it showed the first version forever). Updates only an existing device row.
CREATE OR REPLACE FUNCTION public.work_agent_seen(p_device text, p_version text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  UPDATE public.work_agent_devices
     SET agent_version = left(p_version, 30), last_seen_at = now()
   WHERE user_id = auth.uid() AND device_name = left(btrim(p_device), 80);
END;
$$;
REVOKE ALL ON FUNCTION public.work_agent_seen(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_agent_seen(text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
