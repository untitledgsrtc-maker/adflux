-- ============================================================================
-- db/functions/followup_after_done.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place followup_after_done is allowed to live. EDIT THIS FILE to
--    change it; never re-paste it into a new phaseN file (§71). It lived in 3
--    phase files (phase33d6_full_cadence, truth1_cadence_p0_fixes, phase174).
--
-- WHAT IT DOES: the CADENCE ENGINE. AFTER-UPDATE trigger on follow_ups, fires when
--    a follow-up flips is_done false→true. It (a) auto-closes earlier-sequence open
--    FUs in the same cadence, (b) de-stages QuoteSent→Nurture when a DUE seq-3
--    quote_chase is done, (c) respawns the nurture cadence — but ONLY while the
--    lead is still in Nurture. This is the §174-FROZEN function the owner was burned
--    by (the lost_nurture respawn loop). High-sensitivity — guardian before any change.
--
-- 🔒 LOCKED CONTRACTS (a diff that breaks any is a BLOCK — §174 + §56 Truth-1):
--    • §174 — NO lost_nurture respawn. There is deliberately NO lost_nurture branch.
--      A Lost lead must NOT get its cadence respawned here. Do NOT add one.
--    • Truth-1 — `IF NEW.lead_id IS NULL THEN RETURN NEW` (quote-linked FUs, which
--      have no lead, are skipped — they're handled elsewhere).
--    • Truth-1 — QuoteSent de-stage gate: only a quote_chase seq-8 FU (§278: the
--      LAST chase; was seq-3) that is DUE (follow_up_date <= IST today) on a
--      QuoteSent lead de-stages it to Nurture. "DUE" + "seq=8" + "stage=QuoteSent"
--      are all required. (Keep this in lockstep with the quote_chase array length
--      in supabase_phase33d6_full_cadence.sql — 8 days ⇒ seq 8 is the last.)
--    • Truth-1 — nurture respawn fires ONLY while v_lead.stage = 'Nurture' (the
--      zombie-nurture gate). Paused leads (cadence_paused) never respawn.
--    • the auto-skip close of earlier-sequence open FUs in the same cadence
--      (note marker '[auto-skipped: later FU done]').
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 (the phase174
--    body). Single signature (trigger fn). VERIFIED to carry ALL the §174 + Truth-1
--    contracts — phase174 is a clean superset; nothing was reverted. Running = NO-OP.
--
-- TRIGGER WIRING (trg_followup_after_done on follow_ups) lives in
--    supabase_phase33d6_full_cadence.sql — NOT here. Canonical owns the body only.
--
-- SUPERSEDES (Phase 178 removed the body from each; phase33d6 keeps its 8 other
--    cadence functions + the trigger):
--      supabase_phase33d6_full_cadence.sql
--      supabase_truth1_cadence_p0_fixes.sql
--      supabase_phase174_lost_followup_canonical.sql
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.followup_after_done()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lead leads%ROWTYPE; v_owner uuid;
BEGIN
  IF NEW.is_done IS NOT TRUE OR OLD.is_done IS TRUE THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.follow_ups
     SET is_done = true, note = COALESCE(note, '') || ' [auto-skipped: later FU done]'
   WHERE lead_id = NEW.lead_id AND cadence_type = NEW.cadence_type
     AND is_done = false AND sequence < NEW.sequence;
  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  IF v_lead.cadence_paused THEN RETURN NEW; END IF;
  v_owner := COALESCE(v_lead.assigned_to, v_lead.created_by);
  IF v_owner IS NULL THEN RETURN NEW; END IF;
  IF NEW.cadence_type = 'quote_chase' AND NEW.sequence = 8   -- §278: last chase (was seq 3 → now 8 after the quote_chase array was extended to 8 FUs)
     AND v_lead.stage = 'QuoteSent'
     AND NEW.follow_up_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    UPDATE public.leads SET stage = 'Nurture' WHERE id = NEW.lead_id;
  END IF;
  IF NEW.cadence_type = 'nurture' AND v_lead.stage = 'Nurture' THEN
    PERFORM public.spawn_nurture_followup(NEW.lead_id, v_owner, CURRENT_DATE, NEW.cadence_type);
  END IF;
  RETURN NEW;
END $function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- no_lost_nurture_respawn is the §174 lock — it must stay TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%OLD.is_done IS TRUE%'                    AS flip_guard,
--   pg_get_functiondef(p.oid) LIKE '%NEW.lead_id IS NULL%'                    AS truth1_quotelinked_skip,
--   pg_get_functiondef(p.oid) LIKE '%auto-skipped: later FU done%'            AS earlier_fu_close,
--   pg_get_functiondef(p.oid) LIKE '%quote_chase'' AND NEW.sequence = 8%'     AS quotesent_destage_gate,  -- §278: seq 3 → 8
--   pg_get_functiondef(p.oid) LIKE '%spawn_nurture_followup%'                 AS nurture_respawn,
--   pg_get_functiondef(p.oid) NOT LIKE '%lost_nurture%'                       AS no_lost_nurture_respawn
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'followup_after_done';
