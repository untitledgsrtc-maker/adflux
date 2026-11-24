-- supabase_phase683_hr_give_tasks.sql (24-11-2026)
-- Owner 24-11-2026: "let her give tasks to anyone". Reverses part 1 of Phase 673:
-- HR can add tasks / repeating tasks for any person again (same as every other staff member).
-- Part 2 of Phase 673 (HR approves forgotten time, never her own) stays.
-- Team Work stays view-only for HR (Phase 672); she gives tasks from My Work.

DROP TRIGGER IF EXISTS trg_work_parts_hr_only_self ON public.work_task_parts;
DROP TRIGGER IF EXISTS trg_work_templates_hr_only_self ON public.work_templates;
DROP FUNCTION IF EXISTS public.work_hr_only_self();

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect self_triggers = 0, self_fn = 0
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_work_parts_hr_only_self', 'trg_work_templates_hr_only_self')) AS self_triggers,
  (SELECT count(*) FROM pg_proc WHERE proname = 'work_hr_only_self') AS self_fn;
