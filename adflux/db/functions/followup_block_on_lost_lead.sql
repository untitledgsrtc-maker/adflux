-- ============================================================================
-- db/functions/followup_block_on_lost_lead.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place followup_block_on_lost_lead is allowed to live. EDIT THIS FILE
--    to change it; never re-paste it into a new phaseN file (§71). It lived in 2
--    files (phase135_lost_means_dead, phase174_lost_followup_canonical).
--
-- WHAT IT DOES: BEFORE-INSERT trigger on follow_ups. The §174-FROZEN "Lost means
--    dead" guard — if a follow-up is being inserted for a lead that is already in
--    stage 'Lost', it is BORN CLOSED (is_done=true). A Lost lead carries NO open
--    follow-up. Paired with §174's followup_after_done (no lost_nurture respawn).
--
-- 🆕 PHASE 356 (owner 2026-10-11): the SAME guard now also covers a WON lead.
--    A deal that is Won carries no open lead-linked follow-up (the rule §134 already
--    stated; only the Won TRANSITION used to close them, so a follow-up created AFTER the
--    win - a call-outcome "call back", a typed follow-up - stayed open and kept nagging
--    the rep; Ajay, 10 Oct). Born-closed with done_note 'Auto-closed: lead is Won
--    (Phase 356)' (still the §175 isSystemClose prefix). EXEMPT, on purpose:
--      * a 'HOT —%' task (a WhatsApp buying-intent alert from flag_lead_hot_from_wa,
--        section 209 - a Won client asking for a new quote must still reach the rep);
--      * the reassign landing task 'New lead handed to you by X - call today'
--        (section 106 / _reassign_lead_apply; an ADMIN may reassign a Won lead, and the
--        new owner must still get the task + push);
--      * quote-linked rows (lead_id NULL: payment collection) - already pass-through.
--    Name kept (trigger wiring + the §211 re-lock reference it); it guards Lost AND Won.
--
-- 🔒 LOCKED CONTRACTS (§174 — a diff that breaks any is a BLOCK):
--    • Born-close ALL follow-ups on a Lost lead — manual AND cadence. §174
--      SUPERSEDED §135's "manual (cadence_type NULL) only" skip; there is
--      deliberately NO cadence_type condition here. Do NOT re-add one.
--    • done_note = 'Auto-closed: lead is Lost (Phase 174)' — this exact prefix is
--      what §175 isSystemClose() matches, so it counts as a SYSTEM close (not a
--      rep-done) in the team report + rep card. Keep the 'Auto-closed' prefix.
--    • Pass-through (no-op) when lead_id IS NULL (quote-linked FUs) or the row is
--      already is_done.
--    • EXCEPTION WHEN OTHERS → RAISE WARNING — a stage-lookup failure must NEVER
--      break the follow-up insert.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-24 (the phase174
--    body). Single signature (trigger fn). Running this file is a NO-OP.
--
-- TRIGGER WIRING (the BEFORE INSERT trigger on follow_ups) lives in the phase
--    files — NOT here. This canonical owns the function body only.
--
-- SUPERSEDES (Phase 178 removed the body from both):
--      supabase_phase135_lost_means_dead.sql      (the older manual-only version)
--      supabase_phase174_lost_followup_canonical.sql (the live born-close-ALL version)
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom — the
-- no_cadence_skip check is the §174 lock (§135 had a cadence_type condition; §174
-- removed it so cadence FUs on Lost are ALSO born-closed).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.followup_block_on_lost_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_stage text;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.is_done IS TRUE THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT l.stage INTO v_stage FROM public.leads l WHERE l.id = NEW.lead_id;
    IF v_stage = 'Lost' THEN
      NEW.is_done   := true;
      NEW.done_at   := COALESCE(NEW.done_at, now());
      NEW.done_note := COALESCE(NEW.done_note, 'Auto-closed: lead is Lost (Phase 174)');
    ELSIF v_stage = 'Won'
          AND COALESCE(NEW.note, '') NOT LIKE 'HOT —%'
          AND COALESCE(NEW.note, '') NOT LIKE 'New lead handed to you%' THEN
      -- Phase 356: Won = done. HOT tasks (WhatsApp buying intent) are exempt.
      NEW.is_done   := true;
      NEW.done_at   := COALESCE(NEW.done_at, now());
      NEW.done_note := COALESCE(NEW.done_note, 'Auto-closed: lead is Won (Phase 356)');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'followup_block_on_lost_lead skipped for lead %: %', NEW.lead_id, SQLERRM;
  END;
  RETURN NEW;
END $function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only. All nine must be TRUE.
-- no_cadence_skip is the §174 lock (must stay TRUE — re-adding a cadence_type
-- condition would let cadence FUs survive on a Lost lead, the bug §174 killed).
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%NEW.lead_id IS NULL%'              AS quotelinked_skip,
--   pg_get_functiondef(p.oid) LIKE '%v_stage = ''Lost''%'              AS lost_check,
--   pg_get_functiondef(p.oid) LIKE '%NEW.is_done   := true%'           AS born_closed,
--   pg_get_functiondef(p.oid) LIKE '%Auto-closed: lead is Lost%'       AS system_close_note,
--   pg_get_functiondef(p.oid) NOT LIKE '%cadence_type%'                AS no_cadence_skip,
--   pg_get_functiondef(p.oid) LIKE '%EXCEPTION WHEN OTHERS%'           AS never_break_insert,
--   pg_get_functiondef(p.oid) LIKE '%v_stage = ''Won''%'               AS won_check,
--   pg_get_functiondef(p.oid) LIKE '%NOT LIKE ''HOT —%'                AS hot_exempt,
--   pg_get_functiondef(p.oid) LIKE '%NOT LIKE ''New lead handed to you%' AS handover_exempt
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'followup_block_on_lost_lead';
