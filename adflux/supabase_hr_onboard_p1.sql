-- =============================================================================
-- supabase_hr_onboard_p1.sql
-- Phase 282 — HR module, Onboard & Train. Spec: docs/HR_ONBOARDING_RECRUITMENT_SPEC.md §A.
--
-- The full loop: HR authors a per-role step TEMPLATE (steps + material + tests) ->
-- assigns it to a hire (a RUN + seeded PROGRESS) -> the hire opens material,
-- passes tests, ticks their own steps -> HR watches the timeline.
--
-- ADDITIVE + §45-safe: 5 NEW onboarding_* tables + 1 NEW private bucket + 3 RPCs.
-- ZERO touch to leads / quotes / payments / payroll / any live flow.
--
-- ACCESS:
--   * templates / steps / runs / progress : admin + co_owner + hr = FULL.
--   * the HIRE reads their OWN run + the steps of an active template, opens
--     material, and ticks their OWN owner='hire' steps. The hire NEVER sees the
--     test answers (correct_index) — questions are served via a gated RPC that
--     strips it, and scoring happens server-side.
--   * everyone else: nothing.
--
-- §41 note: RLS USING/WITH CHECK predicates fail CLOSED on a NULL role (NULL ->
-- excluded). The 3 PL/pgSQL RPCs below DO use the "IS NULL OR ..." guard because
-- a bare "NOT IN(...)" in an IF fails OPEN.
--
-- Idempotent (§8). Bundled one file per §154.
-- =============================================================================

-- ── part 1/8 · onboarding_templates (one per role, editable) ─────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role        text NOT NULL,          -- sales / telecaller / accounts / hr / designer / video_editor / admin / ...
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- one ACTIVE template per role (partial unique so history/inactive copies allowed).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_onboarding_template_active_role
  ON public.onboarding_templates (role) WHERE is_active;

DROP TRIGGER IF EXISTS trg_onboarding_templates_touch ON public.onboarding_templates;
CREATE TRIGGER trg_onboarding_templates_touch
  BEFORE UPDATE ON public.onboarding_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── part 2/8 · onboarding_steps ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_steps (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES public.onboarding_templates(id) ON DELETE CASCADE,
  step_order     int NOT NULL DEFAULT 0,
  title          text NOT NULL,
  description    text,
  owner          text NOT NULL DEFAULT 'hire' CHECK (owner IN ('hr','hire','manager')),
  material_url   text,                -- storage path (pdf/video) OR external URL (link)
  material_type  text CHECK (material_type IS NULL OR material_type IN ('pdf','video','link')),
  has_test       boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_steps_template ON public.onboarding_steps (template_id, step_order);

DROP TRIGGER IF EXISTS trg_onboarding_steps_touch ON public.onboarding_steps;
CREATE TRIGGER trg_onboarding_steps_touch
  BEFORE UPDATE ON public.onboarding_steps
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── part 3/8 · onboarding_step_questions (test items; answer NEVER served raw) ─
CREATE TABLE IF NOT EXISTS public.onboarding_step_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id        uuid NOT NULL REFERENCES public.onboarding_steps(id) ON DELETE CASCADE,
  q_order        int NOT NULL DEFAULT 0,
  question       text NOT NULL,
  options        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of option strings
  correct_index  int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_questions_step ON public.onboarding_step_questions (step_id, q_order);

-- ── part 4/8 · onboarding_runs (one active run per hire) ──────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  template_id  uuid NOT NULL REFERENCES public.onboarding_templates(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','complete')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_onboarding_run_user ON public.onboarding_runs (user_id);

-- ── part 5/8 · onboarding_progress ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES public.onboarding_runs(id) ON DELETE CASCADE,
  step_id      uuid NOT NULL REFERENCES public.onboarding_steps(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  done_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  done_at      timestamptz,
  test_score   int,
  test_passed  boolean
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_onboarding_progress ON public.onboarding_progress (run_id, step_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_run ON public.onboarding_progress (run_id);

-- ── part 6/8 · RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.onboarding_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_steps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_step_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_progress       ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_templates      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_steps          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_step_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_runs           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_progress       TO authenticated;

-- templates: HR/admin manage; anyone authenticated may READ an active template
-- (role + name only — no secrets).
DROP POLICY IF EXISTS onboarding_templates_hr_all ON public.onboarding_templates;
CREATE POLICY onboarding_templates_hr_all ON public.onboarding_templates
  FOR ALL USING (public.get_my_role() IN ('admin','co_owner','hr'))
          WITH CHECK (public.get_my_role() IN ('admin','co_owner','hr'));
DROP POLICY IF EXISTS onboarding_templates_read ON public.onboarding_templates;
CREATE POLICY onboarding_templates_read ON public.onboarding_templates
  FOR SELECT USING (is_active);

-- steps: HR/admin manage; authenticated READ steps of an active template
-- (steps carry no answers).
DROP POLICY IF EXISTS onboarding_steps_hr_all ON public.onboarding_steps;
CREATE POLICY onboarding_steps_hr_all ON public.onboarding_steps
  FOR ALL USING (public.get_my_role() IN ('admin','co_owner','hr'))
          WITH CHECK (public.get_my_role() IN ('admin','co_owner','hr'));
DROP POLICY IF EXISTS onboarding_steps_read ON public.onboarding_steps;
CREATE POLICY onboarding_steps_read ON public.onboarding_steps
  FOR SELECT USING (
    is_active AND EXISTS (SELECT 1 FROM public.onboarding_templates t
                           WHERE t.id = template_id AND t.is_active)
  );

-- questions: HR/admin ONLY (contains correct_index). The hire NEVER reads this
-- table directly — questions are served answer-stripped via get_onboarding_step_quiz().
DROP POLICY IF EXISTS onboarding_questions_hr_all ON public.onboarding_step_questions;
CREATE POLICY onboarding_questions_hr_all ON public.onboarding_step_questions
  FOR ALL USING (public.get_my_role() IN ('admin','co_owner','hr'))
          WITH CHECK (public.get_my_role() IN ('admin','co_owner','hr'));

-- runs: HR/admin manage; the hire reads their OWN run.
DROP POLICY IF EXISTS onboarding_runs_hr_all ON public.onboarding_runs;
CREATE POLICY onboarding_runs_hr_all ON public.onboarding_runs
  FOR ALL USING (public.get_my_role() IN ('admin','co_owner','hr'))
          WITH CHECK (public.get_my_role() IN ('admin','co_owner','hr'));
DROP POLICY IF EXISTS onboarding_runs_own_read ON public.onboarding_runs;
CREATE POLICY onboarding_runs_own_read ON public.onboarding_runs
  FOR SELECT USING (user_id = auth.uid());

-- progress: HR/admin manage; the hire reads their OWN progress AND may tick
-- their OWN owner='hire' steps (UPDATE). Test-gated + HR steps are marked by the
-- scoring RPC / HR (both bypass or satisfy their own gate).
DROP POLICY IF EXISTS onboarding_progress_hr_all ON public.onboarding_progress;
CREATE POLICY onboarding_progress_hr_all ON public.onboarding_progress
  FOR ALL USING (public.get_my_role() IN ('admin','co_owner','hr'))
          WITH CHECK (public.get_my_role() IN ('admin','co_owner','hr'));
DROP POLICY IF EXISTS onboarding_progress_own_read ON public.onboarding_progress;
CREATE POLICY onboarding_progress_own_read ON public.onboarding_progress
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.onboarding_runs r WHERE r.id = run_id AND r.user_id = auth.uid())
  );
DROP POLICY IF EXISTS onboarding_progress_own_tick ON public.onboarding_progress;
CREATE POLICY onboarding_progress_own_tick ON public.onboarding_progress
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.onboarding_runs r WHERE r.id = run_id AND r.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.onboarding_steps s
                 WHERE s.id = step_id AND s.owner = 'hire' AND s.has_test = false)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.onboarding_runs r WHERE r.id = run_id AND r.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.onboarding_steps s
                 WHERE s.id = step_id AND s.owner = 'hire' AND s.has_test = false)
  );

-- ── part 7/8 · onboarding-material bucket (PRIVATE; HR upload, staff read) ─────
-- Training material (PDF/video). Private + signed-URL. Read = any authenticated
-- employee (so a hire can open their steps' material); write = HR/admin only.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('onboarding-material', 'onboarding-material', false, 52428800)  -- 50 MB (videos)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS onboarding_material_read ON storage.objects;
CREATE POLICY onboarding_material_read ON storage.objects
  FOR SELECT USING (bucket_id = 'onboarding-material' AND auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS onboarding_material_hr_insert ON storage.objects;
CREATE POLICY onboarding_material_hr_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'onboarding-material' AND public.get_my_role() IN ('admin','co_owner','hr'));
DROP POLICY IF EXISTS onboarding_material_hr_update ON storage.objects;
CREATE POLICY onboarding_material_hr_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'onboarding-material' AND public.get_my_role() IN ('admin','co_owner','hr'))
             WITH CHECK (bucket_id = 'onboarding-material' AND public.get_my_role() IN ('admin','co_owner','hr'));
DROP POLICY IF EXISTS onboarding_material_hr_delete ON storage.objects;
CREATE POLICY onboarding_material_hr_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'onboarding-material' AND public.get_my_role() IN ('admin','co_owner','hr'));

-- ── part 8/8 · RPCs ──────────────────────────────────────────────────────────

-- (a) create_onboarding_run — HR/admin assigns a hire to their role's active
-- template: creates the run + seeds one pending progress row per active step.
-- Idempotent (one run per user). SECURITY DEFINER; NULL-role fail-closed (§41).
CREATE OR REPLACE FUNCTION public.create_onboarding_run(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role     text;
  v_template uuid;
  v_run      uuid;
BEGIN
  IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('admin','co_owner','hr') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT role INTO v_role FROM public.users WHERE id = p_user_id;
  IF v_role IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_template FROM public.onboarding_templates
    WHERE role = v_role AND is_active ORDER BY created_at DESC LIMIT 1;
  IF v_template IS NULL THEN RETURN NULL; END IF;   -- no template for the role yet

  INSERT INTO public.onboarding_runs (user_id, template_id, created_by)
    VALUES (p_user_id, v_template, auth.uid())
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id INTO v_run;

  IF v_run IS NULL THEN
    SELECT id INTO v_run FROM public.onboarding_runs WHERE user_id = p_user_id;  -- already onboarding
  END IF;

  -- (Re)seed one pending progress row per active step of the RUN's template.
  -- Re-runnable: a re-call backfills steps added to the template after the run
  -- started (the seed trigger below is the primary path; this is the manual one).
  INSERT INTO public.onboarding_progress (run_id, step_id)
    SELECT v_run, s.id
      FROM public.onboarding_steps s
      JOIN public.onboarding_runs r ON r.id = v_run
     WHERE s.template_id = r.template_id AND s.is_active
    ON CONFLICT (run_id, step_id) DO NOTHING;

  RETURN v_run;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_onboarding_run(uuid) TO authenticated;

-- (a2) auto-seed a NEW step into every active run of its template — so a hire's
-- checklist stays complete when HR edits a live template (closes the P1 crash:
-- a step with no progress row). AFTER INSERT, EXCEPTION-wrapped (a template edit
-- can never fail on progress housekeeping).
CREATE OR REPLACE FUNCTION public.onboarding_step_seed_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_active THEN
    INSERT INTO public.onboarding_progress (run_id, step_id)
      SELECT r.id, NEW.id
        FROM public.onboarding_runs r
       WHERE r.template_id = NEW.template_id AND r.status = 'active'
      ON CONFLICT (run_id, step_id) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_onboarding_step_seed_runs ON public.onboarding_steps;
CREATE TRIGGER trg_onboarding_step_seed_runs
  AFTER INSERT ON public.onboarding_steps
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_step_seed_runs();

-- (b) get_onboarding_step_quiz — serves a step's questions WITHOUT correct_index.
-- Allowed for HR/admin, or a hire whose run includes the step. SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.get_onboarding_step_quiz(p_step_id uuid)
RETURNS TABLE (id uuid, q_order int, question text, options jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    COALESCE(public.get_my_role() IN ('admin','co_owner','hr'), false)
    OR EXISTS (SELECT 1 FROM public.onboarding_progress p
                 JOIN public.onboarding_runs r ON r.id = p.run_id
                WHERE p.step_id = p_step_id AND r.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
    SELECT q.id, q.q_order, q.question, q.options
      FROM public.onboarding_step_questions q
     WHERE q.step_id = p_step_id
     ORDER BY q.q_order;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_onboarding_step_quiz(uuid) TO authenticated;

-- (c) submit_onboarding_test — the hire submits answers (ordered by q_order);
-- scored server-side vs correct_index; >=70% marks the step done. SECURITY
-- DEFINER; caller MUST own the run (auth.uid() = run.user_id).
CREATE OR REPLACE FUNCTION public.submit_onboarding_test(
  p_run_id uuid, p_step_id uuid, p_answers int[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total   int := 0;
  v_correct int := 0;
  v_pct     int := 0;
  v_passed  boolean := false;
  v_ans     int;
  rec       record;
  i         int := 1;
BEGIN
  -- caller owns the run
  IF NOT EXISTS (SELECT 1 FROM public.onboarding_runs r
                  WHERE r.id = p_run_id AND r.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not your onboarding';
  END IF;
  -- the step belongs to the run
  IF NOT EXISTS (SELECT 1 FROM public.onboarding_progress p
                  WHERE p.run_id = p_run_id AND p.step_id = p_step_id) THEN
    RAISE EXCEPTION 'step not in this run';
  END IF;
  -- the step is a SELF-test the hire is allowed to complete (mirrors the
  -- onboarding_progress_own_tick RLS: a hire can only self-complete owner='hire'
  -- steps). Blocks a hire from rpc()-ing a manager/HR-owned test step to
  -- self-sign-off, bypassing the intended review.
  IF NOT EXISTS (SELECT 1 FROM public.onboarding_steps s
                  WHERE s.id = p_step_id AND s.owner = 'hire' AND s.has_test = true) THEN
    RAISE EXCEPTION 'step is not a self-test step';
  END IF;

  FOR rec IN
    SELECT correct_index FROM public.onboarding_step_questions
     WHERE step_id = p_step_id ORDER BY q_order
  LOOP
    v_total := v_total + 1;
    v_ans := CASE WHEN p_answers IS NULL OR array_length(p_answers,1) IS NULL
                    OR i > array_length(p_answers,1) THEN NULL ELSE p_answers[i] END;
    IF v_ans IS NOT NULL AND v_ans = rec.correct_index THEN
      v_correct := v_correct + 1;
    END IF;
    i := i + 1;
  END LOOP;

  IF v_total = 0 THEN RAISE EXCEPTION 'step has no questions'; END IF;
  v_pct    := round(100.0 * v_correct / v_total);
  v_passed := v_pct >= 70;

  UPDATE public.onboarding_progress
     SET test_score  = v_pct,
         test_passed = v_passed,
         status  = CASE WHEN v_passed THEN 'done' ELSE status END,
         done_by = CASE WHEN v_passed THEN auth.uid() ELSE done_by END,
         done_at = CASE WHEN v_passed THEN now() ELSE done_at END
   WHERE run_id = p_run_id AND step_id = p_step_id;

  RETURN jsonb_build_object('score_pct', v_pct, 'passed', v_passed, 'correct', v_correct, 'total', v_total);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_onboarding_test(uuid, uuid, int[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY ───────────────────────────────────────────────────────────────────
-- Expect: tables=5, rls_on=5, table_policies=10, private_bucket=1,
--         storage_policies=4, rpcs=3.
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname='public'
     AND tablename IN ('onboarding_templates','onboarding_steps','onboarding_step_questions','onboarding_runs','onboarding_progress')) AS tables,
  (SELECT count(*) FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename
     WHERE t.schemaname='public' AND c.relrowsecurity
       AND t.tablename IN ('onboarding_templates','onboarding_steps','onboarding_step_questions','onboarding_runs','onboarding_progress')) AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename IN ('onboarding_templates','onboarding_steps','onboarding_step_questions','onboarding_runs','onboarding_progress')) AS table_policies,
  (SELECT count(*) FROM storage.buckets WHERE id='onboarding-material' AND public=false) AS private_bucket,
  (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
     AND policyname LIKE 'onboarding_material_%') AS storage_policies,
  (SELECT count(*) FROM pg_proc WHERE proname IN ('create_onboarding_run','get_onboarding_step_quiz','submit_onboarding_test')) AS rpcs;
