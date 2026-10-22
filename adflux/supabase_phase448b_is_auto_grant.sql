-- Phase 448b: work_tasks uses column-level SELECT grants; the new is_auto column had none -> "permission denied for table work_tasks" on every page that selects it.
GRANT SELECT (is_auto) ON public.work_tasks TO authenticated;
NOTIFY pgrst, 'reload schema';
