-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 103.A.1 SQL
-- One-open-row-per-user dedup for gps_off_events + network_off_events
-- 2026-05-31 (Brijesh Solanki)
-- =====================================================================
--
-- WHY (permanent dedup, not a patch):
--   Android fires LocationManager.MODE_CHANGED_ACTION 2-3x per single
--   Location toggle (gps provider + network provider + OEM extras).
--   Each broadcast → handleGpsStateChanged(off) → insertGpsOff → a NEW
--   row. Result: one GPS-off shows as 2-3 "GPS TURNED OFF" entries on
--   the admin activity timeline (owner screenshot 2026-05-31: 3 rows
--   at 02:26, 2 at 01:31, all healed to "back at 02:33").
--   network_off_events has the same multi-fire risk on flaky links.
--
--   The 102.L.1 ping trigger already closes leaked rows; the pill
--   reads ping-freshness so it's unaffected. This file stops the
--   DUPLICATE INSERTS at the source so the timeline + audit log show
--   exactly one row per off-period.
--
-- WHAT THIS DOES (idempotent):
--   STEP 1 — heal any currently-open rows that have a later ping
--            (re-run of 102.L logic) so STEP 2's unique index can be
--            built without collisions.
--   STEP 2 — collapse any remaining MULTIPLE open rows per user down
--            to ONE (keep earliest toggled_off_at, close the rest at
--            their own off-time so duration=0). Required because a
--            partial UNIQUE index cannot be created while >1 open row
--            per user exists.
--   STEP 3 — partial unique index: at most ONE open row per user on
--            each table. Future duplicate inserts hit 23505, which the
--            Phase 103.A.1 JS (insertGpsOff/insertNetOff) swallows as a
--            no-op.
--
-- PAIRED JS (already committed): nativeTracking.js insertGpsOff +
--   insertNetOff treat error.code==='23505' as "already open" — no
--   enqueue, no error. Index + JS together = exactly one open row.
--
-- WHAT THIS DOES NOT TOUCH:
--   - daily_ta / payout (gps_off_events not joined by compute_daily_ta)
--   - the 102.L.1 heal trigger (complementary — it closes; this
--     prevents dup opens)
--   - force_stop_events (single-fire on launch, no dup risk)
--   - RLS policies on either table
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — heal open rows that already have a later ping (102.L logic)
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE v_healed int;
BEGIN
  UPDATE public.gps_off_events g
     SET toggled_on_at = sub.first_ping_after
    FROM (
      SELECT g2.id,
             (SELECT min(p.captured_at) FROM public.gps_pings p
               WHERE p.user_id = g2.user_id AND p.captured_at > g2.toggled_off_at) AS first_ping_after
        FROM public.gps_off_events g2
       WHERE g2.toggled_on_at IS NULL
    ) sub
   WHERE g.id = sub.id AND sub.first_ping_after IS NOT NULL;
  GET DIAGNOSTICS v_healed = ROW_COUNT;
  RAISE NOTICE '[103.A.1] STEP1 healed % gps_off rows via later ping', v_healed;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — collapse multiple open rows per user to ONE (both tables)
-- ─────────────────────────────────────────────────────────────────────
-- Keep the EARLIEST open row per user; close the rest at their own
-- toggled_off_at / lost_at (duration 0). Lets the unique index build.

-- gps_off_events
DO $$
DECLARE v_collapsed int;
BEGIN
  WITH ranked AS (
    SELECT id, user_id, toggled_off_at,
           ROW_NUMBER() OVER (PARTITION BY user_id
                              ORDER BY toggled_off_at ASC, id ASC) AS rn
      FROM public.gps_off_events
     WHERE toggled_on_at IS NULL
  )
  UPDATE public.gps_off_events g
     SET toggled_on_at = g.toggled_off_at
    FROM ranked r
   WHERE g.id = r.id AND r.rn > 1;
  GET DIAGNOSTICS v_collapsed = ROW_COUNT;
  RAISE NOTICE '[103.A.1] STEP2 collapsed % duplicate-open gps_off rows', v_collapsed;
END $$;

-- network_off_events
DO $$
DECLARE v_collapsed int;
BEGIN
  WITH ranked AS (
    SELECT id, user_id, lost_at,
           ROW_NUMBER() OVER (PARTITION BY user_id
                              ORDER BY lost_at ASC, id ASC) AS rn
      FROM public.network_off_events
     WHERE regained_at IS NULL
  )
  UPDATE public.network_off_events n
     SET regained_at = n.lost_at
    FROM ranked r
   WHERE n.id = r.id AND r.rn > 1;
  GET DIAGNOSTICS v_collapsed = ROW_COUNT;
  RAISE NOTICE '[103.A.1] STEP2 collapsed % duplicate-open net_off rows', v_collapsed;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — partial unique indexes: one open row per user, per table
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_gps_off_per_user
  ON public.gps_off_events (user_id)
  WHERE toggled_on_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_net_off_per_user
  ON public.network_off_events (user_id)
  WHERE regained_at IS NULL;


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY
-- =====================================================================
--
-- V1: at most ONE open row per user on each table (both = 0)
--   SELECT 'gps' AS tbl, count(*) FROM (
--     SELECT user_id FROM public.gps_off_events WHERE toggled_on_at IS NULL
--      GROUP BY user_id HAVING count(*) > 1) x
--   UNION ALL
--   SELECT 'net', count(*) FROM (
--     SELECT user_id FROM public.network_off_events WHERE regained_at IS NULL
--      GROUP BY user_id HAVING count(*) > 1) y;
--   Expected: both 0.
--
-- V2: indexes present
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public'
--      AND indexname IN ('uniq_open_gps_off_per_user','uniq_open_net_off_per_user');
--   Expected: 2 rows.
--
-- V3 (live, after a rep toggles Location): one GPS-off → ONE row, not 3.
--   SELECT user_id, count(*) FROM public.gps_off_events
--    WHERE toggled_off_at > now() - interval '10 minutes'
--    GROUP BY user_id;
--
-- =====================================================================
-- ROLLBACK
-- =====================================================================
--   DROP INDEX IF EXISTS public.uniq_open_gps_off_per_user;
--   DROP INDEX IF EXISTS public.uniq_open_net_off_per_user;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
