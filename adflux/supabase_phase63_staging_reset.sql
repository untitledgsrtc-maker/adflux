-- supabase_phase63_staging_reset.sql
--
-- Phase 63 (20 May 2026) — STAGING WIPE. Destructive.
--
-- Owner directive: remove all user-generated data + drop every user
-- account EXCEPT kirti@untitledad.in AND any role IN ('admin','co_owner').
--
-- What this script PRESERVES:
--   * users where role IN ('admin','co_owner')
--   * users where email = 'kirti@untitledad.in'
--   * All MASTER tables (companies, signers, cities, auto_districts,
--     gsrtc_stations, holidays, media_types, incentive_profiles,
--     whatsapp_templates, call_scripts)
--   * All DB functions, triggers, policies
--   * Schema itself
--
-- What this script DELETES:
--   * Every operational table row (leads, quotes, activities,
--     follow_ups, call_logs, gps_pings, work_sessions, payments,
--     attendance_warnings, push_log, push_subscriptions, etc.)
--   * Every users row NOT in the preserve set above
--
-- NOTES:
--   1. Wrapped in a transaction. Roll back by replacing COMMIT with
--      ROLLBACK if the VERIFY block looks wrong.
--   2. auth.users rows are NOT touched by this SQL — those are
--      managed via Supabase Dashboard → Authentication → Users.
--      Delete them there manually after this script if you want the
--      deleted users to lose login access too.
--   3. Idempotent: if a table doesn't exist, the DELETE is skipped
--      via a DO block. Re-running this script after a wipe is safe.

BEGIN;

-- ─── §1. Preserve set (used in §3) ─────────────────────────────────
DROP TABLE IF EXISTS pg_temp.keep_users;
CREATE TEMP TABLE keep_users AS
SELECT id FROM public.users
 WHERE role IN ('admin','co_owner')
    OR email = 'kirti@untitledad.in';

-- Sanity: must have ≥1 user to keep. Abort otherwise.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_temp.keep_users;
  IF n < 1 THEN
    RAISE EXCEPTION 'No users matched the preserve filter. Aborting wipe.';
  END IF;
END $$;


-- ─── §1b. Disable ALL user triggers for the wipe ────────────────
-- Phase 11b ships a `quotes_no_delete_after_draft` trigger that
-- blocks DELETE on any quote whose status ≠ 'draft'. We're wiping
-- staging on purpose. Setting session_replication_role = 'replica'
-- is the standard Postgres bulk-load trick — it skips user triggers
-- in the current session only. Restored by COMMIT/ROLLBACK.
SET LOCAL session_replication_role = 'replica';


-- ─── §2. Delete operational data ───────────────────────────────────
-- Order matters for FK chains. Children first, parents last.
-- Wrapped in DO blocks so missing tables don't break the run.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- Attendance / push audit (Phase 60 + 33W/34Z)
    'attendance_warnings',
    'push_log',
    'push_subscriptions',
    -- GPS + work session
    'gps_pings',
    'work_sessions',
    -- Call audit
    'call_logs',
    'voice_logs',
    -- Lead chain (children → parent)
    'lead_tasks',
    'lead_activities',
    'follow_ups',
    'lead_imports',
    -- Quote chain
    'payments',
    'quote_cities',
    'quotes',
    -- Lead + client
    'leads',
    'clients',
    -- HR ops
    'leaves',
    'ta_da_requests',
    'daily_ta',
    'daily_score',
    'monthly_score',
    'incentive_payouts',
    'salary_payouts',
    -- Misc
    'notifications',
    'ai_runs',
    'smart_tasks'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DELETE FROM public.%I', t);
      RAISE NOTICE 'Cleared %', t;
    ELSE
      RAISE NOTICE 'Skipped (no such table): %', t;
    END IF;
  END LOOP;
END $$;


-- ─── §3. Delete non-preserved users ────────────────────────────────
-- users.manager_id self-FK: drop the link first so the row delete
-- doesn't RESTRICT. Same for users referenced from anywhere we
-- couldn't reach above.
UPDATE public.users
   SET manager_id = NULL
 WHERE manager_id IS NOT NULL
   AND manager_id NOT IN (SELECT id FROM pg_temp.keep_users);

DELETE FROM public.users
 WHERE id NOT IN (SELECT id FROM pg_temp.keep_users);


-- ─── §3b. session_replication_role auto-resets on COMMIT ────────
-- SET LOCAL scopes to the current transaction only. Once we COMMIT
-- (or ROLLBACK), session goes back to 'origin' and triggers fire
-- normally again. Nothing to manually undo.


-- ─── §4. VERIFY ────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.users)                              AS users_kept,
  (SELECT count(*) FROM public.leads)                              AS leads,
  (SELECT count(*) FROM public.quotes)                             AS quotes,
  (SELECT count(*) FROM public.clients)                            AS clients,
  (SELECT count(*) FROM public.lead_activities)                    AS activities,
  (SELECT count(*) FROM public.follow_ups)                         AS follow_ups,
  (SELECT count(*) FROM public.call_logs)                          AS call_logs,
  (SELECT count(*) FROM public.gps_pings)                          AS gps_pings,
  (SELECT count(*) FROM public.work_sessions)                      AS work_sessions,
  (SELECT count(*) FROM public.attendance_warnings)                AS attendance_warnings,
  (SELECT count(*) FROM public.push_subscriptions)                 AS push_subs,
  (SELECT count(*) FROM public.payments)                           AS payments;

-- Expected after wipe:
--   users_kept = number of admin/co_owner users + (1 if kirti exists)
--   everything else = 0


-- ─── §5. Commit ────────────────────────────────────────────────────
-- If the VERIFY row above looks wrong, change COMMIT → ROLLBACK
-- and re-run BEFORE clicking Run again (the transaction is already
-- closed by then). Easier: just ROLLBACK now and inspect.
COMMIT;
