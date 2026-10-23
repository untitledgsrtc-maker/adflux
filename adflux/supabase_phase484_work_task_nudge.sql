-- supabase_phase484_work_task_nudge.sql
-- Phase 484 (owner 23 Oct 2026): "Nudge" one person about one assigned task.
-- Who: admin / co_owner / HR / Work head / the person who created the task. Once per part per 2 hours.
-- Effects: row in work_task_nudges (the task then shows on the person's Today board for 2 days), app push,
-- PC notification (realtime), WhatsApp text if their 24h window is open (api/wa/team-nudge.js manual mode, kind 'task').
CREATE TABLE IF NOT EXISTS public.work_task_nudges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id    uuid NOT NULL REFERENCES public.work_task_parts(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,   -- the person nudged
  sent_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_task_nudges_part_idx ON public.work_task_nudges (part_id, created_at DESC);
CREATE INDEX IF NOT EXISTS work_task_nudges_user_idx ON public.work_task_nudges (user_id, created_at DESC);
ALTER TABLE public.work_task_nudges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_task_nudges_read ON public.work_task_nudges;
CREATE POLICY work_task_nudges_read ON public.work_task_nudges FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR sent_by = auth.uid() OR public.work_is_head());
REVOKE ALL ON public.work_task_nudges FROM anon, authenticated;
GRANT SELECT ON public.work_task_nudges TO authenticated;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.work_task_nudges; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- internal WhatsApp sender: same secret the other team-nudge jobs use (copied from work__reminder_wa)
DO $do$
DECLARE v_def text; v_secret text;
BEGIN
  SELECT pg_get_functiondef('public.work__reminder_wa(text,uuid[])'::regprocedure) INTO v_def;
  v_secret := substring(v_def from $re$'x-ta-secret',\s*'([^']+)'$re$);
  IF v_secret IS NULL THEN RAISE EXCEPTION 'could not read the team-nudge secret from work__reminder_wa'; END IF;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.work__task_nudge_wa(p_user uuid, p_text text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $body$
    BEGIN
      PERFORM net.http_post(
        url     := 'https://app.untitledad.in/api/wa/team-nudge',
        headers := jsonb_build_object('Content-Type','application/json','x-ta-secret', %L),
        body    := jsonb_build_object('mode','manual','kind','task','users',jsonb_build_array(p_user),'text',left(p_text,400)),
        timeout_milliseconds := 25000);
    EXCEPTION WHEN OTHERS THEN NULL;
    END; $body$;
  $fn$, v_secret);
END $do$;
REVOKE ALL ON FUNCTION public.work__task_nudge_wa(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.work_nudge_part(p_part uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role text := public.get_my_role();
  p record; t record; v_sender text; v_last timestamptz; v_due text; v_text text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.work_task_parts WHERE id = p_part;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  SELECT id, title, created_by, due_date INTO t FROM public.work_tasks WHERE id = p.task_id;
  IF NOT (COALESCE(v_role IN ('admin','co_owner','hr'), false) OR public.work_is_head() OR t.created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p.assignee_id = auth.uid() THEN RAISE EXCEPTION 'you cannot nudge yourself'; END IF;
  IF p.status IN ('finished','postponed') THEN RAISE EXCEPTION 'this task is % - nothing to nudge', p.status; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p.assignee_id AND is_active AND role NOT IN ('admin','co_owner','agency')) THEN
    RAISE EXCEPTION 'this person cannot be nudged';
  END IF;
  SELECT max(created_at) INTO v_last FROM public.work_task_nudges WHERE part_id = p_part;
  IF v_last IS NOT NULL AND v_last > now() - interval '2 hours' THEN
    RAISE EXCEPTION 'already nudged % - wait 2 hours between nudges', to_char(v_last AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');
  END IF;
  SELECT split_part(name, ' ', 1) INTO v_sender FROM public.users WHERE id = auth.uid();
  INSERT INTO public.work_task_nudges (part_id, task_id, user_id, sent_by) VALUES (p_part, t.id, p.assignee_id, auth.uid());
  v_due := CASE WHEN COALESCE(p.due_date, t.due_date) IS NOT NULL THEN ', due ' || to_char(COALESCE(p.due_date, t.due_date), 'DD Mon') ELSE '' END;
  v_text := COALESCE(v_sender, 'Your head') || ' is waiting on: ' || left(t.title, 120) || v_due || '. Please open the app.';
  PERFORM public.work_push(p.assignee_id, 'Task reminder', v_text, '/my-work', 'work-nudge-' || p_part::text);
  PERFORM public.work__task_nudge_wa(p.assignee_id, v_text);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.work_nudge_part(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_nudge_part(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
-- VERIFY (all true): table + both functions present; clients cannot run the internal sender.
-- SELECT to_regclass('public.work_task_nudges') IS NOT NULL AS tbl,
--        (SELECT count(*) FROM pg_proc WHERE proname IN ('work_nudge_part','work__task_nudge_wa')) = 2 AS two_fns,
--        NOT has_function_privilege('authenticated','public.work__task_nudge_wa(uuid,text)','execute') AS sender_blocked;
