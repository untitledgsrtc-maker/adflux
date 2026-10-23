-- Phase 473: hand Mayur's and Sneha's 3 open Work tasks to the right people, then take both off the timeclock.
-- Invoice task -> Diya (accounts, same owner as the invoice rule, section 425); the two admin tasks -> Riya (HR).
-- UNDO: restore assignee_id/status from _bak_work_parts_p473; INSERT INTO work_members SELECT * FROM _bak_work_members_p473 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public._bak_work_parts_p473 AS SELECT * FROM public.work_task_parts WHERE false;
CREATE TABLE IF NOT EXISTS public._bak_work_members_p473 AS SELECT * FROM public.work_members WHERE false;
ALTER TABLE public._bak_work_parts_p473 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_work_members_p473 ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE v_diya uuid; v_riya uuid; v_ids uuid[]; v_parts uuid[]; n int;
BEGIN
  SELECT id INTO v_diya FROM users WHERE role='accounts' AND is_active LIMIT 1;
  SELECT id INTO v_riya FROM users WHERE role='hr' AND is_active LIMIT 1;
  IF v_diya IS NULL OR v_riya IS NULL THEN RAISE EXCEPTION 'Phase 473 aborted: Diya or Riya not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM work_members WHERE user_id=v_diya) OR NOT EXISTS (SELECT 1 FROM work_members WHERE user_id=v_riya) THEN RAISE EXCEPTION 'Phase 473 aborted: Diya/Riya not on the timeclock'; END IF;
  SELECT array_agg(id) INTO v_ids FROM users WHERE (name='Mayur' AND role='sales') OR (name='Solanki Sneha' AND role='telecaller');
  IF coalesce(array_length(v_ids,1),0)<>2 THEN RAISE EXCEPTION 'Phase 473 aborted: expected 2 people'; END IF;
  IF EXISTS (SELECT 1 FROM work_time_entries WHERE user_id=ANY(v_ids) AND ended_at IS NULL) THEN RAISE EXCEPTION 'Phase 473 aborted: timer running'; END IF;
  SELECT array_agg(p.id) INTO v_parts FROM work_task_parts p WHERE p.assignee_id=ANY(v_ids) AND p.status NOT IN ('finished','postponed');
  IF coalesce(array_length(v_parts,1),0)<>3 THEN RAISE EXCEPTION 'Phase 473 aborted: expected 3 open parts, found %', coalesce(array_length(v_parts,1),0); END IF;
  INSERT INTO _bak_work_parts_p473 SELECT p.* FROM work_task_parts p WHERE p.id=ANY(v_parts) AND NOT EXISTS (SELECT 1 FROM _bak_work_parts_p473 b WHERE b.id=p.id);
  INSERT INTO _bak_work_members_p473 SELECT m.* FROM work_members m WHERE m.user_id=ANY(v_ids) AND NOT EXISTS (SELECT 1 FROM _bak_work_members_p473 b WHERE b.user_id=m.user_id);
  UPDATE work_task_parts p SET assignee_id = CASE WHEN t.title ILIKE 'Raise tax invoice%' THEN v_diya ELSE v_riya END
    FROM work_tasks t WHERE t.id=p.task_id AND p.id=ANY(v_parts);
  GET DIAGNOSTICS n = ROW_COUNT; IF n<>3 THEN RAISE EXCEPTION 'Phase 473 aborted: moved % parts', n; END IF;
  DELETE FROM work_tracking_people WHERE user_id=ANY(v_ids);
  DELETE FROM work_members WHERE user_id=ANY(v_ids);
END $$;
SELECT u.name AS now_holds, t.title, p.status FROM work_task_parts p JOIN work_tasks t ON t.id=p.task_id JOIN users u ON u.id=p.assignee_id WHERE p.id IN (SELECT id FROM _bak_work_parts_p473)
UNION ALL SELECT 'sales_tc_members_left='||count(*), '', '' FROM work_members m JOIN users u ON u.id=m.user_id WHERE u.role IN ('sales','telecaller');
