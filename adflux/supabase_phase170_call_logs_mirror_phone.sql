-- supabase_phase170_call_logs_mirror_phone.sql
-- Phase 170 (2026-06-17) — call_logs MIRRORS THE PHONE CALL LOG. One row per
-- real call. The ONLY dedup is removing OUR OWN double-entry (the in-app tap
-- audit row vs the same call read by the device scan). Two REAL calls — even
-- to the same number/lead — are NEVER merged.
--
-- OWNER DECISION (17 Jun 2026, REVERSES the Phase 126 "a rep who re-called
-- counts once" rule): "mirror of call log — yes exactly." Rima's app showed
-- 234, her other CRM (which mirrors the phone) showed 243 — 9 MORE. The 9 were
-- her legitimate repeat-calls to the same lead, which Phase 126 (same-phone
-- 30-min merge) + Phase 166 (same-lead 5-min merge) collapsed. Those broad
-- merges are WRONG for a telecaller who calls a lead several times a session.
--
-- THE PRINCIPLE (single source of truth = the phone call log):
--   The device call log has each real call exactly once. The scan
--   (callHistoryIngest.js) reads it. The ONLY extra row we create is the
--   tel-tap audit (callAudit.js writes it the instant Call is pressed:
--   duration NULL, outcome 'no_answer', notes 'tel-tap audit%'). So the only
--   thing to dedup is: fold a call INTO an UNPATCHED tap-audit row (our own
--   placeholder for this same physical call). If there is no unpatched tap to
--   fold into, the row is a REAL call → INSERT it (mirror the phone).
--
--   • Tap then scan (same call): scan folds into the tap → 1 row. ✓
--   • Double-tap (ghost-click, same minute): 2nd tap folds into the 1st
--     unpatched tap → 1 row. ✓
--   • Cross-number same call (Vimal Oil: app ...121, device ...122): the JS
--     scan (Phase 167) folds by lead+time; this trigger also folds a tap by
--     lead within 5 min. → 1 row. ✓
--   • Two REAL repeat-calls to the same lead/number: neither folds into an
--     unpatched tap (the earlier one is already a real/patched row) → BOTH
--     insert. → matches the phone. ✓  (This is the 9 Rima was missing.)
--
-- This REPLACES the Phase 126 + 166 broad time-window merges. The §28 frozen
-- call chain: guardian-audited. Forward-looking — rows ALREADY merged by 126/
-- 166 can't be un-merged (deleted), but the next device-log scan re-ingests
-- and, under this rule, re-inserts the wrongly-merged repeat-calls.
--
-- §45 / no-slowdown: ONE scoped lookup per call_logs INSERT (user + tap +
-- window), uses idx_call_logs_user_at. call_logs writers destructure only
-- `error`; a BEFORE-trigger NULL is a silent skip. Idempotent (CREATE OR
-- REPLACE). Pairs with the JS scan reconcile (Phase 167) — same principle,
-- both fold the scan into the tap, neither merges two real calls.

-- -------------------------------------------------------------------------
-- call_logs_dedupe_before_insert REMOVED from this file (Phase 178).
-- Canonical: db/functions/call_logs_dedupe_before_insert.sql
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_call_logs_dedupe) stays below / in the phase files.
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_call_logs_dedupe ON public.call_logs;
CREATE TRIGGER trg_call_logs_dedupe
  BEFORE INSERT ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.call_logs_dedupe_before_insert();

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: trigger present.
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.call_logs'::regclass AND tgname = 'trg_call_logs_dedupe';

-- V2: the function no longer does a broad same-phone/lead time merge — it only
-- folds into an unpatched tap (expect t).
SELECT pg_get_functiondef('public.call_logs_dedupe_before_insert()'::regprocedure)
       ILIKE '%UNPATCHED%'  AS mirrors_phone;

-- V3 (today, after the next device scan): a telecaller's row count should
-- climb toward the phone's number as real repeat-calls re-insert. Spot a rep:
SELECT u.name, count(*) AS rows_today,
       count(*) FILTER (WHERE cl.duration_seconds >= 10) AS ge10s
  FROM public.call_logs cl JOIN public.users u ON u.id = cl.user_id
 WHERE (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date = current_date
 GROUP BY u.name ORDER BY rows_today DESC LIMIT 10;

SELECT 'Phase 170 call_logs mirror-phone dedup applied' AS status;
