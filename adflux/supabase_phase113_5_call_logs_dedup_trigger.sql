-- supabase_phase113_5_call_logs_dedup_trigger.sql
-- Phase 113.5 (2026-06-05) — duplicate call_logs rows (Rima: same number,
-- same duration logged twice — "Riya 1m28s ×2", "17s ×2", "3m6s ×2").
--
-- ROOT CAUSE: call_logs has NO uniqueness guard. A real one was deliberately
-- DROPPED (Phase 93.25.2) because the minute-bucket expression used STABLE
-- functions, which Postgres rejects in an index expression (ERROR 42P17).
-- Dedup has been 100% application-side (the scan's 60s SELECT-then-INSERT),
-- which races: two scans (setInterval + visibilitychange) fire together, both
-- SELECT (no row yet), both INSERT → identical duplicate.
--
-- THE FIX (avoids the 42P17 blocker entirely): a BEFORE INSERT TRIGGER, not
-- an index. A trigger body CAN use STABLE functions (date_trunc on
-- timestamptz). It skips an insert ONLY when an EXACT duplicate already
-- exists — same user + phone + direction + duration + same IST minute. This:
--   • kills scan-vs-scan races (identical rows) and ghost-click tap dups,
--   • does NOT touch audit-vs-scan reconciliation: the tel-tap audit row
--     (duration NULL, no_answer) and the scan row (duration N, connected)
--     differ on duration/direction → NOT deduped → both kept, so the real
--     call still gets its duration. Only byte-identical rows collapse.
--
-- The frontend latch (Phase 113.5, quickLogCall in TelecallerV2 + WorkV2)
-- stops the ghost-click at the source; lead_activities 'call' dups are
-- already blocked by Phase 68.2's uniq_lead_activities_dedupe_min. This
-- closes the remaining call_logs hole — the scan-race.
--
-- §45: the trigger runs one indexed EXISTS (idx_call_logs_user_at) per
-- call_logs INSERT — negligible, and call_logs inserts are fire-and-forget /
-- batch, never on a blocking rep path. No app-writer change needed (the
-- writers don't read the returned row; a silent skip is fine). Idempotent.

-- ── 1. One-time cleanup: collapse existing exact-duplicate rows ──────
-- Keep the OLDEST of each identical group. Last 30 days only.
DO $cleanup$
DECLARE
  v_deleted int := 0;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          user_id,
          COALESCE(client_phone, ''),
          COALESCE(direction, ''),
          COALESCE(duration_seconds, -1),
          date_trunc('minute', call_at)
        ORDER BY call_at ASC, id ASC
      ) AS rn
    FROM public.call_logs
    WHERE call_at >= (now() - INTERVAL '30 days')
  )
  DELETE FROM public.call_logs
   WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Phase 113.5: removed % exact-duplicate call_logs rows', v_deleted;
END
$cleanup$;

-- ── 2. BEFORE INSERT dedup trigger (skips exact duplicates) ─────────
CREATE OR REPLACE FUNCTION public.call_logs_dedupe_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.call_logs cl
     WHERE cl.user_id          = NEW.user_id
       AND cl.client_phone     IS NOT DISTINCT FROM NEW.client_phone
       AND cl.direction        IS NOT DISTINCT FROM NEW.direction
       AND cl.duration_seconds IS NOT DISTINCT FROM NEW.duration_seconds
       AND date_trunc('minute', cl.call_at) = date_trunc('minute', NEW.call_at)
  ) THEN
    RETURN NULL;  -- exact duplicate in the same minute — skip the insert
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_call_logs_dedupe ON public.call_logs;
CREATE TRIGGER trg_call_logs_dedupe
  BEFORE INSERT ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.call_logs_dedupe_before_insert();

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: trigger exists (expect one row).
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.call_logs'::regclass
   AND tgname  = 'trg_call_logs_dedupe';

-- V2: no remaining exact duplicates in the last 30 days (expect 0 rows).
SELECT user_id, client_phone, direction, duration_seconds,
       date_trunc('minute', call_at) AS minute_bucket, COUNT(*) AS dupes
  FROM public.call_logs
 WHERE call_at >= (now() - INTERVAL '30 days')
 GROUP BY 1, 2, 3, 4, 5
HAVING COUNT(*) > 1
 ORDER BY dupes DESC
 LIMIT 10;

-- V3 (manual smoke): insert two identical call_logs rows in the same minute
-- → only the first lands; the second is silently skipped. A row with a
-- different duration (the real call vs the 0s tap audit) still inserts.
