-- ============================================================================
-- db/functions/create_payment_collection_followups.sql — CANONICAL HOME (§71/§72)
-- ============================================================================
-- The ONE place create_payment_collection_followups lives. Fires on quote → WON
-- (via tg_quote_won_payment_followups, wired in supabase_phase33g_*) to spawn 3
-- payment-collection follow_ups.
--
-- WHY THIS IS THE CANONICAL — the §69 "works then breaks" that bit WON on 1 Jul:
--   • Phase 33G created it WITH q.ref_number.
--   • Phase 33N dropped q.ref_number ("real prod bug") — but WITHOUT a Lost guard.
--   • Phase 186 re-added the Lost-lead skip — but re-introduced q.ref_number,
--     silently reverting 33N → "column q.ref_number does not exist" on every WON
--     (fixed Phase 182.1). Two copies (phase33g + phase33n) that DIFFER = the
--     disease. This canonical is the SUPERSET of both real fixes.
--
-- LOCKED contracts (BLOCK on regress — see the VERIFY tripwire at the bottom):
--   1. NO q.ref_number — the column was dropped in Phase 33N. NEVER re-add it.
--   2. Lost-lead skip (Phase 186) — never spawn payment chases on a Lost lead.
--   3. Duplicate-Won guard (skip if 'Payment collection%' FUs already exist).
--   4. SECURITY DEFINER + search_path=public.
-- To change: EDIT THIS FILE and run it once in Studio. Do NOT re-paste the body
-- into a phaseN file (phase33g + phase33n bodies are neutralized to pointers).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_payment_collection_followups(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote    record;
  v_existing int;
BEGIN
  -- (the dead quote column dropped in Phase 33N stays gone — never re-add it below.)
  SELECT q.id, q.created_by, q.total_amount,
         COALESCE(q.quote_number, q.id::text) AS label,
         l.stage AS lead_stage
    INTO v_quote
    FROM quotes q
    LEFT JOIN leads l ON l.id = q.lead_id
   WHERE q.id = p_quote_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'create_payment_collection_followups: quote % not found', p_quote_id;
    RETURN;
  END IF;

  -- Phase 186 — never spawn payment chases on a Lost lead (they'd live forever
  -- on the follow-ups screen; every lead-keyed closer misses lead_id-NULL rows).
  IF v_quote.lead_stage = 'Lost' THEN
    RAISE NOTICE 'create_payment_collection_followups: lead Lost for %, skipping', p_quote_id;
    RETURN;
  END IF;

  -- Duplicate-Won guard.
  SELECT COUNT(*) INTO v_existing
    FROM follow_ups
   WHERE quote_id = p_quote_id
     AND note LIKE 'Payment collection%';

  IF v_existing > 0 THEN
    RAISE NOTICE 'create_payment_collection_followups: already exist for %, skipping', p_quote_id;
    RETURN;
  END IF;

  INSERT INTO follow_ups (quote_id, assigned_to, follow_up_date, note) VALUES
    (p_quote_id, v_quote.created_by, (CURRENT_DATE + INTERVAL '7 days')::date,
     'Payment collection: ₹' || to_char(v_quote.total_amount, 'FM99,99,99,999') || ' due (' || v_quote.label || ')'),
    (p_quote_id, v_quote.created_by, (CURRENT_DATE + INTERVAL '15 days')::date,
     'Payment collection: 2nd reminder · ₹' || to_char(v_quote.total_amount, 'FM99,99,99,999')),
    (p_quote_id, v_quote.created_by, (CURRENT_DATE + INTERVAL '30 days')::date,
     'Payment collection: final reminder · escalate if unpaid');
END $$;

GRANT EXECUTE ON FUNCTION public.create_payment_collection_followups(uuid) TO authenticated;

-- ============================================================================
-- VERIFY / TRIPWIRE — both must be TRUE. FALSE = an old copy was re-run; re-run
-- this canonical to restore.
-- ============================================================================
-- SELECT pg_get_functiondef('public.create_payment_collection_followups(uuid)'::regprocedure)
--          NOT LIKE '%ref_number%' AS no_ref_number;   -- expect true
-- SELECT pg_get_functiondef('public.create_payment_collection_followups(uuid)'::regprocedure)
--          LIKE '%lead_stage = ''Lost''%' AS has_lost_guard; -- expect true
