-- =====================================================================
-- Phase 93.25 — call_logs phone normalize + duplicate cleanup
-- 26 May 2026
--
-- WHY
--
-- Owner reported (2026-05-26 evening): /telecaller call history shows
-- the same call twice for many entries. Audit found:
--   • callAudit.js wrote client_phone in raw lead.phone format
--     (e.g. "+919879018219" or "+91 98 7901 8219").
--   • callHistoryIngest.js dedup query: .eq('client_phone', cleaned)
--     where cleaned = last 10 digits ("9879018219").
--   • The exact-match dedup missed the audit row → ingest inserted a
--     fresh duplicate row for every call across the entire 35-day
--     audit-row history.
--
-- Phase 93.2c (24 May) was about missed+connected constraint, NOT
-- dedup. Dupes were never actually resolved.
--
-- Phase 93.25 JS fix (callAudit.cleanPhoneForAudit) blocks NEW dupes.
-- This SQL cleans up the historical mess.
--
-- WHAT
--
-- 1. Normalize all client_phone values to the same 10-digit form
--    (strip non-digits, slice last 10). Matches the cleanPhone
--    helper in callHistoryIngest.js + callAudit.js.
--
-- 2. Delete duplicate rows: group by (user_id, client_phone, 60-second
--    time bucket); keep the row with the longest duration_seconds
--    (audit rows have 0s; ingest rows have real values, so the real
--    one wins). Tie-break on smallest id (older row).
--
-- 3. Add a partial unique index to prevent future regressions at the
--    DB level. Indexes (user_id, client_phone, call_at-rounded-minute)
--    where client_phone IS NOT NULL.
--
-- Idempotent. Re-runnable.
-- =====================================================================

-- ─── 1. Normalize client_phone to 10 digits ──────────────────────────
DO $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.call_logs
     SET client_phone = RIGHT(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g'), 10)
   WHERE client_phone IS NOT NULL
     AND (
       client_phone ~ '[^0-9]'                                              -- has non-digits
       OR LENGTH(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g')) > 10      -- longer than 10 digits
     );
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '[Phase 93.25] normalized % call_logs phone rows', v_updated;
END $$;


-- ─── 2. Delete duplicates ────────────────────────────────────────────
-- Group rows into 60-second buckets per (user_id, client_phone). Keep
-- the row with the longest duration_seconds; tie-break on smallest id.
-- DELETE the rest.
DO $$
DECLARE
  v_deleted int;
BEGIN
  WITH dupes AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY
               user_id,
               client_phone,
               ROUND(EXTRACT(EPOCH FROM call_at) / 60)
             ORDER BY
               -- Prefer rows with REAL durations over the 0s tel-tap
               -- audit insert.
               (duration_seconds IS NOT NULL AND duration_seconds > 0) DESC,
               duration_seconds DESC NULLS LAST,
               id ASC
           ) AS rn
      FROM public.call_logs
     WHERE client_phone IS NOT NULL
  )
  DELETE FROM public.call_logs
   WHERE id IN (SELECT id FROM dupes WHERE rn > 1);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE '[Phase 93.25] deleted % duplicate call_logs rows', v_deleted;
END $$;


-- ─── 3. Prevent future regressions ───────────────────────────────────
-- Partial unique index on (user_id, client_phone, call_at-rounded-
-- to-minute) where client_phone IS NOT NULL. Catches any future
-- duplicate insert at the DB level even if the JS-side dedup misses.
--
-- Indexed expression must be IMMUTABLE; date_trunc('minute', ...) IS
-- IMMUTABLE so this is index-safe.
DROP INDEX IF EXISTS call_logs_user_phone_minute_uq;
CREATE UNIQUE INDEX call_logs_user_phone_minute_uq
  ON public.call_logs (
    user_id,
    client_phone,
    DATE_TRUNC('minute', call_at)
  )
  WHERE client_phone IS NOT NULL;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  -- All phones should be exactly 10 digits (or NULL).
  (SELECT count(*) FROM public.call_logs
    WHERE client_phone IS NOT NULL
      AND (LENGTH(client_phone) <> 10 OR client_phone ~ '[^0-9]'))
    AS phones_not_10_digits_should_be_zero,
  -- Same-bucket duplicates after dedup should be zero.
  (SELECT count(*) FROM (
     SELECT user_id, client_phone, DATE_TRUNC('minute', call_at), count(*) AS n
       FROM public.call_logs
      WHERE client_phone IS NOT NULL
      GROUP BY 1, 2, 3
     HAVING count(*) > 1
   ) dup_check)
    AS remaining_per_minute_dupes_should_be_zero,
  -- New unique index installed.
  (SELECT count(*) FROM pg_indexes
    WHERE indexname = 'call_logs_user_phone_minute_uq')
    AS unique_index_present,
  -- Total call_logs surviving (for owner reference).
  (SELECT count(*) FROM public.call_logs)
    AS total_call_logs_after_cleanup;
