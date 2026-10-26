-- Phase 520: owner 26 Oct 2026 - stop "2:10" saved as 02:10 AM when the person meant PM (8 bad rows in 30 days; one became Piyush's clock-in).
-- work_add_manual_time now REFUSES a start before 07:00 IST unless the caller passes p_early_ok = true (the app sends it only
-- when the person taps "Keep AM"). Old 5-argument version is dropped so it cannot be used to bypass the check.
-- NOTE: p_early_ok is a plain caller-supplied flag, so this stops ACCIDENTS through the app, not a deliberate wrong entry; the head's
-- approval screen (red 'early morning' line) remains the real control.
-- UNDO: DROP the 6-argument function, then re-run the work_add_manual_time block from supabase_phase365_work_timeclock.sql and its GRANT.
BEGIN;   -- DROP + CREATE + GRANT succeed or fail together, so a failed CREATE cannot leave the app with no function
DROP FUNCTION IF EXISTS public.work_add_manual_time(uuid, text, timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION public.work_add_manual_time(p_project uuid, p_label text, p_start timestamptz, p_end timestamptz, p_note text DEFAULT NULL, p_early_ok boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF p_project IS NULL OR NULLIF(btrim(p_label), '') IS NULL THEN RAISE EXCEPTION 'pick a client and say what you did'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN RAISE EXCEPTION 'end must be after start'; END IF;
  IF p_end > now() THEN RAISE EXCEPTION 'added time must be in the past'; END IF;
  IF p_end - p_start > interval '12 hours' THEN RAISE EXCEPTION 'at most 12 hours at a time'; END IF;
  IF p_start < now() - interval '7 days' THEN RAISE EXCEPTION 'only the last 7 days can be added'; END IF;
  IF (p_start AT TIME ZONE 'Asia/Kolkata')::date <> (p_end AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'one entry cannot cross midnight - add two';
  END IF;
  IF NOT COALESCE(p_early_ok, false) AND extract(hour FROM (p_start AT TIME ZONE 'Asia/Kolkata')) < 7 THEN
    RAISE EXCEPTION 'the start time is before 7 AM - if you meant PM, change it. For real early work, confirm AM in the app';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_time_entries e
              WHERE e.user_id = v_uid AND e.status <> 'declined'
                AND tstzrange(e.started_at, COALESCE(e.ended_at, now())) && tstzrange(p_start, p_end)) THEN
    RAISE EXCEPTION 'this overlaps time you already have';
  END IF;
  INSERT INTO public.work_time_entries (user_id, project_id, task_label, started_at, ended_at, source, status, note)
  VALUES (v_uid, p_project, left(btrim(p_label), 80), p_start, p_end, 'added_later', 'pending', NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.work_add_manual_time(uuid, text, timestamptz, timestamptz, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_add_manual_time(uuid, text, timestamptz, timestamptz, text, boolean) TO authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT count(*) AS versions, bool_and(pg_get_functiondef(p.oid) LIKE '%p_early_ok%') AS guarded,
--        has_function_privilege('anon', 'public.work_add_manual_time(uuid,text,timestamptz,timestamptz,text,boolean)', 'execute') AS anon_exec
--   FROM pg_proc p WHERE proname = 'work_add_manual_time';   -- 1, true, false
