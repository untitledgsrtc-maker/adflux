-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 102.L.1 SQL
-- Auto-heal leaked gps_off_events on every ping (permanent, server-side)
-- 2026-05-31 (Brijesh Solanki)
-- =====================================================================
--
-- WHY (permanent fix, not a patch):
--   Phase 102.L made the admin GPS pill self-heal at READ time (a ping
--   newer than an open off-event = GPS back). That fixed the symptom.
--   This trigger fixes the SOURCE: when a ping arrives, GPS is provably
--   on, so any still-open gps_off_events row for that user older than
--   the ping is closed automatically — server-side, instantly, forever.
--   No cron, no manual re-run, no patch chain (§3).
--
--   Close-events leak because a backgrounded app misses the
--   MODE_CHANGED off→on broadcast (the deeper capture problem is
--   Phase 76.2, separate). This trigger makes the leak self-correcting:
--   the next ping after GPS returns closes the orphan row.
--
-- BEHAVIOR:
--   Rep GPS off  → off-row opens (pill RED — correct).
--   Rep GPS on   → first ping fires this trigger → row closed at that
--                  ping's captured_at → duration_seconds auto-fills via
--                  the Phase 76.1 BEFORE-UPDATE duration trigger → pill
--                  GREEN. Subsequent pings find no open row → no-op.
--
-- COST: negligible. Indexed lookup on (user_id) WHERE toggled_on_at
--   IS NULL. Real work happens ONLY on the first ping after GPS
--   returns (one UPDATE); every later ping matches zero open rows.
--
-- WHAT THIS DOES NOT TOUCH:
--   - Phase 34Z.67 compute_daily_ta trigger on gps_pings (§28 frozen) —
--     this is a SEPARATE, additive AFTER-INSERT trigger on a DIFFERENT
--     target table (gps_off_events, not daily_ta). Both fire
--     independently; no ordering dependency.
--   - daily_ta / payout — gps_off_events is not joined by
--     compute_daily_ta (Phase 68). Zero payout impact.
--   - gps_pings rows — read-only here (NEW.* only).
--   - The Phase 76.1 duration trigger — it fires on the UPDATE below
--     and fills duration_seconds automatically.
--
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- (1) Function — close any open off-row older than the incoming ping
-- ─────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can UPDATE gps_off_events regardless of the
-- inserting role's RLS (the gps_pings INSERT may come from a sales rep
-- whose RLS only allows closing own rows — DEFINER sidesteps that, and
-- the WHERE clause is pinned to NEW.user_id so it can only ever touch
-- the same user's rows).

CREATE OR REPLACE FUNCTION public.heal_gps_off_on_ping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.gps_off_events
     SET toggled_on_at = NEW.captured_at
   WHERE user_id = NEW.user_id
     AND toggled_on_at IS NULL
     AND toggled_off_at < NEW.captured_at;
  RETURN NEW;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- (2) Trigger — fire after every gps_pings INSERT
-- ─────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_heal_gps_off_on_ping ON public.gps_pings;
CREATE TRIGGER trg_heal_gps_off_on_ping
  AFTER INSERT ON public.gps_pings
  FOR EACH ROW
  EXECUTE FUNCTION public.heal_gps_off_on_ping();


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY (paste after applying)
-- =====================================================================
--
-- V1: function + trigger exist
--   SELECT tgname, tgenabled
--     FROM pg_trigger
--    WHERE tgrelid = 'public.gps_pings'::regclass
--      AND tgname = 'trg_heal_gps_off_on_ping';
--   Expected: 1 row, tgenabled = 'O' (enabled).
--
-- V2: both gps_pings triggers coexist (compute_daily_ta + heal)
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.gps_pings'::regclass
--      AND NOT tgisinternal
--    ORDER BY tgname;
--   Expected: the Phase 34Z.67 compute_daily_ta trigger AND
--             trg_heal_gps_off_on_ping. Both present.
--
-- V3 (live smoke — after a rep toggles GPS off then on):
--   No open rows should survive once a newer ping lands.
--   SELECT count(*) AS open_with_later_ping
--     FROM public.gps_off_events g
--    WHERE g.toggled_on_at IS NULL
--      AND EXISTS (SELECT 1 FROM public.gps_pings p
--                   WHERE p.user_id = g.user_id
--                     AND p.captured_at > g.toggled_off_at);
--   Expected: 0 (trigger closes them on ping arrival).
--
-- =====================================================================
-- ROLLBACK (paste only if needed)
-- =====================================================================
--   DROP TRIGGER IF EXISTS trg_heal_gps_off_on_ping ON public.gps_pings;
--   DROP FUNCTION IF EXISTS public.heal_gps_off_on_ping();
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
