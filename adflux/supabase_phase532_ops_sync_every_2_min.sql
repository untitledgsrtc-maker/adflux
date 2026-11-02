-- Phase 532: pull LED screen status from the CMS every 2 minutes (was 10) so Ops sees an online/offline change sooner.
-- The endpoint already skips outside on-hours ({"skipped":"off_hours"}), so the extra runs cost nothing at night.
-- Idempotent: alter_job on the existing job. To revert, run it again with '*/10 * * * *'.
SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'ops-aiadflux-sync'), schedule := '*/2 * * * *');

-- VERIFY: schedule = '*/2 * * * *', active = true
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'ops-aiadflux-sync';
