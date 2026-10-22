-- Phase 471: take Dhara + Rima (telecallers, no open Work tasks) off the Work timeclock.
-- They only use "Ask for work" (any active user can still do that). Owner OK 2026-10-22.
-- Mayur + Sneha NOT touched: each holds an open task (non-members cannot see My work).
-- UNDO: INSERT INTO work_members SELECT * FROM _bak_work_members_p471 ON CONFLICT DO NOTHING;
--       INSERT INTO work_tracking_people SELECT * FROM _bak_work_tracking_p471 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public._bak_work_members_p471 AS SELECT * FROM public.work_members WHERE false;
CREATE TABLE IF NOT EXISTS public._bak_work_tracking_p471 AS SELECT * FROM public.work_tracking_people WHERE false;
ALTER TABLE public._bak_work_members_p471 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_work_tracking_p471 ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE v_ids uuid[]; n int; open_n int;
BEGIN
  SELECT array_agg(u.id) INTO v_ids FROM public.users u
   WHERE u.role='telecaller' AND u.name IN ('Dhara','Rima')
     AND EXISTS (SELECT 1 FROM public.work_members m WHERE m.user_id=u.id);
  IF coalesce(array_length(v_ids,1),0) <> 2 THEN RAISE EXCEPTION 'Phase 471 aborted: expected 2 people, found %', coalesce(array_length(v_ids,1),0); END IF;
  SELECT count(*) INTO open_n FROM public.work_task_parts p WHERE p.assignee_id = ANY(v_ids) AND p.status NOT IN ('finished','postponed');
  IF open_n <> 0 THEN RAISE EXCEPTION 'Phase 471 aborted: % open task part(s) found', open_n; END IF;
  IF EXISTS (SELECT 1 FROM public.work_time_entries e WHERE e.user_id = ANY(v_ids) AND e.ended_at IS NULL) THEN RAISE EXCEPTION 'Phase 471 aborted: a timer is running'; END IF;

  INSERT INTO public._bak_work_members_p471 SELECT m.* FROM public.work_members m WHERE m.user_id = ANY(v_ids)
    AND NOT EXISTS (SELECT 1 FROM public._bak_work_members_p471 b WHERE b.user_id=m.user_id);
  INSERT INTO public._bak_work_tracking_p471 SELECT t.* FROM public.work_tracking_people t WHERE t.user_id = ANY(v_ids)
    AND NOT EXISTS (SELECT 1 FROM public._bak_work_tracking_p471 b WHERE b.user_id=t.user_id);

  DELETE FROM public.work_tracking_people WHERE user_id = ANY(v_ids);
  DELETE FROM public.work_members WHERE user_id = ANY(v_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Phase 471: removed % member rows', n;
END $$;

SELECT (SELECT count(*) FROM public.work_members m JOIN public.users u ON u.id=m.user_id WHERE u.name IN ('Dhara','Rima') AND u.role='telecaller') AS still_members_should_be_0,
       (SELECT count(*) FROM public.work_members m JOIN public.users u ON u.id=m.user_id WHERE u.name IN ('Mayur','Solanki Sneha')) AS held_should_be_2,
       (SELECT count(*) FROM public._bak_work_members_p471) AS backed_up;
