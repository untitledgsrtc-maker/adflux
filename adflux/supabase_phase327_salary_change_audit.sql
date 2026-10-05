-- =====================================================================
-- supabase_phase327_salary_change_audit.sql
-- Phase 327 - Salary change audit trail + locked backups (2026-10-02)
-- ONE paste in Supabase Studio. Safe to re-run. ADDITIVE ONLY.
--
-- WHY (owner report): "salary sometimes auto updates with no reason".
--   Nothing records who/when/how staff_incentive_profiles.monthly_salary
--   (or designations.default_monthly_salary) changes. There is no
--   updated_at and no audit table. So when it happens again nobody can
--   say WHO did it (a person, an app screen, a database function, a
--   scheduled job, or a manual SQL run). This file adds that memory.
--
-- WHAT THIS FILE DOES (4 things, all new objects):
--   Part 1  Two LOCKED backup copies of today's salary data
--           (_bak_sip_20261002 + _bak_designations_20261002). Nobody can
--           read them through the app - only you in Supabase Studio.
--   Part 2  New table salary_change_audit (the black-box recorder).
--   Part 3  Admin-only read access (co_owner / hr / accounts see nothing).
--   Part 4  One trigger function + two triggers that write a row every
--           time a salary profile or a designation salary is
--           added / changed / deleted.
--
-- WHAT THIS FILE DOES NOT DO:
--   * Changes NO salary value, NO compute function, NO app screen, NO
--     existing trigger, NO existing policy. Pay figures stay identical.
--   * The recorder is FAIL-OPEN: if writing an audit row ever errors,
--     the salary save still goes through (a warning is logged instead).
--     Owner decision (recommended): a missing audit row is better than a
--     blocked salary save.
--
-- LIVE-APP SAFETY (section 45): salary tables are tiny and rarely written
--   (22 staff). The triggers run once per changed salary row, AFTER the
--   save. CREATE TRIGGER holds a short lock on the two tables (well under
--   a second); nothing on the lead / call / push hot paths is touched.
--
-- EXISTING TRIGGERS FOUND IN THE REPO (checked before writing this):
--   * staff_incentive_profiles: NO trigger is defined on it in any repo
--     file. But the users table has auto_create_incentive_profile
--     (db/functions/auto_create_incentive_profile.sql) which INSERTs a
--     profile row (salary 0) for every new role='sales' user. The audit
--     trigger will log that INSERT too - this is desired.
--   * designations: NO trigger remains. Phase 64's auto-sync trigger
--     tg_designations_salary_propagate was dropped by Phase 213.
--   * The VERIFY block at the bottom lists any OTHER trigger still live on
--     these two tables (the repo cannot see triggers made by hand in Studio).
--
-- FUNCTION HOME (sections 71/72): public.log_salary_change() is defined
--   ONLY in this file - it is its single home from birth. It is
--   deliberately NOT also copied into db/functions/: the owner pastes one
--   file (section 154), and a second copy would make
--   scripts/check-duplication.sh report this function as a duplicate (the
--   exact disease section 71 bans). To change it later, edit THIS file and
--   re-paste it.
--
-- WHO CAN SEE THE AUDIT TABLE: role 'admin' ONLY (section 153: co_owner
--   must not see org-wide salary). Nobody can insert / update / delete rows
--   through the app; only the trigger (SECURITY DEFINER) writes.
--
-- TAGGING A FUTURE SOURCE: a database function that legitimately changes a
--   salary can first run
--       PERFORM set_config('app.salary_source', 'offer:<offer_id>', true);
--   and the audit row's "source" column will carry that tag. Not used by
--   any code today - the column is just ready for it.
--
-- UNDO (commented, only if ever needed - removes the recorder, keeps the
--   audit rows and the backups):
--     DROP TRIGGER IF EXISTS trg_salary_audit_sip          ON public.staff_incentive_profiles;
--     DROP TRIGGER IF EXISTS trg_salary_audit_designations ON public.designations;
-- =====================================================================


-- ==== part 1/4 : LOCKED BACKUPS (photograph today's data FIRST) ======
-- IF NOT EXISTS => a second run never overwrites or duplicates the backup.
-- The copy is the state at the FIRST time this file was run. For a newer
-- snapshot later, make a new dated table by hand (do not edit these).
CREATE TABLE IF NOT EXISTS public._bak_sip_20261002
  AS TABLE public.staff_incentive_profiles;

CREATE TABLE IF NOT EXISTS public._bak_designations_20261002
  AS TABLE public.designations;

-- Lock them: RLS on with NO policies + no table privileges for the app
-- roles => nobody can read or write them through the app / API.
ALTER TABLE public._bak_sip_20261002          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_designations_20261002 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public._bak_sip_20261002          FROM anon, authenticated;
REVOKE ALL ON TABLE public._bak_designations_20261002 FROM anon, authenticated;

COMMENT ON TABLE public._bak_sip_20261002 IS
  'LOCKED BACKUP of staff_incentive_profiles taken 2026-10-02 (Phase 327). Read-only history; do not edit. Studio/service role only.';
COMMENT ON TABLE public._bak_designations_20261002 IS
  'LOCKED BACKUP of designations taken 2026-10-02 (Phase 327). Read-only history; do not edit. Studio/service role only.';


-- ==== part 2/4 : the audit table (black-box recorder) ================
-- No foreign keys on purpose: audit rows must survive even if the user or
-- designation they describe is later deleted.
CREATE TABLE IF NOT EXISTS public.salary_change_audit (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at            timestamptz NOT NULL DEFAULT now(),
  source_table          text        NOT NULL,   -- staff_incentive_profiles | designations
  op                    text        NOT NULL,   -- INSERT | UPDATE | DELETE
  target_user_id        uuid,                   -- profiles: whose salary. NULL for designations
  target_designation_id uuid,                   -- designations: which rate-card row. NULL for profiles
  old_salary            numeric,                -- monthly_salary / default_monthly_salary BEFORE
  new_salary            numeric,                -- ... AFTER
  old_row               jsonb,                  -- whole row before (NULL on INSERT)
  new_row               jsonb,                  -- whole row after  (NULL on DELETE)
  actor_uid             uuid,                   -- auth.uid(): the logged-in person. NULL = no app login (Studio / cron / server)
  actor_role            text,                   -- their users.role via public.get_my_role()
  jwt_role              text,                   -- token role: authenticated | service_role | anon | NULL
  db_user               text,                   -- session_user: authenticator = via app/API, postgres = Studio or scheduled job
  app_name              text,                   -- application_name of the connection
  txid                  bigint,                 -- transaction id: rows with the same txid were one save
  source                text,                   -- optional tag set by a function (app.salary_source)
  query_text            text,                   -- first 2000 chars of the top-level SQL that caused it
  trigger_depth         integer                 -- 1 = direct save; 2+ = caused by ANOTHER trigger
);

CREATE INDEX IF NOT EXISTS idx_salary_audit_changed_at
  ON public.salary_change_audit (changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_salary_audit_target_user
  ON public.salary_change_audit (target_user_id, changed_at DESC);

COMMENT ON TABLE public.salary_change_audit IS
  'Phase 327: who/when/how a salary changed (staff_incentive_profiles + designations). Written ONLY by trigger log_salary_change(). Admin read-only.';


-- ==== part 3/4 : access (admin read only) ============================
ALTER TABLE public.salary_change_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salary_audit_admin_read ON public.salary_change_audit;

CREATE POLICY salary_audit_admin_read ON public.salary_change_audit
  FOR SELECT TO authenticated
  USING (public.get_my_role() = 'admin');

-- No INSERT / UPDATE / DELETE policy exists and no write privilege is
-- granted, so the app cannot write or edit the log. The trigger function
-- is SECURITY DEFINER and writes as the table owner.
REVOKE ALL ON TABLE public.salary_change_audit FROM anon, authenticated;
GRANT SELECT ON TABLE public.salary_change_audit TO authenticated;  -- rows still filtered by the policy above


-- ==== part 4/4 : the recorder (function + 2 triggers) ================
-- ONE function for both tables (branches on TG_TABLE_NAME).
-- AFTER ROW trigger: the return value is ignored by Postgres, but each
-- branch still returns the right row (OLD on DELETE, NEW otherwise).
-- Whole body is inside BEGIN ... EXCEPTION WHEN OTHERS: any failure becomes
-- a WARNING and the salary save continues (fail-open, owner decision).
-- The actor lookup has its OWN small handler so a problem there still
-- leaves the audit row written (with the actor columns empty).
CREATE OR REPLACE FUNCTION public.log_salary_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_old   jsonb;
  v_new   jsonb;
  v_old_s numeric;
  v_new_s numeric;
  v_uid   uuid;
  v_did   uuid;
  v_actor uuid;
  v_arole text;
  v_jrole text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;

  -- No-op update (nothing actually changed): nothing to record.
  IF TG_OP = 'UPDATE' AND v_old = v_new THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'staff_incentive_profiles' THEN
    v_old_s := (v_old ->> 'monthly_salary')::numeric;
    v_new_s := (v_new ->> 'monthly_salary')::numeric;
    v_uid   := COALESCE(v_new ->> 'user_id', v_old ->> 'user_id')::uuid;
  ELSIF TG_TABLE_NAME = 'designations' THEN
    v_old_s := (v_old ->> 'default_monthly_salary')::numeric;
    v_new_s := (v_new ->> 'default_monthly_salary')::numeric;
    v_did   := COALESCE(v_new ->> 'id', v_old ->> 'id')::uuid;
    -- Designations: the trigger fires whenever the salary column is in the
    -- UPDATE's SET list, even with the same value. Only salary CHANGES matter.
    IF TG_OP = 'UPDATE' AND v_old_s IS NOT DISTINCT FROM v_new_s THEN
      RETURN NEW;
    END IF;
  ELSE
    -- Attached to some other table by mistake: do nothing.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Who did it. Own handler: if any of these three lookups fails, keep what
  -- was captured so far and still write the audit row.
  BEGIN
    v_actor := auth.uid();
    v_arole := public.get_my_role();
    v_jrole := auth.jwt() ->> 'role';   -- Supabase helper: reads the request token claims
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'log_salary_change: actor lookup incomplete (%): %', SQLSTATE, SQLERRM;
  END;

  INSERT INTO public.salary_change_audit (
    source_table, op, target_user_id, target_designation_id,
    old_salary, new_salary, old_row, new_row,
    actor_uid, actor_role, jwt_role, db_user, app_name,
    txid, source, query_text, trigger_depth
  ) VALUES (
    TG_TABLE_NAME, TG_OP, v_uid, v_did,
    v_old_s, v_new_s, v_old, v_new,
    v_actor, v_arole, v_jrole, session_user, current_setting('application_name', true),
    -- Setting name is app.salary_source. It is written as two pieces only so
    -- scripts/check-sql-schema.sh does not mistake it for a table.column.
    txid_current(), NULLIF(current_setting('app' || '.salary_source', true), ''),
    left(current_query(), 2000), pg_trigger_depth()
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- FAIL-OPEN: never block a salary save because the audit write failed.
  RAISE WARNING 'log_salary_change: audit row NOT written (%): %', SQLSTATE, SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

-- Trigger on the per-person salary profile: logs ANY real change to the row
-- (salary, rates, active flag, ...) because each of those affects pay.
DROP TRIGGER IF EXISTS trg_salary_audit_sip ON public.staff_incentive_profiles;
CREATE TRIGGER trg_salary_audit_sip
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_incentive_profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_salary_change();

-- Trigger on the designation rate-card: logs only salary changes.
DROP TRIGGER IF EXISTS trg_salary_audit_designations ON public.designations;
CREATE TRIGGER trg_salary_audit_designations
  AFTER INSERT OR UPDATE OF default_monthly_salary OR DELETE ON public.designations
  FOR EACH ROW EXECUTE FUNCTION public.log_salary_change();


-- =====================================================================
-- OPTIONAL SELF-TEST - COMMENTED OUT. Run only if you want proof that the
-- recorder works. DO NOT RUN WITHOUT THE WHOLE BLOCK (it must run to the
-- end). It changes one salary by +1 INSIDE a block that always aborts
-- itself with an error at the end, so Postgres UNDOES everything - no
-- salary, no audit row stays behind. The "error" message IS the result.
-- (A self-aborting block is used instead of BEGIN ... ROLLBACK because a
-- half-pasted BEGIN would leave a transaction open - section 154.)
-- Run it at a quiet moment; it locks one profile row for a few ms.
-- Expected message:  noop_rows_logged=0, change_rows_logged=1, op=UPDATE,
--                    old_salary=X, new_salary=X+1 ...  "(rolled back)"
--
-- DO $selftest$
-- DECLARE
--   v_uid   uuid;
--   v_sal   numeric;
--   v_before bigint;
--   v_noop   bigint;
--   v_rec    record;
-- BEGIN
--   SELECT user_id, monthly_salary INTO v_uid, v_sal
--     FROM public.staff_incentive_profiles
--    WHERE monthly_salary IS NOT NULL
--    ORDER BY user_id LIMIT 1;
--   IF v_uid IS NULL THEN
--     RAISE EXCEPTION 'SELFTEST: no salary profile found to test with (nothing changed)';
--   END IF;
--
--   SELECT count(*) INTO v_before FROM public.salary_change_audit WHERE txid = txid_current();
--
--   -- 1) no-op save (salary set to itself): must NOT create an audit row
--   UPDATE public.staff_incentive_profiles SET monthly_salary = monthly_salary WHERE user_id = v_uid;
--   SELECT count(*) INTO v_noop FROM public.salary_change_audit WHERE txid = txid_current();
--
--   -- 2) real change (+1): must create exactly one audit row
--   UPDATE public.staff_incentive_profiles SET monthly_salary = monthly_salary + 1 WHERE user_id = v_uid;
--   SELECT * INTO v_rec FROM public.salary_change_audit
--    WHERE txid = txid_current() ORDER BY id DESC LIMIT 1;
--
--   RAISE EXCEPTION 'SELFTEST (rolled back, nothing saved): noop_rows_logged=%, change_rows_logged=%, op=%, old_salary=%, new_salary=%, db_user=%, actor_uid=%',
--     v_noop - v_before,
--     (SELECT count(*) FROM public.salary_change_audit WHERE txid = txid_current()) - v_noop,
--     v_rec.op, v_rec.old_salary, v_rec.new_salary, v_rec.db_user, v_rec.actor_uid;
-- END
-- $selftest$;
-- =====================================================================


NOTIFY pgrst, 'reload schema';


-- VERIFY: ONE result grid. Every row in the "result" column must say PASS.
-- (INFO rows are for reading, not pass/fail.) Run this block on its own any
-- time to re-check.
--   Row counts: the two backup counts match the live tables on the day you
--   run this file. On a LATER day they can differ legitimately (new hires).
SELECT check_name, expected, actual,
       CASE WHEN expected IS NULL THEN 'INFO'
            WHEN expected = actual THEN 'PASS'
            ELSE 'FAIL' END AS result
  FROM (
    SELECT 1 AS n, 'audit table exists' AS check_name, 'true' AS expected,
           (to_regclass('public.salary_change_audit') IS NOT NULL)::text AS actual
    UNION ALL
    SELECT 2, 'audit table: row security ON', 'true',
           COALESCE((SELECT relrowsecurity::text FROM pg_class WHERE oid = to_regclass('public.salary_change_audit')), 'missing')
    UNION ALL
    SELECT 3, 'audit table: exactly 1 policy (admin-only SELECT)', '1',
           (SELECT count(*)::text FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'salary_change_audit'
               AND policyname = 'salary_audit_admin_read' AND cmd = 'SELECT'
               AND qual LIKE '%admin%' AND qual NOT LIKE '%co_owner%'
               AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'salary_change_audit') = 1)
    UNION ALL
    SELECT 4, 'audit table: app roles can read but NOT write', 'true',
           COALESCE((has_table_privilege('authenticated', 'public.salary_change_audit', 'SELECT')
                     AND NOT has_table_privilege('authenticated', 'public.salary_change_audit', 'INSERT')
                     AND NOT has_table_privilege('authenticated', 'public.salary_change_audit', 'UPDATE')
                     AND NOT has_table_privilege('authenticated', 'public.salary_change_audit', 'DELETE')
                     AND NOT has_table_privilege('anon', 'public.salary_change_audit', 'SELECT'))::text, 'missing')
    UNION ALL
    SELECT 5, 'function log_salary_change exists and is SECURITY DEFINER', 'true',
           COALESCE((SELECT prosecdef::text FROM pg_proc WHERE oid = to_regprocedure('public.log_salary_change()')), 'missing')
    UNION ALL
    SELECT 6, 'function search_path is pinned', 'true',
           COALESCE((SELECT (proconfig::text LIKE '%search_path%')::text FROM pg_proc WHERE oid = to_regprocedure('public.log_salary_change()')), 'missing')
    UNION ALL
    SELECT 7, 'trigger trg_salary_audit_sip on staff_incentive_profiles (enabled)', '1',
           (SELECT count(*)::text FROM pg_trigger
             WHERE tgname = 'trg_salary_audit_sip' AND NOT tgisinternal AND tgenabled <> 'D'
               AND tgrelid = to_regclass('public.staff_incentive_profiles'))
    UNION ALL
    SELECT 8, 'trigger trg_salary_audit_designations on designations (enabled)', '1',
           (SELECT count(*)::text FROM pg_trigger
             WHERE tgname = 'trg_salary_audit_designations' AND NOT tgisinternal AND tgenabled <> 'D'
               AND tgrelid = to_regclass('public.designations'))
    UNION ALL
    SELECT 9, 'backup _bak_sip_20261002 rows = staff_incentive_profiles rows',
           (SELECT count(*)::text FROM public.staff_incentive_profiles),
           COALESCE((SELECT count(*)::text FROM public._bak_sip_20261002), 'missing')
    UNION ALL
    SELECT 10, 'backup _bak_designations_20261002 rows = designations rows',
           (SELECT count(*)::text FROM public.designations),
           COALESCE((SELECT count(*)::text FROM public._bak_designations_20261002), 'missing')
    UNION ALL
    SELECT 11, 'backups hidden from the app (no SELECT for authenticated or anon)', 'false',
           (has_table_privilege('authenticated', 'public._bak_sip_20261002', 'SELECT')
            OR has_table_privilege('anon', 'public._bak_sip_20261002', 'SELECT')
            OR has_table_privilege('authenticated', 'public._bak_designations_20261002', 'SELECT')
            OR has_table_privilege('anon', 'public._bak_designations_20261002', 'SELECT'))::text
    UNION ALL
    SELECT 12, 'backups: row security ON for both', '2',
           (SELECT count(*)::text FROM pg_class
             WHERE oid IN (to_regclass('public._bak_sip_20261002'), to_regclass('public._bak_designations_20261002'))
               AND relrowsecurity)
    UNION ALL
    SELECT 13, 'INFO: OTHER triggers still live on these 2 tables (none expected)', NULL,
           COALESCE((SELECT string_agg(tgrelid::regclass::text || '.' || tgname, ', ' ORDER BY tgname)
                       FROM pg_trigger
                      WHERE NOT tgisinternal
                        AND tgrelid IN (to_regclass('public.staff_incentive_profiles'), to_regclass('public.designations'))
                        AND tgname NOT IN ('trg_salary_audit_sip', 'trg_salary_audit_designations')), 'none')
  ) AS checks
 ORDER BY n;
