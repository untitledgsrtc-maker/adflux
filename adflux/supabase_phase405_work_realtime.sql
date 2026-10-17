-- supabase_phase405_work_realtime.sql
-- Phase 405: let the Work page hear about new / changed task parts the moment they happen (Realtime), so an assigned
-- task shows up without a refresh. Row-level security still applies: a person only receives their own rows.
-- Idempotent.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='work_task_parts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.work_task_parts;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='work_task_parts';   -- 1
