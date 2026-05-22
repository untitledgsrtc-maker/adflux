-- supabase_phase88_4_trigger_consolidation.sql
--
-- Phase 88.4 — consolidate 3 AFTER INSERT triggers on
-- lead_activities into a single combined function. Same business
-- logic, fewer SELECT + UPDATE round-trips per row insert.
--
-- Owner directive 23 May 2026 (afternoon sprint): 'feely like its
-- done in milisecons'. Phase 88.1 cut JS-side wait; this commit
-- cuts SQL-side wait on the activity insert path.
--
-- BEFORE
--   AFTER INSERT fires 3 triggers serially:
--     1. trg_lead_first_engagement_advance   → SELECT stage + UPDATE
--     2. trg_lead_auto_heat_from_outcome     → SELECT stage,heat + UPDATE
--     3. trg_lead_activity_sync_followup     → SELECT assigned_to + UPDATE/INSERT follow_ups
--   Each trigger does its own row lookup. ~3 SELECT + 1-3 UPDATE
--   per insert. Combined cost in production ~80-200ms warm,
--   ~500ms cold.
--
-- AFTER
--   ONE consolidated trigger fires lead_activity_aftermath()
--   which:
--     - Reads the lead row ONCE (stage, heat, assigned_to).
--     - Runs all 3 decisions in PL/pgSQL locals.
--     - Issues a SINGLE UPDATE on leads with a combined SET clause.
--     - Then handles the follow_ups upsert (separate table).
--   Saved: 2 redundant SELECTs + up to 2 redundant UPDATEs per row.
--
-- The auto_heat UPDATE-of-outcome path stays a separate, dedicated
-- trigger because the INSERT path is the hot one — rep saves
-- outcome at insert time (Phase 88.1 optimistic save). The UPDATE
-- path is rare (admin manually edits a past activity).
--
-- Idempotent. Re-running is safe. ROLLBACK at the bottom.

-- ─────────────────────────────────────────────────────────────────
-- Consolidated function
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lead_activity_aftermath()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead       record;     -- single SELECT of stage + heat + assigned_to
  v_new_stage  text  := NULL;
  v_new_heat   text  := NULL;
  v_target_heat text;
  v_owner      uuid;
  v_existing_fu uuid;
BEGIN
  -- ─── 1. Single SELECT covers all 3 downstream decisions ──────
  SELECT stage, heat, assigned_to
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
  -- next_action_date triggers an upsert of the open follow_up
  -- row. Owner of the follow-up = current lead assignee, fallback
  -- to activity author.
  IF NEW.next_action_date IS NOT NULL THEN
    v_owner := COALESCE(v_lead.assigned_to, NEW.created_by);
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
$$;

-- ─────────────────────────────────────────────────────────────────
-- Swap the 3 individual triggers for 1 consolidated trigger.
-- Original functions are NOT dropped — left in place so re-running
-- the source SQL files works + admin can attach them again
-- manually for a rollback.
-- ─────────────────────────────────────────────────────────────────

-- Drop the 3 redundant AFTER INSERT triggers.
DROP TRIGGER IF EXISTS trg_lead_first_engagement_advance
  ON public.lead_activities;
DROP TRIGGER IF EXISTS trg_lead_activity_sync_followup
  ON public.lead_activities;
-- Note: trg_lead_auto_heat_from_outcome covers BOTH INSERT + UPDATE.
-- Drop ONLY the INSERT side via DROP + CREATE pattern below.
DROP TRIGGER IF EXISTS trg_lead_auto_heat_from_outcome
  ON public.lead_activities;

-- ─── New consolidated INSERT trigger ─────────────────────────────
DROP TRIGGER IF EXISTS trg_lead_activity_aftermath
  ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_aftermath
AFTER INSERT ON public.lead_activities
FOR EACH ROW
EXECUTE FUNCTION public.lead_activity_aftermath();

-- ─── Re-attach UPDATE-only auto_heat trigger ─────────────────────
-- The INSERT path is now in the consolidated function. The UPDATE
-- path (admin manually edits outcome on a past activity) needs its
-- own trigger.
--
-- Phase 88.4.1 (hotfix 2026-05-23): the original
-- lead_auto_heat_from_outcome() function from Phase 47.4 wasn't
-- deployed on this database. Inline the definition here so the
-- SQL file is self-contained — no dependency on Phase 47.4 source
-- ever having been run.
CREATE OR REPLACE FUNCTION public.lead_auto_heat_from_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_heat text;
  v_current     record;
BEGIN
  IF NEW.outcome IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.outcome IS NOT DISTINCT FROM NEW.outcome THEN
    RETURN NEW;
  END IF;
  IF NEW.outcome = 'positive' THEN
    v_target_heat := 'hot';
  ELSIF NEW.outcome = 'negative' THEN
    v_target_heat := 'cold';
  ELSE
    RETURN NEW;
  END IF;
  SELECT stage, heat INTO v_current
    FROM public.leads
   WHERE id = NEW.lead_id;
  IF v_current.stage IN ('Won', 'Lost') THEN
    RETURN NEW;
  END IF;
  IF v_current.heat = v_target_heat THEN
    RETURN NEW;
  END IF;
  UPDATE public.leads
     SET heat       = v_target_heat,
         updated_at = now()
   WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_auto_heat_on_update
  ON public.lead_activities;
CREATE TRIGGER trg_lead_auto_heat_on_update
AFTER UPDATE OF outcome ON public.lead_activities
FOR EACH ROW
EXECUTE FUNCTION public.lead_auto_heat_from_outcome();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
-- Expected rows after run:
--   • trg_lead_activity_aftermath           = 1
--   • trg_lead_auto_heat_on_update          = 1
--   • trg_lead_first_engagement_advance     = 0 (dropped)
--   • trg_lead_activity_sync_followup       = 0 (dropped)
--   • trg_lead_auto_heat_from_outcome       = 0 (dropped — INSERT
--                                                 path now in
--                                                 aftermath)
SELECT tgname, tgenabled FROM pg_trigger
  WHERE tgrelid = 'public.lead_activities'::regclass
    AND tgname IN (
      'trg_lead_activity_aftermath',
      'trg_lead_auto_heat_on_update',
      'trg_lead_first_engagement_advance',
      'trg_lead_activity_sync_followup',
      'trg_lead_auto_heat_from_outcome'
    )
  ORDER BY tgname;

-- ─── ROLLBACK (paste manually if Phase 88.4 misbehaves) ──────────
-- DROP TRIGGER IF EXISTS trg_lead_activity_aftermath ON public.lead_activities;
-- DROP TRIGGER IF EXISTS trg_lead_auto_heat_on_update ON public.lead_activities;
-- CREATE TRIGGER trg_lead_first_engagement_advance
--   AFTER INSERT ON public.lead_activities
--   FOR EACH ROW EXECUTE FUNCTION public.lead_first_engagement_advance();
-- CREATE TRIGGER trg_lead_activity_sync_followup
--   AFTER INSERT ON public.lead_activities
--   FOR EACH ROW EXECUTE FUNCTION public.lead_activity_sync_followup();
-- CREATE TRIGGER trg_lead_auto_heat_from_outcome
--   AFTER INSERT OR UPDATE OF outcome ON public.lead_activities
--   FOR EACH ROW EXECUTE FUNCTION public.lead_auto_heat_from_outcome();
-- NOTIFY pgrst, 'reload schema';
