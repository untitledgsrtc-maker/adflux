-- =====================================================================
-- Phase 117 — close orphaned quote-chase follow-ups when a quote is
-- deleted (lead drops back to Working)
-- 2026-06-06
--
-- OWNER-REPORTED SYMPTOM
--   "make quote from lead, mark it lost, but follow-up keeps coming."
--
-- DIAGNOSIS (from live data 2026-06-06)
--   The LOST path already works: quote.status='lost'
--     → trg_quote_status_propagate_to_lead (Phase 34Q) flips lead→Lost
--     → trg_z_close_followups_on_terminal (Phase 76.3) closes follow-ups.
--   Proven live: quote 52135db7 → lead Lost → 0 open follow-ups. ✓
--
--   The real leak is the DELETE path. Lead "Bhadrajit Raj" sat at
--   stage='Working' with NO quote (quote_id null) yet carried 3 open
--   quote_chase follow-ups (06-03 / 06-06 / 06-10). Quote-chase rows
--   only spawn at QuoteSent — so his quote was DELETED, the Phase
--   34Z.50 rollback demoted the lead QuoteSent→Working + cleared
--   quote_id, but it never CLOSED the quote-chase follow-ups. They
--   keep firing for a quote that no longer exists.
--
-- THE RULE THIS ENFORCES
--   A quote_chase follow-up is only valid while the lead is at
--   'QuoteSent'. The moment the lead leaves QuoteSent for a
--   non-terminal reason (quote deleted → Working), its quote-chase
--   follow-ups must close. (Lost/Won already covered by Phase 76.3;
--   Nurture already covered by the Phase 33D.6 cadence cancel.)
--
-- WHAT THIS FILE DOES
--   1. CREATE OR REPLACE quote_after_delete_rollback_lead() — same body
--      as Phase 34Z.50 PLUS: when it demotes a lead out of QuoteSent
--      (no surviving quote), also close that lead's open quote_chase
--      follow-ups. Re-asserts the AFTER DELETE trigger (idempotent).
--   2. One-time heal: close every open quote_chase follow-up whose lead
--      is no longer at QuoteSent (cleans up Bhadrajit's 3 + any others).
--
-- SAFETY (CLAUDE.md §45 — live app untouchable)
--   • The trigger change fires ONLY on quote DELETE (rare admin action,
--     Phase 74 delete-rules gate it) — NOT on any hot save path. Zero
--     added latency to /work, /telecaller, lead detail, or any save.
--   • Closes ONLY cadence_type='quote_chase' rows — lead_intro / manual
--     / nurture follow-ups are untouched.
--   • Does NOT touch the LOST propagation (Phase 34Q) — that works.
--   • follow_ups.done_note exists (Phase 76.3). is_done/done_at standard.
--   • Idempotent. Re-run safe. Supersedes the Phase 34Z.50 copy of this
--     ONE function — if 34Z.50 is ever re-run, re-run Phase 117 after it.
-- =====================================================================

-- ─── 1. Extended delete-rollback function ───────────────────────────
-- -------------------------------------------------------------------------
-- quote_after_delete_rollback_lead REMOVED from this file (Phase 178). Canonical: db/functions/quote_after_delete_rollback_lead.sql
-- Do NOT re-add (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------

-- Re-assert the trigger (idempotent — self-contained for a fresh DB).
DROP TRIGGER IF EXISTS trg_quote_after_delete_rollback_lead ON public.quotes;
CREATE TRIGGER trg_quote_after_delete_rollback_lead
  AFTER DELETE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.quote_after_delete_rollback_lead();


-- ─── 2. One-time heal — close orphaned quote-chase follow-ups ────────
-- A quote-chase follow-up only belongs to a lead actively at QuoteSent.
-- Any open quote_chase row whose lead has moved on is stale → close it.
-- Leaves legit QuoteSent leads (active 'sent' quotes) fully untouched.
UPDATE public.follow_ups f
   SET is_done   = true,
       done_at   = now(),
       done_note = COALESCE(f.done_note, '') || ' [retro-closed: Phase 117 quote-chase orphan heal]'
  FROM public.leads l
 WHERE f.lead_id      = l.id
   AND f.is_done      = false
   AND f.cadence_type = 'quote_chase'
   AND l.stage       <> 'QuoteSent';


NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Trigger present; orphan count should be ZERO after the heal.
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_quote_after_delete_rollback_lead')          AS del_trigger,
  (SELECT count(*) FROM public.follow_ups f
     JOIN public.leads l ON l.id = f.lead_id
    WHERE f.is_done = false
      AND f.cadence_type = 'quote_chase'
      AND l.stage <> 'QuoteSent')                                   AS orphan_chase_should_be_zero;

SELECT 'Phase 117 quote-chase orphan fix applied' AS status;
