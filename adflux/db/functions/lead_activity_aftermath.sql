-- ============================================================================
-- db/functions/lead_activity_aftermath.sql — CANONICAL HOME (Phase 334 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place lead_activity_aftermath is allowed to live (§71/§72). Before this
--    it lived only in supabase_phase88_4_trigger_consolidation.sql (body now a pointer).
--
-- WHAT IT DOES: AFTER-INSERT trigger on lead_activities (trg_lead_activity_aftermath,
--    wiring stays in supabase_phase88_4_trigger_consolidation.sql). ONE lead SELECT feeds
--    three decisions on every activity a rep logs (HOT PATH - keep it light):
--      2. first engagement (call/meeting/site_visit on a New lead) -> stage 'Working'  (Phase 45.2)
--      3. outcome positive -> heat 'hot', negative -> 'cold' (skips Won/Lost)           (Phase 47.4)
--      5. next_action_date -> upsert the lead's earliest open follow-up                  (Phase 34)
--    Steps 2+3 are applied in ONE combined UPDATE on leads.
--
-- 🔒 PHASE 334 CHANGE (the ONLY difference from the live Phase 88.4 body): the follow-up
--    OWNER in step 5 is  COALESCE(assigned_to, telecaller_id, <activity author>)  — it was
--    COALESCE(assigned_to, author). A telecaller-owned lead has assigned_to NULL (owner in
--    telecaller_id, §99.C), so ANY non-owner who logged a next-action date (admin, sales head,
--    a rep covering) got the follow-up created for / re-pointed to THEMSELVES, and the lead's
--    owner lost it. Same wrong-owner family as Phase 333. 0 wrong rows live today, 55 such
--    activities historically (last 14 Aug 2026) — a latent hijack, closed before it bites.
--    Owner of record for follow-ups everywhere = assigned_to -> telecaller_id -> (created_by /
--    author as a last resort). Do NOT put the activity author ahead of telecaller_id.
--
-- 🔒 LOCKED (byte-identical to the live body — a diff that changes these is a BLOCK):
--    • step 2 stage flip New->Working, step 3 outcome->heat mapping + closed-lead skip,
--      step 4 single combined UPDATE (updated_at bumps only when stage/heat change),
--      step 5 earliest-open-follow-up upsert (UPDATE keeps the date+note from the activity),
--      SECURITY DEFINER + search_path 'public'.
--
-- PROVENANCE: captured from the LIVE DB 2026-10-05 (pg_get_functiondef), then the telecaller_id
--    middle term added. Single signature (trigger fn).
-- SUPERSEDES: supabase_phase88_4_trigger_consolidation.sql (function body removed there; its
--    trigger wiring + the 3 originals' rollback notes stay).
-- REVERT: re-run this file after editing; the previous (author-fallback) body is in git history.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_activity_aftermath()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead       record;     -- single SELECT of stage + heat + owner columns
  v_new_stage  text  := NULL;
  v_new_heat   text  := NULL;
  v_target_heat text;
  v_owner      uuid;
  v_existing_fu uuid;
BEGIN
  -- ─── 1. Single SELECT covers all 3 downstream decisions ──────
  SELECT stage, heat, assigned_to, telecaller_id
    INTO v_lead
    FROM public.leads
   WHERE id = NEW.lead_id;

  IF NOT FOUND THEN
    -- Lead row missing (defensive — FK should prevent this).
    RETURN NEW;
  END IF;

  -- ─── 2. lead_first_engagement_advance (Phase 45.2) ───────────
  -- Engagement activity on a New lead → flip to Working.
  IF NEW.activity_type IN ('call', 'meeting', 'site_visit')
     AND v_lead.stage = 'New' THEN
    v_new_stage := 'Working';
  END IF;

  -- ─── 3. lead_auto_heat_from_outcome (Phase 47.4) — INSERT ──
  -- positive → hot, negative → cold. neutral / callback / null
  -- leave heat alone. Skip on closed leads (Won / Lost).
  IF NEW.outcome IS NOT NULL
     AND v_lead.stage NOT IN ('Won', 'Lost')
  THEN
    IF NEW.outcome = 'positive' THEN
      v_target_heat := 'hot';
    ELSIF NEW.outcome = 'negative' THEN
      v_target_heat := 'cold';
    ELSE
      v_target_heat := NULL;
    END IF;
    -- Only set v_new_heat when it differs from current.
    IF v_target_heat IS NOT NULL
       AND v_lead.heat IS DISTINCT FROM v_target_heat THEN
      v_new_heat := v_target_heat;
    END IF;
  END IF;

  -- ─── 4. Single combined UPDATE on leads ──────────────────────
  -- Only fire if at least one column needs an update. updated_at
  -- bumps when either stage or heat changes.
  IF v_new_stage IS NOT NULL OR v_new_heat IS NOT NULL THEN
    UPDATE public.leads
       SET stage      = COALESCE(v_new_stage, stage),
           heat       = COALESCE(v_new_heat,  heat),
           updated_at = now()
     WHERE id = NEW.lead_id;
  END IF;

  -- ─── 5. lead_activity_sync_followup (Phase 34) ───────────────
  -- next_action_date triggers an upsert of the open follow_up row.
  -- Phase 334: owner = lead's assignee, THEN its telecaller, THEN the activity author
  -- (a telecaller-owned lead has assigned_to NULL — never hand its follow-up to the author).
  IF NEW.next_action_date IS NOT NULL THEN
    v_owner := COALESCE(v_lead.assigned_to, v_lead.telecaller_id, NEW.created_by);
    IF v_owner IS NOT NULL THEN
      SELECT id INTO v_existing_fu
        FROM public.follow_ups
       WHERE lead_id = NEW.lead_id
         AND is_done = false
       ORDER BY follow_up_date ASC
       LIMIT 1;

      IF v_existing_fu IS NOT NULL THEN
        UPDATE public.follow_ups
           SET follow_up_date = NEW.next_action_date,
               assigned_to    = v_owner,
               note           = COALESCE(NEW.notes, note)
         WHERE id = v_existing_fu;
      ELSE
        INSERT INTO public.follow_ups (
          lead_id, assigned_to, follow_up_date, follow_up_time,
          note, auto_generated
        ) VALUES (
          NEW.lead_id,
          v_owner,
          NEW.next_action_date,
          '10:00:00',
          COALESCE(NEW.notes, 'Follow up'),
          true
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only. All seven must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%SELECT stage, heat, assigned_to, telecaller_id%'      AS p334_selects_telecaller,
--   pg_get_functiondef(p.oid) LIKE '%COALESCE(v_lead.assigned_to, v_lead.telecaller_id, NEW.created_by)%' AS p334_owner_chain,
--   pg_get_functiondef(p.oid) LIKE '%v_new_stage := ''Working''%'                          AS first_engagement,
--   pg_get_functiondef(p.oid) LIKE '%v_target_heat := ''hot''%'                            AS auto_heat,
--   pg_get_functiondef(p.oid) LIKE '%Single combined UPDATE on leads%'                     AS single_update,
--   pg_get_functiondef(p.oid) LIKE '%ORDER BY follow_up_date ASC%'                         AS earliest_open_fu,
--   p.prosecdef                                                                            AS security_definer
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'lead_activity_aftermath';
