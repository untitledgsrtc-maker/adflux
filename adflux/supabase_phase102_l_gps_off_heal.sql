-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 102.L SQL
-- One-time heal of leaked open gps_off_events rows
-- 2026-05-31 (Brijesh Solanki)
-- =====================================================================
--
-- WHY:
--   Phase 102.H close-event path (handleGpsStateChanged on→off→on)
--   leaks when the app is backgrounded: the MODE_CHANGED off→on
--   broadcast is missed, so toggled_on_at never gets set. Confirmed
--   live: Dixita (caa6236a-844b-4097-8d93-f71d9b28ffae) had 3 open
--   rows from 23 May while pinging 31 May. The admin TeamDashboard
--   GPS pill (pre-102.L boolean veto) stayed RED for 8 days.
--
--   Phase 102.L JS fix makes the pill trust a ping NEWER than the
--   off-event (ping proves GPS is back). This SQL closes the existing
--   leaked rows so the historical noise clears AND the gps_off_events
--   activity timeline (GpsTrackV2) stops showing week-old "still off"
--   entries.
--
-- WHAT THIS DOES (idempotent, re-runnable):
--   Closes any open row (toggled_on_at IS NULL) that has a gps_ping
--   AFTER its toggled_off_at. The ping is ground truth: GPS was on
--   to capture it, so the device is not off. Sets toggled_on_at to
--   the FIRST ping after the off-event (the moment GPS returned), so
--   the auto-computed duration_seconds (Phase 76.1 trigger) reflects
--   the real off-window, not "off until now".
--
-- WHAT THIS DOES NOT TOUCH:
--   - Open rows with NO subsequent ping (genuinely still off / never
--     came back) — left open, correct.
--   - daily_ta / compute_daily_ta — payout untouched.
--   - gps_pings, work_sessions, any other table.
--   - The Phase 76.1 duration trigger — it fires on this UPDATE and
--     fills duration_seconds automatically.
--
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- (1) Probe FIRST — count how many leaked rows will heal (read-only)
-- ─────────────────────────────────────────────────────────────────────
-- Paste this block alone first. Confirm the count looks sane before
-- running the UPDATE below.
--
--   SELECT count(*) AS leaked_rows_to_heal
--     FROM public.gps_off_events g
--    WHERE g.toggled_on_at IS NULL
--      AND EXISTS (
--        SELECT 1 FROM public.gps_pings p
--         WHERE p.user_id = g.user_id
--           AND p.captured_at > g.toggled_off_at
--      );


-- ─────────────────────────────────────────────────────────────────────
-- (2) Heal — close leaked rows at the first ping after the off-event
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_healed int;
BEGIN
  UPDATE public.gps_off_events g
     SET toggled_on_at = sub.first_ping_after
    FROM (
      SELECT g2.id,
             (SELECT min(p.captured_at)
                FROM public.gps_pings p
               WHERE p.user_id = g2.user_id
                 AND p.captured_at > g2.toggled_off_at) AS first_ping_after
        FROM public.gps_off_events g2
       WHERE g2.toggled_on_at IS NULL
    ) sub
   WHERE g.id = sub.id
     AND sub.first_ping_after IS NOT NULL;
  GET DIAGNOSTICS v_healed = ROW_COUNT;
  RAISE NOTICE '[Phase 102.L] healed % leaked gps_off_events rows', v_healed;
END $$;


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY (paste after running the heal)
-- =====================================================================
--
-- V1: remaining open rows should ONLY be genuinely-still-off
--     (no ping after their toggled_off_at).
--   SELECT count(*) AS still_open_no_later_ping
--     FROM public.gps_off_events g
--    WHERE g.toggled_on_at IS NULL
--      AND NOT EXISTS (
--        SELECT 1 FROM public.gps_pings p
--         WHERE p.user_id = g.user_id
--           AND p.captured_at > g.toggled_off_at
--      );
--   (This is the legitimate set — reps currently off with no movement.)
--
-- V2: Dixita's rows should now be closed.
--   SELECT id, toggled_off_at, toggled_on_at, duration_seconds
--     FROM public.gps_off_events
--    WHERE user_id='caa6236a-844b-4097-8d93-f71d9b28ffae'::uuid
--    ORDER BY toggled_off_at DESC LIMIT 5;
--   Expected: the 3 old rows now have toggled_on_at + duration_seconds.
--
-- =====================================================================
-- NOTE — this is a HEAL, not a prevention. The close-event LEAK
-- itself (backgrounded app misses MODE_CHANGED on→on) is the deeper
-- Phase 76.2 background-GPS reliability problem. Phase 102.L JS makes
-- the pill self-heal at read-time (ping-newer-than-off-event), so even
-- if rows leak again the admin pill stays correct. This SQL is a
-- one-time cleanup of the backlog + can be re-run anytime to clear
-- newly-leaked rows.
-- =====================================================================
