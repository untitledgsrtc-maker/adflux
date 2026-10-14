-- ============================================================
-- Phase 365 - WORK MODULE (timeclock + tasks) for the creative team
-- Replaces Trackdek (ends 30 Nov 2026). Plan: docs/PLAN_creative_timeclock_structure.md
-- ADDITIVE ONLY: new tables + new functions. Touches NO sales / lead / quote /
-- payroll object (section 45). Hours have NO pay effect (display + cost report only).
--
-- Rules baked in (do not regress):
--  * Every write goes through a SECURITY DEFINER function below; clients get SELECT only.
--  * ONE running timer per person (partial unique index).
--  * A timer never crosses midnight IST; forgotten timers auto-stop at 21:30 IST (cron).
--  * Task status is DERIVED from its parts; a task is finished when all parts are.
--  * Cost = approved hours x (monthly_salary / 26 / 8). Admin + accounts only (section 153).
--  * Added-later time is 'pending' until a head approves it.
--  * NULL role fails closed everywhere (section 41).
-- ============================================================

-- ---------- 1. TABLES ----------
CREATE TABLE IF NOT EXISTS public.work_members (
  user_id    uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  is_head    boolean NOT NULL DEFAULT false,
  added_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  kind       text NOT NULL DEFAULT 'client' CHECK (kind IN ('client','internal','govt')),
  client_id  uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS work_projects_name_uk ON public.work_projects (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.work_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  project_id    uuid REFERENCES public.work_projects(id) ON DELETE SET NULL,
  assignee_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  repeat_kind   text NOT NULL CHECK (repeat_kind IN ('daily','weekly','monthly')),
  weekday       int  CHECK (weekday BETWEEN 1 AND 7),     -- ISO: 1 = Mon .. 7 = Sun
  month_day     int  CHECK (month_day BETWEEN 1 AND 28),
  start_date    date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  end_date      date,
  is_active     boolean NOT NULL DEFAULT true,
  last_run_date date,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  project_id  uuid REFERENCES public.work_projects(id) ON DELETE SET NULL,
  note        text,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  due_date    date,
  status      text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_process','finished')),
  template_id uuid REFERENCES public.work_templates(id) ON DELETE SET NULL,
  finished_at timestamptz,
  cost_amount numeric(12,2),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_tasks_status_idx ON public.work_tasks (status, due_date);
CREATE INDEX IF NOT EXISTS work_tasks_created_by_idx ON public.work_tasks (created_by);
CREATE UNIQUE INDEX IF NOT EXISTS work_tasks_template_day_uk
  ON public.work_tasks (template_id, due_date) WHERE template_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_task_parts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label       text,
  due_date    date,
  status      text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_process','finished')),
  started_at  timestamptz,
  finished_at timestamptz,
  finish_note text,
  seconds     int,
  cost_amount numeric(12,2),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_parts_assignee_idx ON public.work_task_parts (assignee_id, status);
CREATE INDEX IF NOT EXISTS work_parts_task_idx ON public.work_task_parts (task_id);

CREATE TABLE IF NOT EXISTS public.work_task_steps (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id  uuid NOT NULL REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  label    text NOT NULL,
  done     boolean NOT NULL DEFAULT false,
  done_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  done_at  timestamptz,
  position int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS work_steps_task_idx ON public.work_task_steps (task_id);

CREATE TABLE IF NOT EXISTS public.work_task_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_comments_task_idx ON public.work_task_comments (task_id, created_at);

CREATE TABLE IF NOT EXISTS public.work_task_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  part_id    uuid,
  user_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event      text NOT NULL,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_log_task_idx ON public.work_task_log (task_id, created_at);

CREATE TABLE IF NOT EXISTS public.work_time_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES public.work_projects(id) ON DELETE SET NULL,
  task_id      uuid REFERENCES public.work_tasks(id) ON DELETE SET NULL,
  part_id      uuid REFERENCES public.work_task_parts(id) ON DELETE SET NULL,
  task_label   text,
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz,
  source       text NOT NULL DEFAULT 'timer' CHECK (source IN ('timer','added_later')),
  status       text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','pending','declined')),
  auto_stopped boolean NOT NULL DEFAULT false,
  note         text,
  decided_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_entry_order CHECK (ended_at IS NULL OR ended_at > started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS work_entries_one_running_uk
  ON public.work_time_entries (user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS work_entries_user_day_idx ON public.work_time_entries (user_id, started_at);
CREATE INDEX IF NOT EXISTS work_entries_project_idx ON public.work_time_entries (project_id, started_at);
CREATE INDEX IF NOT EXISTS work_entries_part_idx ON public.work_time_entries (part_id) WHERE part_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_report_shares (
  user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  shared_at timestamptz NOT NULL DEFAULT now(),
  note      text,
  PRIMARY KEY (user_id, work_date)
);

-- ---------- 2. HELPERS (internal, DEFINER so RLS policies never recurse) ----------
CREATE OR REPLACE FUNCTION public.work_is_active_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT u.is_active FROM public.users u WHERE u.id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION public.work_is_head() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    public.work_is_active_user() AND (
      public.get_my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.work_members m WHERE m.user_id = auth.uid() AND m.is_head)
    ), false);
$$;

CREATE OR REPLACE FUNCTION public.work_is_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    public.work_is_active_user() AND (
      public.work_is_head()
      OR EXISTS (SELECT 1 FROM public.work_members m WHERE m.user_id = auth.uid())
    ), false);
$$;

CREATE OR REPLACE FUNCTION public.work_can_see_task(p_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    public.work_is_active_user() AND (
      public.work_is_head()
      OR EXISTS (SELECT 1 FROM public.work_tasks t WHERE t.id = p_task AND t.created_by = auth.uid())
      OR EXISTS (SELECT 1 FROM public.work_task_parts p WHERE p.task_id = p_task AND p.assignee_id = auth.uid())
    ), false);
$$;

-- hourly rate = monthly salary / 26 days / 8 hours (owner 13 Oct 2026). 0 when no salary on file.
CREATE OR REPLACE FUNCTION public.work_user_rate(p_user uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT round(s.monthly_salary / 26.0 / 8.0, 2)
                     FROM public.staff_incentive_profiles s
                    WHERE s.user_id = p_user
                    ORDER BY s.is_active DESC NULLS LAST LIMIT 1), 0);
$$;

CREATE OR REPLACE FUNCTION public.work_log(p_task uuid, p_part uuid, p_event text, p_detail jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.work_task_log (task_id, part_id, user_id, event, detail)
  VALUES (p_task, p_part, auth.uid(), p_event, p_detail);
$$;

-- best-effort push (never raises, quiet hours respected)
CREATE OR REPLACE FUNCTION public.work_push(p_user uuid, p_title text, p_body text, p_url text, p_tag text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  IF p_user IS NULL OR NOT public.is_push_allowed_now() THEN RETURN; END IF;
  PERFORM public.enqueue_push(p_user, p_title, p_body, p_url, p_tag);
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.work_refresh_task(p_task uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_total int; v_fin int; v_proc int; v_cost numeric; v_status text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status='finished'), count(*) FILTER (WHERE status='in_process'),
         COALESCE(sum(cost_amount) FILTER (WHERE status='finished'), 0)
    INTO v_total, v_fin, v_proc, v_cost
    FROM public.work_task_parts WHERE task_id = p_task;
  IF v_total = 0 THEN RETURN; END IF;
  v_status := CASE WHEN v_fin = v_total THEN 'finished'
                   WHEN v_proc > 0 OR v_fin > 0 THEN 'in_process'
                   ELSE 'assigned' END;
  UPDATE public.work_tasks
     SET status = v_status,
         finished_at = CASE WHEN v_status = 'finished' THEN COALESCE(finished_at, now()) ELSE NULL END,
         cost_amount = CASE WHEN v_status = 'finished' THEN v_cost ELSE NULL END
   WHERE id = p_task;
END;
$$;

-- stop one running entry for a user (splits at midnight IST if it started on an earlier day)
CREATE OR REPLACE FUNCTION public.work__stop_running(p_user uuid, p_auto boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.work_time_entries%ROWTYPE; v_end timestamptz; v_midnight timestamptz;
BEGIN
  SELECT * INTO r FROM public.work_time_entries WHERE user_id = p_user AND ended_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_end := now();
  v_midnight := ((((r.started_at AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamp) AT TIME ZONE 'Asia/Kolkata');
  IF v_end > v_midnight THEN v_end := v_midnight - interval '1 second'; p_auto := true; END IF;
  IF v_end <= r.started_at THEN v_end := r.started_at + interval '1 second'; END IF;
  UPDATE public.work_time_entries SET ended_at = v_end, auto_stopped = p_auto WHERE id = r.id;
  RETURN r.id;
END;
$$;

-- ---------- 3. RLS (read-only for clients; all writes via the functions below) ----------
ALTER TABLE public.work_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_task_parts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_task_steps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_task_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_time_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_report_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_members_read ON public.work_members;
CREATE POLICY work_members_read ON public.work_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.work_is_head());

DROP POLICY IF EXISTS work_projects_read ON public.work_projects;
CREATE POLICY work_projects_read ON public.work_projects FOR SELECT TO authenticated
  USING (public.work_is_active_user());

DROP POLICY IF EXISTS work_templates_read ON public.work_templates;
CREATE POLICY work_templates_read ON public.work_templates FOR SELECT TO authenticated
  USING (public.work_is_active_user() AND (created_by = auth.uid() OR assignee_id = auth.uid() OR public.work_is_head()));

DROP POLICY IF EXISTS work_tasks_read ON public.work_tasks;
CREATE POLICY work_tasks_read ON public.work_tasks FOR SELECT TO authenticated
  USING (public.work_can_see_task(id));

DROP POLICY IF EXISTS work_parts_read ON public.work_task_parts;
CREATE POLICY work_parts_read ON public.work_task_parts FOR SELECT TO authenticated
  USING (public.work_can_see_task(task_id));

DROP POLICY IF EXISTS work_steps_read ON public.work_task_steps;
CREATE POLICY work_steps_read ON public.work_task_steps FOR SELECT TO authenticated
  USING (public.work_can_see_task(task_id));

DROP POLICY IF EXISTS work_comments_read ON public.work_task_comments;
CREATE POLICY work_comments_read ON public.work_task_comments FOR SELECT TO authenticated
  USING (public.work_can_see_task(task_id));

DROP POLICY IF EXISTS work_log_read ON public.work_task_log;
CREATE POLICY work_log_read ON public.work_task_log FOR SELECT TO authenticated
  USING (public.work_can_see_task(task_id));

DROP POLICY IF EXISTS work_entries_read ON public.work_time_entries;
CREATE POLICY work_entries_read ON public.work_time_entries FOR SELECT TO authenticated
  USING (public.work_is_active_user() AND (user_id = auth.uid() OR public.work_is_head()));

DROP POLICY IF EXISTS work_shares_read ON public.work_report_shares;
CREATE POLICY work_shares_read ON public.work_report_shares FOR SELECT TO authenticated
  USING (public.work_is_active_user() AND (user_id = auth.uid() OR public.work_is_head()));

-- tables: no write grants to clients at all
REVOKE ALL ON public.work_members, public.work_projects, public.work_templates, public.work_tasks,
              public.work_task_parts, public.work_task_steps, public.work_task_comments,
              public.work_task_log, public.work_time_entries, public.work_report_shares
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_members, public.work_projects, public.work_templates, public.work_tasks,
                public.work_task_parts, public.work_task_steps, public.work_task_comments,
                public.work_task_log, public.work_time_entries, public.work_report_shares
  TO authenticated;

-- Salary-derived cost must NEVER reach a creator / assignee / non-admin head (section 153):
-- cost_amount is NOT readable by clients. Admin + accounts get cost only through work_cost_report().
REVOKE SELECT ON public.work_task_parts, public.work_tasks FROM authenticated;
GRANT SELECT (id, task_id, assignee_id, label, due_date, status, started_at, finished_at, finish_note, seconds, created_at)
  ON public.work_task_parts TO authenticated;
GRANT SELECT (id, title, project_id, note, created_by, due_date, status, template_id, finished_at, created_at)
  ON public.work_tasks TO authenticated;

-- ---------- 4. PUBLIC FUNCTIONS (the only write path) ----------
-- 4.1 timer: start (optionally on a task part). Stops the running one in the same step.
CREATE OR REPLACE FUNCTION public.work_clock_start(p_project uuid, p_label text, p_part uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_task public.work_tasks%ROWTYPE;
        v_project uuid := p_project; v_label text := NULLIF(btrim(p_label), ''); v_entry uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF p_part IS NOT NULL THEN
    SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
    IF NOT FOUND OR v_part.assignee_id <> v_uid THEN RAISE EXCEPTION 'that task is not yours' USING ERRCODE='42501'; END IF;
    IF v_part.status = 'finished' THEN RAISE EXCEPTION 'this task is already finished'; END IF;
    SELECT * INTO v_task FROM public.work_tasks WHERE id = v_part.task_id;
    v_project := COALESCE(v_project, v_task.project_id);
    v_label := COALESCE(v_label, v_task.title);
  END IF;
  IF v_project IS NULL THEN RAISE EXCEPTION 'pick a client first'; END IF;
  IF v_label IS NULL THEN RAISE EXCEPTION 'type what you are doing'; END IF;
  IF length(v_label) > 80 THEN v_label := left(v_label, 80); END IF;
  PERFORM public.work__stop_running(v_uid, false);
  INSERT INTO public.work_time_entries (user_id, project_id, task_id, part_id, task_label, started_at)
  VALUES (v_uid, v_project, v_task.id, v_part.id, v_label, now())
  RETURNING id INTO v_entry;
  IF p_part IS NOT NULL THEN
    UPDATE public.work_task_parts SET status = 'in_process', started_at = COALESCE(started_at, now()) WHERE id = p_part;
    PERFORM public.work_refresh_task(v_task.id);
    PERFORM public.work_log(v_task.id, p_part, 'started', NULL);
  END IF;
  RETURN v_entry;
END;
$$;

-- 4.2 timer: stop
CREATE OR REPLACE FUNCTION public.work_clock_stop() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_task uuid; v_part uuid; v_secs int;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  v_id := public.work__stop_running(v_uid, false);
  IF v_id IS NOT NULL THEN
    SELECT task_id, part_id, extract(epoch FROM (ended_at - started_at))::int INTO v_task, v_part, v_secs
      FROM public.work_time_entries WHERE id = v_id;
    IF v_task IS NOT NULL THEN PERFORM public.work_log(v_task, v_part, 'paused', jsonb_build_object('seconds', v_secs)); END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- 4.3 create a task with 1..N parts (+ optional checklist)
-- p_parts = [{"assignee":"<uuid>","label":"Reel 1","due":"2026-10-15"}]
CREATE OR REPLACE FUNCTION public.work_create_task(p_title text, p_project uuid, p_note text, p_due date,
                                                   p_parts jsonb, p_steps text[] DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_task uuid; v_part jsonb; v_assignee uuid; v_i int := 0; v_s text; v_name text;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_title), '') IS NULL THEN RAISE EXCEPTION 'task needs a name'; END IF;
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) = 0 THEN
    RAISE EXCEPTION 'pick at least one person';
  END IF;
  IF jsonb_array_length(p_parts) > 12 THEN RAISE EXCEPTION 'too many people on one task'; END IF;
  INSERT INTO public.work_tasks (title, project_id, note, created_by, due_date)
  VALUES (left(btrim(p_title), 120), p_project, NULLIF(btrim(p_note), ''), v_uid, p_due)
  RETURNING id INTO v_task;
  SELECT name INTO v_name FROM public.users WHERE id = v_uid;
  FOR v_part IN SELECT * FROM jsonb_array_elements(p_parts) LOOP
    v_assignee := NULLIF(v_part->>'assignee', '')::uuid;
    IF v_assignee IS NULL OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_assignee AND u.is_active) THEN
      RAISE EXCEPTION 'unknown or inactive person';
    END IF;
    INSERT INTO public.work_task_parts (task_id, assignee_id, label, due_date)
    VALUES (v_task, v_assignee, NULLIF(left(btrim(COALESCE(v_part->>'label','')), 80), ''),
            COALESCE(NULLIF(v_part->>'due','')::date, p_due));
    -- an assignee gets the timeclock automatically (head can remove them)
    INSERT INTO public.work_members (user_id, added_by) VALUES (v_assignee, v_uid) ON CONFLICT (user_id) DO NOTHING;
    IF v_assignee <> v_uid THEN
      PERFORM public.work_push(v_assignee, 'New task for you', COALESCE(v_name,'Someone') || ': ' || left(btrim(p_title), 80),
                               '/my-work', 'work-task-' || v_task::text);
    END IF;
  END LOOP;
  IF p_steps IS NOT NULL THEN
    FOREACH v_s IN ARRAY p_steps LOOP
      IF NULLIF(btrim(v_s), '') IS NOT NULL THEN
        v_i := v_i + 1;
        INSERT INTO public.work_task_steps (task_id, label, position) VALUES (v_task, left(btrim(v_s), 120), v_i);
      END IF;
    END LOOP;
  END IF;
  PERFORM public.work_log(v_task, NULL, 'created', jsonb_build_object('parts', jsonb_array_length(p_parts)));
  RETURN v_task;
END;
$$;

-- 4.4 finish a part (stops its timer, saves hours + cost, tells the asker)
CREATE OR REPLACE FUNCTION public.work_finish_part(p_part uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_task public.work_tasks%ROWTYPE;
        v_secs int; v_cost numeric; v_name text; v_done boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF v_part.assignee_id <> v_uid AND NOT public.work_is_head() THEN RAISE EXCEPTION 'not your task' USING ERRCODE='42501'; END IF;
  IF v_part.status = 'finished' THEN RETURN; END IF;
  -- stop the assignee's running timer if it is on this part
  IF EXISTS (SELECT 1 FROM public.work_time_entries WHERE user_id = v_part.assignee_id AND ended_at IS NULL AND part_id = p_part) THEN
    PERFORM public.work__stop_running(v_part.assignee_id, false);
  END IF;
  SELECT COALESCE(sum(extract(epoch FROM (ended_at - started_at))), 0)::int INTO v_secs
    FROM public.work_time_entries WHERE part_id = p_part AND ended_at IS NOT NULL AND status = 'approved';
  v_cost := round(v_secs / 3600.0 * public.work_user_rate(v_part.assignee_id), 2);
  UPDATE public.work_task_parts
     SET status = 'finished', finished_at = now(), finish_note = NULLIF(btrim(p_note), ''),
         seconds = v_secs, cost_amount = v_cost, started_at = COALESCE(started_at, now())
   WHERE id = p_part;
  PERFORM public.work_refresh_task(v_part.task_id);
  SELECT * INTO v_task FROM public.work_tasks WHERE id = v_part.task_id;
  PERFORM public.work_log(v_part.task_id, p_part, 'finished', jsonb_build_object('seconds', v_secs, 'by_head', v_uid <> v_part.assignee_id));
  v_done := (v_task.status = 'finished');
  IF v_task.created_by IS NOT NULL AND v_task.created_by <> v_uid THEN
    SELECT name INTO v_name FROM public.users WHERE id = v_part.assignee_id;
    PERFORM public.work_push(v_task.created_by,
      CASE WHEN v_done THEN 'Task finished' ELSE 'Part finished' END,
      COALESCE(v_name,'Someone') || ' finished: ' || left(v_task.title, 80), '/my-work?tab=asked', 'work-done-' || v_task.id::text);
  END IF;
END;
$$;

-- 4.5 move a part to a status (the board's drag and drop). A person moves only their own part, forward.
CREATE OR REPLACE FUNCTION public.work_move_part(p_part uuid, p_to text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_head boolean; v_rank_from int; v_rank_to int;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  IF p_to NOT IN ('assigned','in_process','finished') THEN RAISE EXCEPTION 'bad status'; END IF;
  SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  v_head := public.work_is_head();
  IF v_part.assignee_id <> v_uid AND NOT v_head THEN RAISE EXCEPTION 'not your task' USING ERRCODE='42501'; END IF;
  v_rank_from := CASE v_part.status WHEN 'assigned' THEN 1 WHEN 'in_process' THEN 2 ELSE 3 END;
  v_rank_to   := CASE p_to WHEN 'assigned' THEN 1 WHEN 'in_process' THEN 2 ELSE 3 END;
  IF v_rank_to = v_rank_from THEN RETURN; END IF;
  IF v_rank_to < v_rank_from AND NOT v_head THEN RAISE EXCEPTION 'only the head can move a task back'; END IF;
  IF p_to = 'finished' THEN
    PERFORM public.work_finish_part(p_part, NULL);
  ELSIF p_to = 'in_process' THEN
    IF v_rank_from = 3 THEN  -- reopen
      UPDATE public.work_task_parts SET status='in_process', finished_at=NULL, cost_amount=NULL, seconds=NULL WHERE id=p_part;
      PERFORM public.work_refresh_task(v_part.task_id);
      PERFORM public.work_log(v_part.task_id, p_part, 'reopened', NULL);
    ELSIF v_part.assignee_id = v_uid THEN
      PERFORM public.work_clock_start(NULL, NULL, p_part);
    ELSE
      UPDATE public.work_task_parts SET status='in_process', started_at = COALESCE(started_at, now()) WHERE id=p_part;
      PERFORM public.work_refresh_task(v_part.task_id);
      PERFORM public.work_log(v_part.task_id, p_part, 'moved', jsonb_build_object('to', p_to));
    END IF;
  ELSE -- back to assigned (head)
    IF EXISTS (SELECT 1 FROM public.work_time_entries WHERE user_id = v_part.assignee_id AND ended_at IS NULL AND part_id = p_part) THEN
      PERFORM public.work__stop_running(v_part.assignee_id, false);
    END IF;
    UPDATE public.work_task_parts SET status='assigned', finished_at=NULL, cost_amount=NULL, seconds=NULL WHERE id=p_part;
    PERFORM public.work_refresh_task(v_part.task_id);
    PERFORM public.work_log(v_part.task_id, p_part, 'moved', jsonb_build_object('to', p_to));
  END IF;
END;
$$;

-- 4.6 comments + checklist
CREATE OR REPLACE FUNCTION public.work_add_comment(p_task uuid, p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_name text; v_title text; v_who uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.work_can_see_task(p_task) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'write something'; END IF;
  INSERT INTO public.work_task_comments (task_id, user_id, body) VALUES (p_task, v_uid, left(btrim(p_body), 1000)) RETURNING id INTO v_id;
  PERFORM public.work_log(p_task, NULL, 'commented', NULL);
  SELECT name INTO v_name FROM public.users WHERE id = v_uid;
  SELECT title INTO v_title FROM public.work_tasks WHERE id = p_task;
  FOR v_who IN
    SELECT DISTINCT x FROM (
      SELECT created_by AS x FROM public.work_tasks WHERE id = p_task
      UNION SELECT assignee_id FROM public.work_task_parts WHERE task_id = p_task
    ) s WHERE x IS NOT NULL AND x <> v_uid
  LOOP
    PERFORM public.work_push(v_who, 'New comment', COALESCE(v_name,'Someone') || ' on ' || left(COALESCE(v_title,'a task'), 60),
                             '/my-work', 'work-cmt-' || p_task::text);
  END LOOP;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.work_add_step(p_task uuid, p_label text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_pos int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_can_see_task(p_task) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_label), '') IS NULL THEN RAISE EXCEPTION 'write a step'; END IF;
  SELECT COALESCE(max(position), 0) + 1 INTO v_pos FROM public.work_task_steps WHERE task_id = p_task;
  INSERT INTO public.work_task_steps (task_id, label, position) VALUES (p_task, left(btrim(p_label), 120), v_pos) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.work_toggle_step(p_step uuid, p_done boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_task uuid;
BEGIN
  SELECT task_id INTO v_task FROM public.work_task_steps WHERE id = p_step;
  IF v_task IS NULL OR auth.uid() IS NULL OR NOT public.work_can_see_task(v_task) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  UPDATE public.work_task_steps
     SET done = COALESCE(p_done, false),
         done_by = CASE WHEN COALESCE(p_done, false) THEN auth.uid() ELSE NULL END,
         done_at = CASE WHEN COALESCE(p_done, false) THEN now() ELSE NULL END
   WHERE id = p_step;
END;
$$;

-- 4.7 change due date / reassign a part (head or the asker)
CREATE OR REPLACE FUNCTION public.work_set_due(p_task uuid, p_part uuid, p_due date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_creator uuid;
BEGIN
  SELECT created_by INTO v_creator FROM public.work_tasks WHERE id = p_task;
  IF v_uid IS NULL OR NOT (public.work_is_head() OR v_creator = v_uid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF p_part IS NULL THEN UPDATE public.work_tasks SET due_date = p_due WHERE id = p_task;
  ELSE UPDATE public.work_task_parts SET due_date = p_due WHERE id = p_part AND task_id = p_task; END IF;
  PERFORM public.work_log(p_task, p_part, 'due_changed', jsonb_build_object('due', p_due));
END;
$$;

CREATE OR REPLACE FUNCTION public.work_reassign_part(p_part uuid, p_to uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_creator uuid;
BEGIN
  SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  SELECT created_by INTO v_creator FROM public.work_tasks WHERE id = v_part.task_id;
  IF v_uid IS NULL OR NOT (public.work_is_head() OR v_creator = v_uid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF v_part.status = 'finished' THEN RAISE EXCEPTION 'already finished'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_to AND u.is_active) THEN RAISE EXCEPTION 'unknown or inactive person'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_time_entries WHERE user_id = v_part.assignee_id AND ended_at IS NULL AND part_id = p_part) THEN
    PERFORM public.work__stop_running(v_part.assignee_id, false);
  END IF;
  UPDATE public.work_task_parts SET assignee_id = p_to, status = 'assigned', started_at = NULL WHERE id = p_part;
  INSERT INTO public.work_members (user_id, added_by) VALUES (p_to, v_uid) ON CONFLICT (user_id) DO NOTHING;
  PERFORM public.work_refresh_task(v_part.task_id);
  PERFORM public.work_log(v_part.task_id, p_part, 'reassigned', jsonb_build_object('to', p_to));
  PERFORM public.work_push(p_to, 'Task assigned to you', 'You were given a task', '/my-work', 'work-task-' || v_part.task_id::text);
END;
$$;

-- 4.8 added-later time (needs a head's OK) and the head's decision
CREATE OR REPLACE FUNCTION public.work_add_manual_time(p_project uuid, p_label text, p_start timestamptz, p_end timestamptz, p_note text DEFAULT NULL)
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

CREATE OR REPLACE FUNCTION public.work_decide_time(p_entry uuid, p_approve boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_user uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_head() THEN RAISE EXCEPTION 'head only' USING ERRCODE='42501'; END IF;
  UPDATE public.work_time_entries
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END, decided_by = v_uid, decided_at = now()
   WHERE id = p_entry AND status = 'pending'
  RETURNING user_id INTO v_user;
  IF v_user IS NOT NULL THEN
    PERFORM public.work_push(v_user, CASE WHEN p_approve THEN 'Time approved' ELSE 'Time declined' END,
                             'Your added-later time was ' || CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
                             '/my-work', 'work-time-' || p_entry::text);
  END IF;
END;
$$;

-- 4.9 projects (clients): anyone on the timeclock adds; head renames / archives
CREATE OR REPLACE FUNCTION public.work_add_project(p_name text, p_kind text DEFAULT 'client') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_name text := left(btrim(COALESCE(p_name,'')), 80);
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'type a name'; END IF;
  IF p_kind NOT IN ('client','internal','govt') THEN p_kind := 'client'; END IF;
  SELECT id INTO v_id FROM public.work_projects WHERE lower(btrim(name)) = lower(v_name);
  IF v_id IS NOT NULL THEN
    UPDATE public.work_projects SET is_active = true WHERE id = v_id AND NOT is_active AND public.work_is_head();
    RETURN v_id;
  END IF;
  INSERT INTO public.work_projects (name, kind, created_by) VALUES (v_name, p_kind, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.work_update_project(p_id uuid, p_name text, p_active boolean, p_merge_into uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_is_head() THEN RAISE EXCEPTION 'head only' USING ERRCODE='42501'; END IF;
  IF p_merge_into IS NOT NULL AND p_merge_into <> p_id THEN
    UPDATE public.work_time_entries SET project_id = p_merge_into WHERE project_id = p_id;
    UPDATE public.work_tasks SET project_id = p_merge_into WHERE project_id = p_id;
    UPDATE public.work_templates SET project_id = p_merge_into WHERE project_id = p_id;
    DELETE FROM public.work_projects WHERE id = p_id;
    RETURN;
  END IF;
  UPDATE public.work_projects
     SET name = COALESCE(NULLIF(left(btrim(COALESCE(p_name,'')), 80), ''), name),
         is_active = COALESCE(p_active, is_active)
   WHERE id = p_id;
END;
$$;

-- 4.10 who is on the timeclock (admin)
CREATE OR REPLACE FUNCTION public.work_set_member(p_user uuid, p_member boolean, p_head boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_my_role() IS DISTINCT FROM 'admin' OR NOT public.work_is_active_user() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  IF p_member THEN
    INSERT INTO public.work_members (user_id, is_head, added_by) VALUES (p_user, COALESCE(p_head, false), auth.uid())
    ON CONFLICT (user_id) DO UPDATE SET is_head = COALESCE(p_head, false);
  ELSE
    DELETE FROM public.work_members WHERE user_id = p_user;
  END IF;
END;
$$;

-- 4.11 recurring templates
CREATE OR REPLACE FUNCTION public.work_save_template(p_title text, p_project uuid, p_assignee uuid, p_repeat text,
                                                    p_weekday int, p_month_day int, p_start date, p_end date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_title), '') IS NULL THEN RAISE EXCEPTION 'repeating task needs a name'; END IF;
  IF p_repeat NOT IN ('daily','weekly','monthly') THEN RAISE EXCEPTION 'bad repeat'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_assignee AND u.is_active) THEN RAISE EXCEPTION 'unknown or inactive person'; END IF;
  INSERT INTO public.work_templates (title, project_id, assignee_id, repeat_kind, weekday, month_day, start_date, end_date, created_by)
  VALUES (left(btrim(p_title), 120), p_project, p_assignee, p_repeat, p_weekday, p_month_day,
          COALESCE(p_start, (now() AT TIME ZONE 'Asia/Kolkata')::date), p_end, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.work_members (user_id, added_by) VALUES (p_assignee, auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.work_stop_template(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.work_is_head() OR EXISTS (SELECT 1 FROM public.work_templates t WHERE t.id = p_id AND t.created_by = auth.uid())) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE='42501';
  END IF;
  UPDATE public.work_templates SET is_active = false WHERE id = p_id;
END;
$$;

-- 4.12 evening report: record that the person shared it
CREATE OR REPLACE FUNCTION public.work_mark_report_shared(p_date date, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  INSERT INTO public.work_report_shares (user_id, work_date, note)
  VALUES (auth.uid(), p_date, NULLIF(left(btrim(COALESCE(p_note,'')), 300), ''))
  ON CONFLICT (user_id, work_date) DO UPDATE SET shared_at = now(), note = EXCLUDED.note;
END;
$$;

-- 4.13 head report: hours per person and per client over a range (server-side, section 66)
CREATE OR REPLACE FUNCTION public.work_hours_report(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_is_head() THEN RETURN '{}'::jsonb; END IF;
  IF p_to - p_from > 92 THEN p_to := p_from + 92; END IF;
  v_from := (p_from::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_to   := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  WITH e AS (
    SELECT user_id, project_id, task_id, started_at,
           extract(epoch FROM (COALESCE(ended_at, now()) - started_at))::bigint AS secs,
           (started_at AT TIME ZONE 'Asia/Kolkata')::date AS d, ended_at
      FROM public.work_time_entries
     WHERE status = 'approved' AND started_at >= v_from AND started_at < v_to
  )
  SELECT jsonb_build_object(
    'by_person', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', x.user_id, 'seconds', x.s, 'days', x.dd,
                         'first_in', x.fi, 'last_out', x.lo)) FROM (
        SELECT user_id, sum(secs) s, count(DISTINCT d) dd, min(started_at) fi, max(ended_at) lo FROM e GROUP BY user_id) x), '[]'::jsonb),
    'by_project', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', y.project_id, 'seconds', y.s, 'people', y.pp,
                         'last_day', y.ld)) FROM (
        SELECT project_id, sum(secs) s, count(DISTINCT user_id) pp, max(d) ld FROM e GROUP BY project_id) y), '[]'::jsonb),
    'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', z.user_id, 'day', z.d, 'seconds', z.s)) FROM (
        SELECT user_id, d, sum(secs) s FROM e GROUP BY user_id, d) z), '[]'::jsonb),
    'pending', (SELECT count(*) FROM public.work_time_entries WHERE status = 'pending')
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- 4.14 cost report (admin + accounts only, section 153): hours x salary rate
CREATE OR REPLACE FUNCTION public.work_cost_report(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_out jsonb; v_role text := public.get_my_role();
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('admin','accounts') OR NOT public.work_is_active_user() THEN
    RETURN '{}'::jsonb;
  END IF;
  IF p_to - p_from > 92 THEN p_to := p_from + 92; END IF;
  v_from := (p_from::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_to   := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  WITH rate AS (
    SELECT s.user_id, round(s.monthly_salary / 26.0 / 8.0, 2) AS r FROM public.staff_incentive_profiles s
  ), e AS (
    SELECT e.user_id, e.project_id, e.task_id,
           extract(epoch FROM (COALESCE(e.ended_at, now()) - e.started_at)) AS secs,
           COALESCE(rt.r, 0) AS rate
      FROM public.work_time_entries e LEFT JOIN rate rt ON rt.user_id = e.user_id
     WHERE e.status = 'approved' AND e.started_at >= v_from AND e.started_at < v_to
  )
  SELECT jsonb_build_object(
    'total_cost', COALESCE((SELECT round(sum(secs / 3600.0 * rate), 2) FROM e), 0),
    'total_seconds', COALESCE((SELECT sum(secs)::bigint FROM e), 0),
    'unassigned_seconds', COALESCE((SELECT sum(secs)::bigint FROM e WHERE task_id IS NULL), 0),
    'by_task', COALESCE((SELECT jsonb_agg(jsonb_build_object('task_id', t.task_id, 'seconds', t.s, 'cost', t.c, 'people', t.p)) FROM (
        SELECT task_id, sum(secs)::bigint s, round(sum(secs / 3600.0 * rate), 2) c, count(DISTINCT user_id) p
          FROM e WHERE task_id IS NOT NULL GROUP BY task_id) t), '[]'::jsonb),
    'by_project', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', t.project_id, 'seconds', t.s, 'cost', t.c)) FROM (
        SELECT project_id, sum(secs)::bigint s, round(sum(secs / 3600.0 * rate), 2) c FROM e GROUP BY project_id) t), '[]'::jsonb),
    'by_person', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', t.user_id, 'seconds', t.s, 'cost', t.c)) FROM (
        SELECT user_id, sum(secs)::bigint s, round(sum(secs / 3600.0 * rate), 2) c FROM e GROUP BY user_id) t), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ---------- 5. CRON FUNCTIONS (not callable by clients) ----------
CREATE OR REPLACE FUNCTION public.work_autostop_all() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int;
BEGIN
  WITH s AS (
    UPDATE public.work_time_entries
       SET ended_at = GREATEST(now(), started_at + interval '1 second'), auto_stopped = true
     WHERE ended_at IS NULL
    RETURNING 1)
  SELECT count(*) INTO v_n FROM s;
  RETURN COALESCE(v_n, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.work_run_recurring() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_n int := 0; t public.work_templates%ROWTYPE;
        v_task uuid; v_due boolean;
BEGIN
  IF public.is_off_day(v_today) THEN RETURN 0; END IF;       -- Sundays and holidays: nothing fires
  FOR t IN SELECT * FROM public.work_templates
            WHERE is_active AND start_date <= v_today AND (end_date IS NULL OR end_date >= v_today)
              AND (last_run_date IS NULL OR last_run_date < v_today) LOOP
    v_due := CASE t.repeat_kind
               WHEN 'daily'   THEN true
               WHEN 'weekly'  THEN extract(isodow FROM v_today)::int = COALESCE(t.weekday, 1)
               ELSE extract(day FROM v_today)::int = COALESCE(t.month_day, 1) END;
    IF NOT v_due THEN CONTINUE; END IF;
    BEGIN
      INSERT INTO public.work_tasks (title, project_id, created_by, due_date, template_id)
      VALUES (t.title, t.project_id, t.created_by, v_today, t.id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_task;
      IF v_task IS NOT NULL THEN
        INSERT INTO public.work_task_parts (task_id, assignee_id, due_date) VALUES (v_task, t.assignee_id, v_today);
        INSERT INTO public.work_task_log (task_id, user_id, event, detail) VALUES (v_task, t.created_by, 'created', '{"recurring":true}');
        PERFORM public.work_push(t.assignee_id, 'Repeating task', left(t.title, 80), '/my-work', 'work-rec-' || t.id::text);
        v_n := v_n + 1;
      END IF;
      UPDATE public.work_templates SET last_run_date = v_today WHERE id = t.id;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- one bad template never stops the rest
    END;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ---------- 6. FUNCTION PRIVILEGES ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'work\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;
-- callable by a signed-in user (each checks its own permission inside)
GRANT EXECUTE ON FUNCTION
  public.work_is_active_user(), public.work_is_head(), public.work_is_member(), public.work_can_see_task(uuid),
  public.work_clock_start(uuid, text, uuid), public.work_clock_stop(),
  public.work_create_task(text, uuid, text, date, jsonb, text[]),
  public.work_finish_part(uuid, text), public.work_move_part(uuid, text),
  public.work_add_comment(uuid, text), public.work_add_step(uuid, text), public.work_toggle_step(uuid, boolean),
  public.work_set_due(uuid, uuid, date), public.work_reassign_part(uuid, uuid),
  public.work_add_manual_time(uuid, text, timestamptz, timestamptz, text), public.work_decide_time(uuid, boolean),
  public.work_add_project(text, text), public.work_update_project(uuid, text, boolean, uuid),
  public.work_set_member(uuid, boolean, boolean),
  public.work_save_template(text, uuid, uuid, text, int, int, date, date), public.work_stop_template(uuid),
  public.work_mark_report_shared(date, text),
  public.work_hours_report(date, date), public.work_cost_report(date, date)
  TO authenticated;
-- internal only: work_user_rate, work_log, work_push, work_refresh_task, work__stop_running,
-- work_autostop_all, work_run_recurring stay revoked (called by the functions above / pg_cron).

-- ---------- 7. CRON ----------
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('work-autostop', 'work-recurring');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('work-autostop',  '0 16 * * *',  $$SELECT public.work_autostop_all()$$);   -- 21:30 IST
SELECT cron.schedule('work-recurring', '30 1 * * *',  $$SELECT public.work_run_recurring()$$);  -- 07:00 IST

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect: tables 10, rls_on 10, fns >= 25, client_exec_internal false, cron 2)
-- SELECT
--  (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'work\_%' AND tablename <> 'work_sessions') AS tables,
--  (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'work\_%' AND tablename <> 'work_sessions' AND rowsecurity) AS rls_on,
--  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'work\_%') AS fns,
--  has_function_privilege('authenticated','public.work_run_recurring()','EXECUTE') AS client_exec_internal,
--  (SELECT count(*) FROM cron.job WHERE jobname IN ('work-autostop','work-recurring')) AS cron_jobs;
