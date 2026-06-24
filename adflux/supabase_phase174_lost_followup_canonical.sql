-- supabase_phase174_lost_followup_canonical.sql
-- Phase 174 (2026-06-20) — CANONICAL "a Lost lead has NO open follow-up, ever".
-- Ends the "Lost leads reappear in follow-ups" recurrence (owner: ~100 times).
--
-- NO NEW TRIGGER. This fixes the TWO existing functions that were fighting each
-- other — that fight is exactly why it kept coming back:
--
--   * followup_block_on_lost_lead (Phase 135) born-closes a follow-up created on
--     a Lost lead — BUT it deliberately SKIPPED cadence rows
--     (cadence_type IS NOT NULL → pass through), so a 'lost_nurture' row was
--     born OPEN.
--   * followup_after_done (truth1 P0-B) then RE-SPAWNED that 'lost_nurture' row
--     every time it was marked done while the lead was still Lost — a "30-day
--     re-engagement cycle". Close it → it returns. The reappearance loop.
--
-- Owner's standing directive (Phase 76.3, repeated, re-confirmed 20 Jun): "lost
-- lead we dont do anything its dead lead." So both halves of the cycle are the
-- bug. Two in-place edits, both removing a branch — no competing new trigger:
--
--   A. followup_block_on_lost_lead — REMOVE the `cadence_type IS NOT NULL` skip.
--      Now EVERY follow-up on a Lost lead (manual OR cadence/lost_nurture) is
--      born CLOSED (is_done=true). One guard, every spawner, kept for audit.
--   B. followup_after_done — REMOVE the lost_nurture respawn branch. Closing a
--      Lost lead's follow-up can no longer resurrect it. (The 'nurture' cadence
--      for stage='Nurture' is a live cycle and is KEPT.)
--
-- Existing closes (Phase 76.3 lead-terminal, Phase 134 quote/payment) stay.
-- Additive, idempotent, EXCEPTION-safe. §28 cadence types untouched
-- (lost_nurture still exists for history; it just never stays open or respawns).
-- No push / score / TA touched. INSERT does not fire followup_after_done
-- (UPDATE-only), so the born-closed guard never triggers a respawn.

-- ─── A. followup_block_on_lost_lead — born-close ALL FUs on a Lost lead ────
-- (Phase 135 function, with the `cadence_type IS NOT NULL` exemption removed.)
CREATE OR REPLACE FUNCTION public.followup_block_on_lost_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage text;
BEGIN
  -- Phase 174 — born-close EVERY open follow-up on a Lost lead, manual OR
  -- cadence (lost_nurture included). A Lost lead is dead; a rep who wants to
  -- keep chasing moves it to Nurture.
  IF NEW.lead_id IS NULL
     OR NEW.is_done IS TRUE THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT l.stage INTO v_stage FROM public.leads l WHERE l.id = NEW.lead_id;
    IF v_stage = 'Lost' THEN
      NEW.is_done   := true;
      NEW.done_at   := COALESCE(NEW.done_at, now());
      NEW.done_note := COALESCE(NEW.done_note, 'Auto-closed: lead is Lost (Phase 174)');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- never block a legit follow-up insert on a lookup hiccup
    RAISE WARNING 'followup_block_on_lost_lead skipped for lead %: %', NEW.lead_id, SQLERRM;
  END;
  RETURN NEW;
END $$;
-- (trigger trg_followup_block_on_lost_lead from Phase 135 stays bound to it.)

-- ─── B. followup_after_done — remove the lost_nurture respawn ─────────────
-- (truth1 function, with ONLY the `ELSIF lost_nurture ...` respawn removed.)
-- -------------------------------------------------------------------------
-- followup_after_done REMOVED from this file (Phase 178).
-- Canonical: db/functions/followup_after_done.sql (§174-FROZEN cadence engine).
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_followup_after_done) stays in phase33d6.
-- -------------------------------------------------------------------------

-- ─── Heal — close every currently-open follow_up on a Lost lead ───────────
-- Now safe to include lost_nurture: with the respawn gone (B), closing via
-- is_done can no longer resurrect it.
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, '') || ' [Phase 174 heal: lead is Lost]'
  FROM public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false
   AND l.stage = 'Lost';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY (read-only — safe any time)
-- =====================================================================
-- V1: the lost_nurture respawn branch is GONE (expect f).
SELECT pg_get_functiondef('public.followup_after_done()'::regprocedure)
       ILIKE '%cadence_type = ''lost_nurture'' AND v_lead.stage = ''Lost''%'
       AS lost_respawn_present_should_be_false;

-- V2: the born-closed guard no longer exempts cadence rows (expect f — no
-- `cadence_type IS NOT NULL` skip left in the function).
SELECT pg_get_functiondef('public.followup_block_on_lost_lead()'::regprocedure)
       ILIKE '%cadence_type IS NOT NULL%' AS cadence_exemption_present_should_be_false;

-- V3 MONITOR: open follow-ups on Lost leads — MUST be 0. Watch this daily; if it
-- ever returns > 0, a new leak path opened (re-run this file).
SELECT count(*) AS open_followups_on_lost_should_be_zero
  FROM public.follow_ups f JOIN public.leads l ON l.id = f.lead_id
 WHERE f.is_done = false AND l.stage = 'Lost';

SELECT 'Phase 174 canonical lost-lead no-followup applied' AS status;
