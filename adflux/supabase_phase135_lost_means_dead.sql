-- =====================================================================
-- PHASE 135 — "Lost means dead": no open follow-ups on a Lost lead, ever
-- 2026-06-12  (owner option A, follows Phase 134)
--
-- The Phase 134 VERIFY left 1 open lead-tied FU on a Lost lead: a
-- REP-TYPED manual note ('owner is out off citey', kalpesh chavda, due
-- 16 Jun). cadence_type NULL, auto_generated=false. It survived because
-- it was added to the lead OUTSIDE the →Lost stage transition (the
-- Phase 76.3 terminal-close fires only ON the transition; a manual
-- follow-up created on an already-Lost lead is never re-swept).
--
-- Owner A: Lost = dead. A rep who wants to keep chasing uses NURTURE.
-- So: (1) close the existing strays, (2) a BEFORE INSERT guard so any
-- new follow_up created against a Lost lead is born already-closed
-- (kept for audit, never clutters the open list). Manual + auto alike.
--
-- §45-safe: the guard is BEFORE INSERT on follow_ups, does ONE indexed
-- lookup (leads PK) and is EXCEPTION-wrapped to NEVER block a legit
-- insert. INSERT does not fire followup_after_done (UPDATE OF is_done),
-- so no respawn. No push, no cadence/score change. Won leads NOT touched
-- here (their lead-tied FUs already close at the →Won transition;
-- payment-collection stays open to collect — Phase 134).
-- =====================================================================


-- ─── 1. BEFORE INSERT guard — born-closed on a Lost lead ─────────────
-- -------------------------------------------------------------------------
-- followup_block_on_lost_lead REMOVED from this file (Phase 178).
-- Canonical: db/functions/followup_block_on_lost_lead.sql (§174-FROZEN Lost guard).
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_followup_block_on_lost_lead ON public.follow_ups;
CREATE TRIGGER trg_followup_block_on_lost_lead
  BEFORE INSERT ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.followup_block_on_lost_lead();


-- ─── 2. Heal — close existing open lead-tied FUs on Lost leads ───────
-- (non-lost_nurture only — closing lost_nurture via is_done on a Lost
-- lead would respawn it via truth1; Phase 134 A2 already DELETEs those.
-- The live stray = a manual cadence-NULL row, caught here.)
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, 'Auto-closed: lead is Lost (Phase 135 heal)')
  FROM public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false
   AND l.stage = 'Lost'
   AND fu.cadence_type IS DISTINCT FROM 'lost_nurture';


-- self-register
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_phase135_lost_means_dead.sql',
            'BEFORE INSERT guard: follow_up on a Lost lead is born-closed + heal existing strays')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY — expect trg=1, open_on_lost=0 ───────────────────────────
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_followup_block_on_lost_lead')   AS guard_trg,
  (SELECT count(*) FROM public.follow_ups f JOIN public.leads l ON l.id=f.lead_id
     WHERE f.is_done=false AND l.stage='Lost')                                       AS open_on_lost_leads;

SELECT 'Phase 135 lost-means-dead applied' AS status;
