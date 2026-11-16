-- =====================================================================
-- Phase 573 — drop 18 backup tables older than 30 days (17 Nov 2026)
-- =====================================================================
-- Owner asked for the clean-up. Every table below was a one-time safety copy
-- made before a data fix between 2 Oct and 18 Oct 2026 (30-day keep window
-- passed). Nothing reads them (no view, function or app code).
-- A full copy of their rows was saved BEFORE dropping, on the owner's Mac:
--   adflux/_db_backups/2026-11-17_old_backup_tables.jsonl (not in git)
-- Kept on purpose: _bak_dropped_indexes_p393 (record of dropped indexes) and
-- the 13 backups from 19-25 Oct (drop after their 30 days: 19-25 Nov 2026).
-- =====================================================================

DROP TABLE IF EXISTS
  public._bak_followups_p333, public._bak_followups_p334, public._bak_followups_p336,
  public._bak_followups_p336_new, public._bak_ops_tickets_p338, public._bak_ops_tickets_p339,
  public._bak_holidays_p341, public._bak_clients_p345, public._bak_push_subs_p350,
  public._bak_ops_tickets_p353, public._bak_rename_p354, public._bak_followups_p356,
  public._bak_daily_performance_p358, public._bak_holidays_p358, public._bak_designations_20261002,
  public._bak_sip_20261002, public._bak_designations_salary_20261005, public._bak_work_time_entries_p392;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect 0 of the 18 left, 14 backup tables remaining
SELECT
  (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN (
    '_bak_followups_p333','_bak_followups_p334','_bak_followups_p336','_bak_followups_p336_new',
    '_bak_ops_tickets_p338','_bak_ops_tickets_p339','_bak_holidays_p341','_bak_clients_p345',
    '_bak_push_subs_p350','_bak_ops_tickets_p353','_bak_rename_p354','_bak_followups_p356',
    '_bak_daily_performance_p358','_bak_holidays_p358','_bak_designations_20261002',
    '_bak_sip_20261002','_bak_designations_salary_20261005','_bak_work_time_entries_p392')) AS dropped_left,
  (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname LIKE '\_bak\_%') AS backups_remaining;
