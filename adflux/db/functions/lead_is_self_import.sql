-- db/functions/lead_is_self_import.sql  —  CANONICAL home (CLAUDE.md §72). Phase 330.
--
-- WHAT: TRUE when a lead row is "a user bulk-importing leads into their OWN list":
--   it came from a CSV import (import_id set) AND the uploader is also the owner
--   (created_by = COALESCE(telecaller_id, assigned_to) — the §113 TC-first owner).
--
-- WHY: when a rep uploads 200-500 of their own contacts, the per-lead side effects
--   built for single leads become a flood: one "New lead" push per lead (tg_push_lead_assign),
--   one "follow up tomorrow 10:00" row per lead (trg_lead_auto_followup) and +1 on the
--   "Leads today" counter per lead (trg_lead_after_insert_bump_counter). Those three
--   triggers now carry  WHEN (NOT lead_is_self_import(...))  so a self-import is quiet.
--
-- WHAT IT DELIBERATELY DOES NOT MATCH (so today's behaviour is byte-identical):
--   * admin / co_owner imports for someone else (created_by <> owner)  -> still loud, as today
--   * a lead a rep adds one at a time (import_id IS NULL)              -> still loud, as today
--
-- !! DO NOT REVOKE EXECUTE FROM PUBLIC on this function. It is evaluated by Postgres in the
--    WHEN clause of triggers on public.leads, as whichever role performs the INSERT
--    (authenticated reps, service_role Edge functions, SECURITY DEFINER triggers...). A role
--    without EXECUTE would make EVERY lead insert fail with "permission denied for function".
--    It is a pure boolean over its four arguments - no table access, nothing to protect.
--
-- LOCKSTEP (§71): the same definition is used by recompute_daily_new_leads (the delete-heal
--   of the stored counter) and, as `import_id IS NULL`, by the LIVE "new leads" counts:
--   useDaySummary.js (rep report) and TeamDashboardV2 hero + team_dashboard_bundle.new_leads_count
--   (admin / team-viewer "New leads added today"). Change this rule -> change those too.
--   KNOWN LIMIT: import_id / created_by are client-supplied (leads.import_id has no FK), so a rep
--   can make any lead of theirs "quiet" through the API. Pay/score never read the counter or
--   follow_ups, so there is no money effect; accepted (Phase 330 review).

CREATE OR REPLACE FUNCTION public.lead_is_self_import(
  p_import_id    uuid,
  p_created_by   uuid,
  p_assigned_to  uuid,
  p_telecaller_id uuid
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- COALESCE(..., false): NULL-safe on purpose. With import_id + created_by set but BOTH
  -- owner columns NULL, `created_by = COALESCE(NULL,NULL)` is NULL; WHEN (NOT NULL) = NULL =
  -- "do not fire" would silently mute the triggers for an ownerless admin import.
  SELECT COALESCE(
           p_import_id IS NOT NULL
       AND p_created_by IS NOT NULL
       AND p_created_by = COALESCE(p_telecaller_id, p_assigned_to),
           false)
$$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY: the truth table (all 5 columns must be exactly as shown) ───
SELECT
  public.lead_is_self_import(gen_random_uuid(), u, u,    NULL) AS sales_self_import,      -- true
  public.lead_is_self_import(gen_random_uuid(), u, u,    u)    AS telecaller_self_import, -- true
  public.lead_is_self_import(gen_random_uuid(), u, other, NULL) AS admin_import_for_other, -- false
  public.lead_is_self_import(NULL,              u, u,    NULL) AS single_lead_not_import,  -- false
  public.lead_is_self_import(gen_random_uuid(), NULL, u, NULL) AS no_creator,             -- false
  public.lead_is_self_import(gen_random_uuid(), u, NULL, NULL) AS no_owner               -- false (NOT null)
FROM (SELECT gen_random_uuid() AS u, gen_random_uuid() AS other) t;
