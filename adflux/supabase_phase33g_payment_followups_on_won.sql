-- supabase_phase33g_payment_followups_on_won.sql
--
-- Phase 33G.7 — auto-create payment collection follow-ups when a
-- quote moves to status='won'. Owner directive: after Won, the rep
-- needs scheduled chases for the outstanding balance.
--
-- Cadence: 3 follow-ups at +7d, +15d, +30d from the won timestamp.
-- (Mirrors the lead_intro / quote_chase cadence shape from Phase 33D.6.)
--
-- Notes carry the outstanding amount snapshot at trigger time so the
-- rep sees ₹ on each FU card. Outstanding here = total_amount because
-- "won" is the trigger moment; payments will subtract from this as
-- they come in. The follow_ups page reads the latest computed balance
-- from quotes + payments when rendering.
--
-- Idempotent:
--   - Function CREATE OR REPLACE.
--   - Trigger DROP IF EXISTS then CREATE.
--   - Internal guard: function checks if payment_collection FUs
--     already exist for this quote before inserting (prevents
--     duplicates if Won → not-won → Won round-trip happens, though
--     Phase 11b's "no status reversion" trigger should make that
--     impossible).

-- ─── 1. Function ──────────────────────────────────────────────────
-- Phase 182.1 (§71/§72) — create_payment_collection_followups body MOVED to its
-- canonical home: db/functions/create_payment_collection_followups.sql. It was
-- duplicated here (with q.ref_number + the Lost guard) AND in phase33n_ref_number_
-- fix (no ref_number, no Lost guard); Phase 186's rewrite here re-added ref_number
-- and reverted the 33N fix → the WON crash. The body is now single-source; the
-- trigger + wiring below stay. Do NOT re-paste the function body here.

GRANT EXECUTE ON FUNCTION public.create_payment_collection_followups(uuid) TO authenticated;

-- ─── 2. Trigger function ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_quote_won_payment_followups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fire only on transition INTO 'won' (not won→won updates).
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'won' AND NEW.status = 'won')
     OR (TG_OP = 'INSERT' AND NEW.status = 'won') THEN
    PERFORM public.create_payment_collection_followups(NEW.id);
  END IF;
  RETURN NEW;
END $$;

-- ─── 3. Wire trigger ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS tg_quote_won_payment_followups ON quotes;
CREATE TRIGGER tg_quote_won_payment_followups
  AFTER INSERT OR UPDATE OF status ON quotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_quote_won_payment_followups();

-- ─── 4. Phase 186 heal — close payment FUs already leaked onto Lost leads ──
-- One-time, idempotent. Closes open 'Payment collection%' follow_ups whose
-- quote's lead is Lost (the rows the spawn-guard above now prevents). The
-- 'Auto-closed:' done_note matches §175 isSystemClose, so these never inflate
-- any rep's "done today" count (§133). Re-running is safe (is_done=true excluded).
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, 'Auto-closed: lead is Lost (Phase 186 payment-FU heal)')
  FROM public.quotes q
  JOIN public.leads  l ON l.id = q.lead_id
 WHERE q.id = fu.quote_id
   AND fu.is_done = false
   AND fu.note LIKE 'Payment collection%'
   AND l.stage = 'Lost';

NOTIFY pgrst, 'reload schema';

-- VERIFY (Phase 186): expect 0 — no open payment FU on a Lost lead remains.
-- SELECT count(*) FROM public.follow_ups fu
--   JOIN public.quotes q ON q.id = fu.quote_id
--   JOIN public.leads  l ON l.id = q.lead_id
--  WHERE fu.is_done = false AND fu.note LIKE 'Payment collection%' AND l.stage = 'Lost';

-- VERIFY:
-- Flip a test quote to won and check follow_ups appears:
--   UPDATE quotes SET status = 'won' WHERE id = '<test_quote_id>';
--   SELECT follow_up_date, note FROM follow_ups
--     WHERE quote_id = '<test_quote_id>' AND note LIKE 'Payment collection%'
--     ORDER BY follow_up_date;
-- Expect: 3 rows at +7d / +15d / +30d.
