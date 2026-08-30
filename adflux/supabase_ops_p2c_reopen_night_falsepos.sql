-- ============================================================================
-- supabase_ops_p2c_reopen_night_falsepos.sql — one-time data fix (§264 / §259).
-- ============================================================================
-- A prior AD-HOC cleanup (ONE manual UPDATE, ~2026-08-28 00:42 IST, note tag
-- '[night false-positive]') cancelled auto_offline tickets that had crossed a
-- calendar day = real lingering faults. It is NOT a live function or cron
-- (verified: no pg_proc definition and no cron.job command writes that tag), so
-- this only REOPENS the affected rows — no engine fix is needed. §260's p2b
-- reopened '[auto-recovered]' rows only and never touched these.
--
-- Reopens: source='auto_offline' + status='cancelled' + note '[night
-- false-positive]' where the cancel day <> the open day (IST) — i.e. a
-- previous-day fault the §259 calendar-day rule protects. A same-night false
-- positive (opened AND cancelled on the same IST day) stays cancelled — that one
-- really was the timer turning the screen off, not a fault.
--
-- Safe: only un-cancels (no delete). Idempotent — after this runs the rows are
-- 'open' so a second run matches nothing. The reopened tickets were opened on a
-- previous day → the §259 reconcile will NOT re-cancel them.
--
-- ⛔ DO NOT re-run the ad-hoc '[night false-positive]' night cleanup (§264): it
--    violates the §259 calendar-day rule by cancelling multi-day faults. The
--    engine is already night-gated (§250/§254/§255) — no night cleanup is needed.
-- ============================================================================

-- PREVIEW (optional — how many + which):
-- SELECT id, (opened_at AT TIME ZONE 'Asia/Kolkata')::date AS opened_day,
--        (resolved_at AT TIME ZONE 'Asia/Kolkata')::date AS closed_day, left(notes,60) AS notes
--   FROM public.ops_tickets
--  WHERE source='auto_offline' AND status='cancelled'
--    AND notes LIKE '%[night false-positive]%' AND resolved_at IS NOT NULL
--    AND (opened_at   AT TIME ZONE 'Asia/Kolkata')::date
--     <> (resolved_at AT TIME ZONE 'Asia/Kolkata')::date
--  ORDER BY opened_at DESC;

UPDATE public.ops_tickets
   SET status      = 'open',
       resolved_at = NULL,
       notes       = COALESCE(notes,'') || ' [reopened §264: night false-positive was a real multi-day fault]',
       updated_at  = now()
 WHERE source = 'auto_offline'
   AND status = 'cancelled'
   AND notes LIKE '%[night false-positive]%'
   AND resolved_at IS NOT NULL
   AND (opened_at   AT TIME ZONE 'Asia/Kolkata')::date
    <> (resolved_at AT TIME ZONE 'Asia/Kolkata')::date;

NOTIFY pgrst, 'reload schema';

-- VERIFY (after): should return 0 — no night-false-positive multi-day cancel remains.
-- SELECT count(*) AS still_wrong
--   FROM public.ops_tickets
--  WHERE source='auto_offline' AND status='cancelled'
--    AND notes LIKE '%[night false-positive]%' AND resolved_at IS NOT NULL
--    AND (opened_at   AT TIME ZONE 'Asia/Kolkata')::date
--     <> (resolved_at AT TIME ZONE 'Asia/Kolkata')::date;
-- ============================================================================
