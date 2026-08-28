-- ============================================================================
-- supabase_ops_p2b_reopen_miscancelled.sql — one-time data fix (§259 / §260).
-- ============================================================================
-- The OLD auto-cancel rule (rolling 24h, superseded by §259 calendar-day IST)
-- wrongly cancelled some previous-day / multi-day auto-tickets when a depot
-- flickered back online. This reopens ONLY those: auto_offline tickets that were
-- auto-recovered (note tag '[auto-recovered]') whose cancel happened on a
-- DIFFERENT IST calendar day than they were opened — i.e. the new §259 rule
-- would NOT have cancelled them. Same-day blips (correctly cancelled) are left
-- untouched.
--
-- Safe: only un-cancels (restores to 'open'); no data deleted. Idempotent — after
-- this runs the rows are 'open', so a second run matches nothing. The reopened
-- tickets were opened on a previous day, so the §259 reconcile will NOT re-cancel
-- them (it only auto-cancels tickets opened today, IST). Owner runs once in Studio.
-- ============================================================================

-- PREVIEW (optional — run this SELECT first to see how many + which will reopen):
-- SELECT id, depot_id, opened_at, resolved_at, down_count
--   FROM public.ops_tickets
--  WHERE source = 'auto_offline' AND status = 'cancelled'
--    AND notes LIKE '%[auto-recovered]%' AND resolved_at IS NOT NULL
--    AND (opened_at   AT TIME ZONE 'Asia/Kolkata')::date
--     <> (resolved_at AT TIME ZONE 'Asia/Kolkata')::date
--  ORDER BY opened_at DESC;

UPDATE public.ops_tickets
   SET status      = 'open',
       resolved_at = NULL,
       notes       = COALESCE(notes,'') || ' [reopened §259: previous-day fault, not a same-day blip]',
       updated_at  = now()
 WHERE source = 'auto_offline'
   AND status = 'cancelled'
   AND notes LIKE '%[auto-recovered]%'
   AND resolved_at IS NOT NULL
   AND (opened_at   AT TIME ZONE 'Asia/Kolkata')::date
    <> (resolved_at AT TIME ZONE 'Asia/Kolkata')::date;

NOTIFY pgrst, 'reload schema';

-- VERIFY (after): should return 0 — nothing mis-cancelled remains.
-- SELECT count(*) AS still_miscancelled
--   FROM public.ops_tickets
--  WHERE source = 'auto_offline' AND status = 'cancelled'
--    AND notes LIKE '%[auto-recovered]%' AND resolved_at IS NOT NULL
--    AND (opened_at   AT TIME ZONE 'Asia/Kolkata')::date
--     <> (resolved_at AT TIME ZONE 'Asia/Kolkata')::date;
-- ============================================================================
