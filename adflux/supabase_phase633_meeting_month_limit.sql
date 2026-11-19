-- Phase 633 (19-11-2026): max 3 counted meetings per lead per month (all reps).
-- RUN ORDER: db/functions/lead_activity_meeting_month_limit.sql,
--   db/functions/lead_activity_bump_counter.sql, db/functions/recompute_daily_meetings.sql,
--   db/functions/compute_daily_score.sql, then this file. Forward-only: past meetings untouched.
DROP TRIGGER IF EXISTS trg_lead_activity_meeting_month_limit ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_meeting_month_limit BEFORE INSERT ON public.lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.lead_activity_meeting_month_limit();
NOTIFY pgrst, 'reload schema';
-- VERIFY:
SELECT (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_lead_activity_meeting_month_limit') AS limit_trigger,   -- 1
       (SELECT pg_get_functiondef('public.lead_activity_bump_counter()'::regprocedure) LIKE '%Over monthly limit%') AS counter_skips,  -- t
       (SELECT pg_get_functiondef(p.oid) LIKE '%Over monthly limit%' FROM pg_proc p WHERE p.proname = 'recompute_daily_meetings' LIMIT 1) AS recount_skips,  -- t
       (SELECT pg_get_functiondef(p.oid) LIKE '%Over monthly limit%' FROM pg_proc p WHERE p.proname = 'compute_daily_score' LIMIT 1) AS score_skips;  -- t
