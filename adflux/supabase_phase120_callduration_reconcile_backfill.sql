-- =====================================================================
-- Phase 120 — backfill: reconcile call_logs.duration_seconds from the
-- matching call activity (one-time heal for the duration-write race)
-- 2026-06-06
--
-- ROOT CAUSE (fixed going-forward in PostCallOutcomeModal, Phase 120 JS)
--   The modal writes a captured call duration to TWO rows: the
--   lead_activities row (by id, no filter — always succeeds) and the
--   call_logs audit row (filtered to outcome IN connected/callback —
--   Phase 102.B). The outcome flip to 'connected' was fire-and-forget
--   and RACED the duration write; on the fallback path (no device
--   CallLog read → no await) the duration write fired first, saw the
--   row still at 'no_answer', and skipped. Result: the duration landed
--   in lead_activities only, call_logs stayed NULL → the TC console +
--   the 50-call count (which read call_logs) undercounted.
--   Live example: dr jagmal barad (I.G. Memorial), 6 Jun 14:01 —
--   activity 31s, call_log NULL.
--
-- THIS FILE heals the historical rows: copy the activity's real
-- duration onto the matching call_logs row where it's still NULL/0.
--
-- SAFETY
--   • Read-side surfaces only (TC console, 50-count). compute_daily_score
--     reads the ACTIVITY (already correct) — so NO incentive/pay change.
--   • Only fills NULL/0 call_logs durations; never overwrites a real one.
--   • Scoped to call_logs rows already at outcome connected/callback
--     (Phase 102.B intent preserved — never writes onto a no_answer row).
--   • call_logs dedup trigger (Phase 113.5) is BEFORE INSERT; the
--     calls-counter bump is on INSERT — neither fires on this UPDATE.
--   • Match key = same lead + same user + same IST-clock minute, which
--     is exactly the (lead,user,minute) pairing the modal wrote.
--   Idempotent — re-run only touches rows still NULL/0.
-- =====================================================================

UPDATE public.call_logs cl
   SET duration_seconds = a.duration_seconds
  FROM public.lead_activities a
 WHERE a.lead_id        = cl.lead_id
   AND a.created_by     = cl.user_id
   AND a.activity_type  = 'call'
   AND a.duration_seconds IS NOT NULL
   AND a.duration_seconds > 0
   AND date_trunc('minute', a.created_at) = date_trunc('minute', cl.call_at)
   AND (cl.duration_seconds IS NULL OR cl.duration_seconds = 0)
   AND cl.outcome IN ('connected', 'callback_requested');

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- After the heal: the count of connected/callback call_logs rows that
-- are still NULL/0 yet HAVE a real-duration matching activity should be
-- ZERO (everything reconcilable is reconciled).
SELECT count(*) AS still_unreconciled_should_be_zero
FROM public.call_logs cl
JOIN public.lead_activities a
  ON a.lead_id = cl.lead_id
 AND a.created_by = cl.user_id
 AND a.activity_type = 'call'
 AND a.duration_seconds > 0
 AND date_trunc('minute', a.created_at) = date_trunc('minute', cl.call_at)
WHERE (cl.duration_seconds IS NULL OR cl.duration_seconds = 0)
  AND cl.outcome IN ('connected', 'callback_requested');

SELECT 'Phase 120 call-duration reconcile backfill applied' AS status;
