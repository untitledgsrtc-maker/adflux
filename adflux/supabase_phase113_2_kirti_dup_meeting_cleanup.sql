-- supabase_phase113_2_kirti_dup_meeting_cleanup.sql
-- Phase 113.2 (2026-06-05) — DATA HEAL, ALREADY EXECUTED. One real field
-- meeting (kirti kotak -> KN University / Adarsh, 5 Jun 12:23 IST) became
-- FIVE leads + five meetings because LogMeetingModal.handleSave fired 5x
-- within 84ms (WebView ghost-clicks slipped past the React `saving` STATE
-- guard). The frontend fix (Phase 113.2, LogMeetingModal savingRef latch)
-- STOPS new bursts. This file HEALED the existing 5.
--
-- ⚠ KEEPER FLIPPED AT RUNTIME — read-first paid off. The plan was to keep
-- the OLDEST lead and drop the other 4. But Section 0 revealed one of the
-- "duplicates", e574f3dc, had been WORKED after creation: stage=QuoteSent,
-- 1 quote, 4 follow-ups. So e574f3dc is the real lead — KEEP IT, not the
-- oldest. (The original draft of this file would have stripped e574f3dc's
-- meeting + follow-ups — caught by running Section 0 before Section 1.
-- Lesson: a "duplicate" can grow real work; never blind-delete by age.)
--
--   KEEP : e574f3dc-85f6-4570-bdd4-0b897f1f226a   (QuoteSent, 1 quote, 4 FU)
--   DROP : 63793fdb-c2fc-439a-b0c6-37084f12bee1   (Working, 0 quotes)
--          28e34c0b-f6d4-4801-ab07-6c1331df4a40   (Working, 0 quotes)
--          50d78875-d766-44df-b288-1f290caf1267   (Working, 0 quotes)
--          18a8b9f8-3081-46bd-9d76-61b238767fc1   (Working, 0 quotes)
--
-- Outcome (verified 5 Jun): KN University = 1 lead (e574f3dc) + 1 meeting.
-- The meeting COUNTER (daily_counters.meetings) self-heals via the Phase
-- 103.E.1 delete trigger. kirti's TODAY score recomputes on her next
-- call/meeting (the AFTER-INSERT score trigger fires) — compute_daily_score
-- can't be called from the SQL editor (its _assert_self_or_admin gate
-- needs a JWT).
--
-- Idempotent: re-running deletes 0 rows (the 4 DROP leads are already gone)
-- and CANNOT touch e574f3dc (it is not in any DROP list).

-- ════════════════════════════════════════════════════════════════════
-- SECTION 0 — READ-ONLY. Showed only e574f3dc carries a quote; the other
-- four were 0-quote / 1-activity / 1-follow-up → safe to delete.
-- ════════════════════════════════════════════════════════════════════
SELECT l.id, l.stage, l.created_at,
  (SELECT COUNT(*) FROM lead_activities la WHERE la.lead_id = l.id) AS activities,
  (SELECT COUNT(*) FROM follow_ups fu       WHERE fu.lead_id = l.id) AS follow_ups,
  (SELECT COUNT(*) FROM quotes q            WHERE q.lead_id  = l.id) AS quotes
FROM leads l
WHERE l.id IN (
  '63793fdb-c2fc-439a-b0c6-37084f12bee1',
  '28e34c0b-f6d4-4801-ab07-6c1331df4a40',
  '50d78875-d766-44df-b288-1f290caf1267',
  '18a8b9f8-3081-46bd-9d76-61b238767fc1',
  'e574f3dc-85f6-4570-bdd4-0b897f1f226a'
)
ORDER BY l.created_at;


-- ════════════════════════════════════════════════════════════════════
-- SECTION 1 — THE HEAL (EXECUTED 5 Jun). Drops the 4 zero-quote dups,
-- keeps e574f3dc. Children first so it works regardless of FK mode; the
-- leads delete is guarded by NOT EXISTS quote as a final safety net.
-- ════════════════════════════════════════════════════════════════════
BEGIN;

DELETE FROM lead_activities
 WHERE lead_id IN (
   '63793fdb-c2fc-439a-b0c6-37084f12bee1',
   '28e34c0b-f6d4-4801-ab07-6c1331df4a40',
   '50d78875-d766-44df-b288-1f290caf1267',
   '18a8b9f8-3081-46bd-9d76-61b238767fc1'
 );

DELETE FROM follow_ups
 WHERE lead_id IN (
   '63793fdb-c2fc-439a-b0c6-37084f12bee1',
   '28e34c0b-f6d4-4801-ab07-6c1331df4a40',
   '50d78875-d766-44df-b288-1f290caf1267',
   '18a8b9f8-3081-46bd-9d76-61b238767fc1'
 );

DELETE FROM leads l
 WHERE l.id IN (
   '63793fdb-c2fc-439a-b0c6-37084f12bee1',
   '28e34c0b-f6d4-4801-ab07-6c1331df4a40',
   '50d78875-d766-44df-b288-1f290caf1267',
   '18a8b9f8-3081-46bd-9d76-61b238767fc1'
 )
 AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.lead_id = l.id);

COMMIT;


-- ════════════════════════════════════════════════════════════════════
-- SECTION 2 — VERIFY (returned 1/1). KN University = 1 lead + 1 meeting.
-- ════════════════════════════════════════════════════════════════════
SELECT
  (SELECT COUNT(*) FROM leads WHERE company ILIKE '%KN Univ%') AS kn_leads,
  (SELECT COUNT(*) FROM lead_activities la JOIN leads l ON l.id = la.lead_id
     WHERE la.activity_type = 'meeting' AND l.company ILIKE '%KN Univ%'
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = '2026-06-05') AS kn_meetings_today;


-- ════════════════════════════════════════════════════════════════════
-- SECTION 3 — READ-ONLY SCAN. Any OTHER ghost-click bursts across ALL reps
-- (same rep + same phone + same IST minute → >1 Field-Meeting lead) in the
-- last 30 days. The Phase 113.2 frontend latch stops future ones; any rows
-- here are pre-fix and can be healed with the same Section-1 pattern.
-- ════════════════════════════════════════════════════════════════════
SELECT
  u.name AS rep,
  l.phone,
  l.company,
  date_trunc('minute', (l.created_at AT TIME ZONE 'Asia/Kolkata')) AS minute_ist,
  COUNT(*)        AS dup_leads,
  array_agg(l.id) AS lead_ids
FROM leads l
JOIN users u ON u.id = l.created_by
WHERE l.source = 'Field Meeting'
  AND l.created_at >= (now() - INTERVAL '30 days')
GROUP BY u.name, l.phone, l.company,
         date_trunc('minute', (l.created_at AT TIME ZONE 'Asia/Kolkata'))
HAVING COUNT(*) > 1
ORDER BY dup_leads DESC, minute_ist DESC;
