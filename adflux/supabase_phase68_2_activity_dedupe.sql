-- supabase_phase68_2_activity_dedupe.sql
-- Phase 68.2 (21 May 2026) — one-shot dedupe of lead_activities +
-- partial unique index to block future duplicates.
--
-- Owner finding (21 May 2026): activity timeline shows the same
-- meeting / WhatsApp logged twice within the same minute.
-- Two root causes:
--   1. WhatsAppSendModal Send button — rapid double-tap fired
--      two INSERTs (state-flip too slow to disable the button).
--      Fixed in src/components/leads/WhatsAppSendModal.jsx via
--      a useRef sync guard (Phase 68.2 frontend change).
--   2. LeadDetailV2 "I'm here" auto-checkin — fixed in Phase 65
--      via savingHereRef. Historical rows from before that
--      deploy already sit in the DB and need cleanup here.
--
-- This SQL does TWO things:
--
-- A. CLEANUP. For every (lead_id, created_by, activity_type,
--    notes) combo where >1 row exists within a 2-minute window,
--    keep the OLDEST and delete the rest. Last 30 days only —
--    historical data older than that isn't worth disturbing.
--
-- B. PARTIAL UNIQUE INDEX on date-truncated key so future
--    rapid duplicates fail at the DB level rather than relying
--    on frontend guards alone. The index uses date_trunc to
--    the minute so two inserts within the same minute with
--    identical (lead, user, type, notes) hit a unique violation.
--    Frontend wraps INSERTs in try/catch already → no rep-side
--    crash.
--
-- Idempotent. Index is CREATE IF NOT EXISTS. Cleanup CTE is a
-- pure DELETE.

-- ─── A. Cleanup historical duplicates ────────────────────────────
DO $$
DECLARE
  v_deleted int := 0;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          lead_id,
          created_by,
          activity_type,
          COALESCE(notes, ''),
          date_trunc('minute', created_at)
        ORDER BY created_at ASC
      ) AS rn
    FROM public.lead_activities
    WHERE created_at >= (now() - INTERVAL '30 days')
  )
  DELETE FROM public.lead_activities
  WHERE id IN (
    SELECT id FROM ranked WHERE rn > 1
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Phase 68.2 dedupe: removed % duplicate lead_activities rows', v_deleted;
END $$;

-- ─── B. Partial unique index to block future dupes ───────────────
-- date_trunc('minute', created_at) — two inserts within the same
-- minute with identical key conflict. Different rep / different
-- lead / different note / different type / different minute all
-- pass through. This is intentionally permissive: a rep CAN log
-- two manual meetings on the same lead with the same note 90s
-- apart — they just both can't land at HH:MM:00–HH:MM:59 with
-- identical text.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_activities_dedupe_min
  ON public.lead_activities (
    lead_id,
    created_by,
    activity_type,
    (date_trunc('minute', created_at)),
    md5(COALESCE(notes, ''))
  );

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
-- Look for any (lead, user, type, minute, notes) combo that still
-- has >1 row in the last 30 days. Should return 0 rows.
SELECT
  lead_id, created_by, activity_type,
  date_trunc('minute', created_at) AS minute_bucket,
  LEFT(COALESCE(notes, ''), 40) AS notes_preview,
  COUNT(*) AS dup_count
FROM public.lead_activities
WHERE created_at >= (now() - INTERVAL '30 days')
GROUP BY 1, 2, 3, 4, 5
HAVING COUNT(*) > 1
ORDER BY dup_count DESC
LIMIT 20;

SELECT 'Phase 68.2 dedupe + unique index ready' AS status;
