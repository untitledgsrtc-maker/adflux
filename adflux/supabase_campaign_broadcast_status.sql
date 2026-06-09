-- =====================================================================
-- Campaign — broadcast delivery-status index (for the funnel)
-- 2026-06-09
--
-- The webhook now captures Meta delivery-status callbacks (sent → delivered →
-- read / failed) and matches them to a broadcast recipient by wamid. This index
-- makes that per-callback UPDATE cheap on a growing broadcast_recipients table.
--
-- SAFE (§45): one index on a NEW campaign table. Idempotent. No live-app touch.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_bcast_recip_wamid
  ON public.broadcast_recipients (wamid) WHERE wamid IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT count(*) AS wamid_index_present
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'broadcast_recipients'
   AND indexname = 'idx_bcast_recip_wamid';   -- 1

SELECT 'Campaign broadcast wamid index applied' AS status;
