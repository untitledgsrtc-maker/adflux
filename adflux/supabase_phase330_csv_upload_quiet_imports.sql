-- =====================================================================
-- supabase_phase330_csv_upload_quiet_imports.sql
-- Phase 330 — let sales + telecaller reps upload a lead CSV for THEMSELVES (quiet imports)
-- Owner decision 2026-10-05: "anyone can upload csv" -> sales + telecaller + admin/co_owner,
-- quiet mode, 500 leads per file, CSV only. CLAUDE.md §319.
--
-- RUN ORDER (3 files, paste each in Supabase Studio; each prints its own VERIFY):
--   1. db/functions/lead_is_self_import.sql          (the yes/no rule)
--   2. db/functions/recompute_daily_new_leads.sql    (counter delete-heal ignores self-imports)
--   3. THIS FILE                                      (policy + 3 quiet triggers + readiness check)
--
-- WHAT THIS FILE CHANGES (additive; admin/co_owner imports and one-by-one leads behave EXACTLY as today)
--   Part 1  lead_imports_own_update policy — a rep can finish (update) their own audit row.
--           Until now only admins could, so a rep's import would stay "processing" forever.
--   Part 2  3 triggers on public.leads get  WHEN (NOT lead_is_self_import(...)):
--             tg_push_lead_assign              -> no "New lead" push per uploaded lead
--             trg_lead_auto_followup           -> no auto "follow up tomorrow 10:00" per uploaded lead
--             trg_lead_after_insert_bump_counter -> uploaded leads don't count in "Leads today"
--           Trigger FUNCTIONS are untouched (their frozen §28/§72 bodies are byte-identical);
--           only the trigger definitions gain a WHEN clause. A self-import = import_id set AND
--           the uploader owns the lead. Revert = CREATE OR REPLACE TRIGGER without the WHEN
--           (the exact old definitions are quoted in Part 2).
--   Part 3  lead_import_quiet_ready() — the upload page asks this before letting a rep upload,
--           so the website can never go live before this SQL (no push flood if order is wrong).
--
-- WHAT STAYS THE SAME ON PURPOSE
--   * Once a rep starts working an uploaded lead (stage New -> Working) the normal cadence
--     engine (lead_stage_change_cadence) creates its follow-ups as usual.
--   * Pay/score are NOT affected: compute_daily_score counts only meeting/call activities.
--
-- Idempotent: safe to re-run. Fails CLOSED if the live triggers are not what this file expects.
-- RUN OFF-PEAK (before ~9 AM or after ~8 PM IST): Part 2 re-creates 3 triggers on the hot leads
-- table (brief lock). lock_timeout below makes it fail fast and safe to simply re-run.
-- =====================================================================


-- ===================== PART 0 — preflight (changes nothing) =====================
DO $pre$
DECLARE
  r record;
  d text;
BEGIN
  IF to_regprocedure('public.lead_is_self_import(uuid,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Phase 330: run db/functions/lead_is_self_import.sql first (step 1 of 3).';
  END IF;

  IF coalesce((SELECT pg_get_functiondef(p.oid)
                 FROM pg_proc p
                WHERE p.proname = 'recompute_daily_new_leads'
                  AND p.pronamespace = 'public'::regnamespace
                LIMIT 1), '') NOT LIKE '%lead_is_self_import%' THEN
    RAISE EXCEPTION 'Phase 330: run db/functions/recompute_daily_new_leads.sql first (step 2 of 3).';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('trg_lead_auto_followup',             'AFTER INSERT ON public.leads FOR EACH ROW',                           'lead_auto_create_followup()'),
      ('trg_lead_after_insert_bump_counter', 'AFTER INSERT ON public.leads FOR EACH ROW',                           'lead_after_insert_bump_counter()'),
      ('tg_push_lead_assign',                'AFTER INSERT OR UPDATE OF assigned_to ON public.leads FOR EACH ROW',  'tg_push_on_lead_assign()')
    ) AS v(tgname, shape, fn)
  LOOP
    SELECT pg_get_triggerdef(t.oid) INTO d
      FROM pg_trigger t
     WHERE t.tgrelid = 'public.leads'::regclass AND t.tgname = r.tgname AND NOT t.tgisinternal;

    IF d IS NULL THEN
      RAISE EXCEPTION 'Phase 330: trigger % not found on public.leads - nothing was changed.', r.tgname;
    END IF;

    -- already converted (re-run) -> fine. Otherwise it must be EXACTLY the old shape.
    IF position('lead_is_self_import' IN d) = 0 THEN
      IF position(r.shape IN d) = 0
         OR (position('EXECUTE FUNCTION ' || r.fn IN d) = 0 AND position('EXECUTE FUNCTION public.' || r.fn IN d) = 0)
         OR position(' WHEN ' IN d) > 0 THEN
        RAISE EXCEPTION 'Phase 330: trigger % has an unexpected definition (%) - nothing was changed. Tell Claude.', r.tgname, d;
      END IF;
    END IF;
  END LOOP;
END
$pre$;


-- ===================== PART 1 — reps can finish their own import audit row =====================
DROP POLICY IF EXISTS lead_imports_own_update ON public.lead_imports;
CREATE POLICY lead_imports_own_update ON public.lead_imports
  FOR UPDATE
  USING      (uploaded_by = auth.uid())
  WITH CHECK (uploaded_by = auth.uid());


-- ===================== PART 2 — quiet self-imports (WHEN clause on 3 triggers) =====================
SET LOCAL lock_timeout = '3s';
-- Old definitions (live on 2026-10-05), for revert:
--   CREATE TRIGGER trg_lead_auto_followup             AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION lead_auto_create_followup()
--   CREATE TRIGGER trg_lead_after_insert_bump_counter AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION lead_after_insert_bump_counter()
--   CREATE TRIGGER tg_push_lead_assign                AFTER INSERT OR UPDATE OF assigned_to ON public.leads FOR EACH ROW EXECUTE FUNCTION tg_push_on_lead_assign()

CREATE OR REPLACE TRIGGER trg_lead_auto_followup
  AFTER INSERT ON public.leads
  FOR EACH ROW
  WHEN (NOT public.lead_is_self_import(NEW.import_id, NEW.created_by, NEW.assigned_to, NEW.telecaller_id))
  EXECUTE FUNCTION public.lead_auto_create_followup();

CREATE OR REPLACE TRIGGER trg_lead_after_insert_bump_counter
  AFTER INSERT ON public.leads
  FOR EACH ROW
  WHEN (NOT public.lead_is_self_import(NEW.import_id, NEW.created_by, NEW.assigned_to, NEW.telecaller_id))
  EXECUTE FUNCTION public.lead_after_insert_bump_counter();

CREATE OR REPLACE TRIGGER tg_push_lead_assign
  AFTER INSERT OR UPDATE OF assigned_to ON public.leads
  FOR EACH ROW
  WHEN (NOT public.lead_is_self_import(NEW.import_id, NEW.created_by, NEW.assigned_to, NEW.telecaller_id))
  EXECUTE FUNCTION public.tg_push_on_lead_assign();


-- ===================== PART 3 — readiness probe for the upload page =====================
-- Returns TRUE only when the helper, the 3 quiet triggers and the audit policy are ALL in place.
-- The upload page (self-serve mode) calls this and refuses to run otherwise.
CREATE OR REPLACE FUNCTION public.lead_import_quiet_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT to_regprocedure('public.lead_is_self_import(uuid,uuid,uuid,uuid)') IS NOT NULL
     AND (SELECT count(*) FROM pg_trigger t
           WHERE t.tgrelid = 'public.leads'::regclass
             AND NOT t.tgisinternal
             AND t.tgenabled <> 'D'
             AND t.tgname IN ('trg_lead_auto_followup', 'trg_lead_after_insert_bump_counter', 'tg_push_lead_assign')
             AND pg_get_triggerdef(t.oid) LIKE '%lead_is_self_import%') = 3
     AND EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'lead_imports'
                    AND policyname = 'lead_imports_own_update')
$$;

REVOKE ALL ON FUNCTION public.lead_import_quiet_ready() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_import_quiet_ready() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';


-- ===================== VERIFY (expected values in the comments) =====================
SELECT
  public.lead_import_quiet_ready()                                                          AS quiet_ready,          -- true
  (SELECT count(*) FROM pg_trigger t
    WHERE t.tgrelid = 'public.leads'::regclass AND NOT t.tgisinternal
      AND t.tgname IN ('trg_lead_auto_followup','trg_lead_after_insert_bump_counter','tg_push_lead_assign')
      AND pg_get_triggerdef(t.oid) LIKE '%lead_is_self_import%')                            AS triggers_with_when,   -- 3
  (SELECT count(*) FROM pg_policies
    WHERE tablename = 'lead_imports' AND policyname = 'lead_imports_own_update')            AS own_update_policy,    -- 1
  (SELECT count(*) FROM pg_trigger t
    WHERE t.tgrelid = 'public.leads'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'D') AS disabled_triggers;   -- 0
