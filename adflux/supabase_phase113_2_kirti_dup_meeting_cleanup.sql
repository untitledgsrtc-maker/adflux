-- supabase_phase113_2_kirti_dup_meeting_cleanup.sql
-- Phase 113.2 (2026-06-05) — DATA HEAL. One real field meeting (kirti
-- kotak → KN University / Adarsh, 5 Jun 12:23 IST) was logged as FIVE
-- separate leads + five meetings because LogMeetingModal.handleSave
-- fired 5x within 84ms (WebView ghost-clicks slipped past the React
-- `saving` STATE guard). The frontend fix (Phase 113.2, LogMeetingModal
-- savingRef latch) STOPS new bursts. This file HEALS the existing 5.
--
-- The 5 duplicate leads (all KN University / Adarsh, 12:23:31 IST):
--   KEEP : 18a8b9f8-3081-46bd-9d76-61b238767fc1   (.097 — oldest)
--   DROP : 28e34c0b-f6d4-4801-ab07-6c1331df4a40   (.132)
--          63793fdb-c2fc-439a-b0c6-37084f12bee1   (.135)
--          e574f3dc-85f6-4570-bdd4-0b897f1f226a   (.164)
--          50d78875-d766-44df-b288-1f290caf1267   (.181)
--
-- After the heal: 1 KN University lead + 1 meeting. The meeting COUNTER
-- (daily_counters.meetings) self-heals via the Phase 103.E.1 delete
-- trigger when the 4 meeting rows are removed. kirti's TODAY score
-- recomputes automatically the next time she logs ANY call/meeting (the
-- AFTER-INSERT score trigger fires) — no manual recompute needed (and
-- compute_daily_score can't be called from the SQL editor anyway, its
-- _assert_self_or_admin gate requires a JWT).
--
-- ⚠ RUN SECTION 0 FIRST. Only run Section 1 if Section 0 shows
--   quotes=0 AND payments=0 on all four DROP ids. (They're 84ms-old
--   field-meeting leads, so they should have none — but verify.)

-- ════════════════════════════════════════════════════════════════════
-- SECTION 0 — READ-ONLY. Prove the 4 DROP leads are safe to delete.
-- Expect: 1 meeting each, maybe 1 auto follow-up each, 0 quotes,
-- 0 payments. If any row shows quotes>0 or payments>0, STOP and tell
-- Claude — do not run Section 1.
-- ════════════════════════════════════════════════════════════════════
SELECT
  l.id,
  l.name        AS contact,
  l.company,
  l.stage,
  (SELECT COUNT(*) FROM lead_activities la WHERE la.lead_id = l.id) AS activities,
  (SELECT COUNT(*) FROM follow_ups fu       WHERE fu.lead_id = l.id) AS follow_ups,
  (SELECT COUNT(*) FROM quotes q            WHERE q.lead_id  = l.id) AS quotes,
  (SELECT COUNT(*) FROM payments p JOIN quotes q ON q.id = p.quote_id
     WHERE q.lead_id = l.id)                                        AS payments
FROM leads l
WHERE l.id IN (
  '28e34c0b-f6d4-4801-ab07-6c1331df4a40',
  '63793fdb-c2fc-439a-b0c6-37084f12bee1',
  'e574f3dc-85f6-4570-bdd4-0b897f1f226a',
  '50d78875-d766-44df-b288-1f290caf1267'
)
ORDER BY l.created_at;


-- ════════════════════════════════════════════════════════════════════
-- SECTION 1 — THE HEAL. Run ONLY after Section 0 confirms 0 quotes +
-- 0 payments on all four. Children deleted first so the heal works
-- regardless of FK delete mode; wrapped in a transaction. Keeps
-- 18a8b9f8 (the oldest) + its one meeting untouched.
-- ════════════════════════════════════════════════════════════════════
BEGIN;

DELETE FROM lead_activities
 WHERE lead_id IN (
   '28e34c0b-f6d4-4801-ab07-6c1331df4a40',
   '63793fdb-c2fc-439a-b0c6-37084f12bee1',
   'e574f3dc-85f6-4570-bdd4-0b897f1f226a',
   '50d78875-d766-44df-b288-1f290caf1267'
 );

DELETE FROM follow_ups
 WHERE lead_id IN (
   '28e34c0b-f6d4-4801-ab07-6c1331df4a40',
   '63793fdb-c2fc-439a-b0c6-37084f12bee1',
   'e574f3dc-85f6-4570-bdd4-0b897f1f226a',
   '50d78875-d766-44df-b288-1f290caf1267'
 );

-- Safety: never delete a lead that somehow carries a quote.
DELETE FROM leads l
 WHERE l.id IN (
   '28e34c0b-f6d4-4801-ab07-6c1331df4a40',
   '63793fdb-c2fc-439a-b0c6-37084f12bee1',
   'e574f3dc-85f6-4570-bdd4-0b897f1f226a',
   '50d78875-d766-44df-b288-1f290caf1267'
 )
 AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.lead_id = l.id);

COMMIT;


-- ════════════════════════════════════════════════════════════════════
-- SECTION 2 — VERIFY. Expect exactly ONE KN University meeting for
-- kirti on 5 Jun (lead 18a8b9f8), and the 4 DROP leads gone.
-- ════════════════════════════════════════════════════════════════════
SELECT la.id, la.lead_id, l.company, l.name AS contact, la.notes,
       (la.created_at AT TIME ZONE 'Asia/Kolkata') AS ist_time
FROM lead_activities la
JOIN users u ON u.id = la.created_by
LEFT JOIN leads l ON l.id = la.lead_id
WHERE u.name ILIKE 'kirti%'
  AND la.activity_type = 'meeting'
  AND l.company ILIKE '%KN Univ%'
  AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = '2026-06-05'
ORDER BY la.created_at;

-- Confirm the 4 DROP leads no longer exist (expect 0 rows).
SELECT id FROM leads WHERE id IN (
  '28e34c0b-f6d4-4801-ab07-6c1331df4a40',
  '63793fdb-c2fc-439a-b0c6-37084f12bee1',
  'e574f3dc-85f6-4570-bdd4-0b897f1f226a',
  '50d78875-d766-44df-b288-1f290caf1267'
);


-- ════════════════════════════════════════════════════════════════════
-- SECTION 3 — READ-ONLY SCAN. Find any OTHER ghost-click bursts across
-- ALL reps (same rep + same phone + same IST minute → >1 Field-Meeting
-- lead) in the last 30 days, so you know if kirti was the only one. The
-- Phase 113.2 frontend latch stops future ones; if this returns rows,
-- they're pre-fix and can be healed with the same Section-1 pattern.
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
