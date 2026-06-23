-- ============================================================================
-- db/functions/generate_lead_tasks.sql  —  THE CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ This is the ONE place generate_lead_tasks is allowed to live.
--    To change the smart-task engine, EDIT THIS FILE and run it once in Studio.
--    NEVER write a new phaseN file that re-pastes it (§71). It previously lived
--    in 8 files across two different signatures — that sprawl is what let an
--    older copy silently revert a fix.
--
-- WHAT IT DOES: builds today's `lead_tasks` queue (the rep's "Next up" smart
--    tasks) → each new task fires a per-task push (Phase 34Z.55). NOT a money
--    function, but it IS frozen-adjacent (push + smart-task surface, §28) →
--    guardian before any change.
--
-- PROVENANCE: captured byte-for-byte from the LIVE database on 2026-06-23 via
--    pg_get_functiondef. The dump returned EXACTLY ONE signature —
--    generate_lead_tasks(uuid). Running this file now is a NO-OP.
--
-- ⚠ OVERLOAD HISTORY: the function was originally generate_lead_tasks(date).
--    Phase 34Z.19 migrated the signature to (uuid) and DROPPED the (date)
--    version. The live DB has ONLY the (uuid) signature (verified 2026-06-23).
--    Do NOT recreate the (date) overload — two same-named functions with
--    different arg types would both go live and the callers (V2AppShell /
--    TodayTasksPanel call the uuid form) could bind the wrong one.
--
-- SUPERSEDES (Phase 178 removed every generate_lead_tasks block — both the old
--    (date) and (uuid) copies — plus phase34z19's DROP…CASCADE migration lines
--    and phase33t's GRANT, from each; their OTHER functions stay live):
--      supabase_phase19_smart_tasks.sql                       (date)
--      supabase_phase31s_smart_task_nurture.sql               (date)
--      supabase_phase33t_smart_task_fix.sql                   (uuid) + GRANT
--      supabase_phase34z19_generate_lead_tasks_signature.sql  (uuid) + DROP×2
--      supabase_phase34z28_generate_lead_tasks_status_column.sql
--      supabase_phase34z42_generate_lead_tasks_drop_last_outcome.sql
--      supabase_phase34z48_generate_lead_tasks_valid_kinds.sql
--      supabase_phase130_push_hygiene.sql                     (uuid, the live one)
--
-- LOCKED CONTRACTS baked into the body (a diff that removes any is a BLOCK, §71):
--      • Phase 130 (1c) — _assert_self_or_admin(p_user_id) gate. The RPC is
--                         EXECUTE-able by authenticated with a user_id param;
--                         without the gate any rep could regen + push another
--                         rep's queue. NOT wrapped — must raise to the caller.
--      • Phase 130 (1a+1b) — DELETE only OPEN rows that no longer qualify;
--                         snoozed/done/skipped survive; qualifying open rows keep
--                         their SAME uuid (ON CONFLICT DO NOTHING → no re-INSERT
--                         → no 34Z.55 push spam on every /work mount + focus).
--      • Phase 34Z.48 — the 3 task kinds: hot_idle, new_untouched, follow_up_due
--                         (Rules 1–3). Don't add/rename without owner sign-off.
--
-- REVERT: re-run this file. Single source of truth.
-- TRIPWIRE: VERIFY block at the bottom proves the live function still has every
--    locked fix. Run it any time. Any FALSE = an old copy was re-run → re-run this.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_lead_tasks(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d         date := CURRENT_DATE;
  inserted  int  := 0;
  rowcount  int;
BEGIN
  -- PHASE-130 (1c) — Phase 97.2 gate. RPC is EXECUTE-able by authenticated
  -- with a user_id param; without this any rep could regen (and push)
  -- another rep's queue. NOT wrapped — must raise to the caller.
  PERFORM public._assert_self_or_admin(p_user_id);

  -- PHASE-130 (1a+1b) — was: DELETE every non-done/skipped row for today
  -- (wiped snoozed rows; reinserted open rows with NEW uuids, so the
  -- 34Z.55 'task-<uuid>' push fired on every /work mount + focus).
  -- Now: delete ONLY open rows whose task no longer qualifies. Open rows
  -- that still qualify survive with the SAME uuid (ON CONFLICT below
  -- skips them -> no INSERT -> no push). snoozed / done / skipped always
  -- survive. Candidate predicates mirror Rules 1-3 below exactly.
  WITH cand AS (
    SELECT l.id AS lead_id, 'hot_idle'::text AS kind
      FROM public.leads l
     WHERE l.assigned_to = p_user_id
       AND l.heat = 'hot'
       AND l.stage NOT IN ('Won', 'Lost')
       AND COALESCE(l.last_contact_at, l.created_at) < (now() - INTERVAL '24 hours')
    UNION ALL
    SELECT l.id, 'new_untouched'
      FROM public.leads l
     WHERE l.assigned_to = p_user_id
       AND l.stage = 'New'
       AND l.last_contact_at IS NULL
       AND l.stage NOT IN ('Won', 'Lost')
       AND COALESCE(l.last_contact_at, l.created_at) < (now() - INTERVAL '48 hours')
    UNION ALL
    SELECT l.id, 'follow_up_due'
      FROM public.leads l
     WHERE l.assigned_to = p_user_id
       AND l.stage NOT IN ('Won', 'Lost')
       AND EXISTS (
             SELECT 1
               FROM public.follow_ups f
              WHERE f.lead_id = l.id
                AND f.is_done = false
                AND f.follow_up_date IS NOT NULL
                AND f.follow_up_date <= d
           )
  )
  DELETE FROM public.lead_tasks t
   WHERE t.assigned_to = p_user_id
     AND t.generated_for = d
     AND t.status = 'open'
     AND NOT EXISTS (
           SELECT 1 FROM cand c
            WHERE c.lead_id = t.lead_id
              AND c.kind    = t.kind
         );

  -- Rule 1: hot_idle — heat='hot' leads not contacted in 24h. (34Z.48)
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'hot_idle', 10,
    'Hot lead — follow up',
    d
  FROM public.leads l
  WHERE l.assigned_to = p_user_id
    AND l.heat = 'hot'
    AND l.stage NOT IN ('Won', 'Lost')
    AND COALESCE(l.last_contact_at, l.created_at) < (now() - INTERVAL '24 hours')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 2: new_untouched — new leads with no contact, > 48h old. (34Z.48)
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'new_untouched', 20,
    'New lead — never contacted',
    d
  FROM public.leads l
  WHERE l.assigned_to = p_user_id
    AND l.stage = 'New'
    AND l.last_contact_at IS NULL
    AND l.stage NOT IN ('Won', 'Lost')
    AND COALESCE(l.last_contact_at, l.created_at) < (now() - INTERVAL '48 hours')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 3: follow_up_due — earliest pending follow_up on/before today. (34Z.48)
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, due_at, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'follow_up_due', 30,
    (fu.follow_up_date::timestamp),
    'Follow-up: ' || COALESCE(NULLIF(fu.note, ''), 'scheduled touch'),
    d
  FROM public.leads l
  JOIN LATERAL (
    SELECT f.follow_up_date, f.note
      FROM public.follow_ups f
     WHERE f.lead_id = l.id
       AND f.is_done = false
       AND f.follow_up_date IS NOT NULL
       AND f.follow_up_date <= d
     ORDER BY f.follow_up_date ASC
     LIMIT 1
  ) fu ON true
  WHERE l.assigned_to = p_user_id
    AND l.stage NOT IN ('Won', 'Lost')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Return = genuinely NEW tasks this call (no longer the full set).
  RETURN inserted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_lead_tasks(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- A FALSE means an older copy of generate_lead_tasks was re-run and stripped a
-- locked fix → re-run this file to restore the canonical version.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%_assert_self_or_admin%'                              AS has_130_self_gate,
--   pg_get_functiondef(p.oid) LIKE '%status = ''open''%'                                  AS has_130_snooze_survival,
--   pg_get_functiondef(p.oid) LIKE '%ON CONFLICT (lead_id, kind, generated_for) DO NOTHING%' AS has_130_nopush_reuse,
--   pg_get_functiondef(p.oid) LIKE '%hot_idle%'                                           AS has_kind_hot_idle,
--   pg_get_functiondef(p.oid) LIKE '%new_untouched%'                                      AS has_kind_new_untouched,
--   pg_get_functiondef(p.oid) LIKE '%follow_up_due%'                                      AS has_kind_followup_due
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'generate_lead_tasks';
