-- =====================================================================
-- Campaign — QR scan tracking (qr_scans) + per-board scan count
-- 2026-06-07
--
-- WHAT
--   Today a board QR points straight at wa.me, so a scan can't be counted.
--   The scan tracker changes the QR to point at /api/q/<CODE>, which logs a
--   row here then 302-redirects to the board's wa.me link. This file adds
--   the log table the redirect writes + the admin read policy the QR page
--   reads its "Scans" column from.
--
-- SAFETY (CLAUDE.md §45)
--   • Brand-new table. No existing flow reads/writes it. ON DELETE CASCADE
--     from campaign_locations so deleting a board cleans its scans.
--   • The /api/q redirect writes via the service role (bypasses RLS); the
--     admin QR page reads via the admin SELECT policy. No rep/live touch.
--   • A scan is a vanity metric — `ua_hash` lets the endpoint do light
--     same-visitor dedup; no PII (no raw IP / UA stored).
--
-- Idempotent (CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.qr_scans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.campaign_locations(id) ON DELETE CASCADE,
  scanned_at  timestamptz NOT NULL DEFAULT now(),
  ua_hash     text          -- short hash of UA+IP for same-visitor dedup; NOT PII
);
CREATE INDEX IF NOT EXISTS idx_qr_scans_loc_at ON public.qr_scans (location_id, scanned_at DESC);

ALTER TABLE public.qr_scans ENABLE ROW LEVEL SECURITY;

-- Admin / co_owner read the counts on the QR page. Writes are service-role
-- only (the redirect endpoint) — no INSERT policy for anon/authenticated, so
-- a rep/client can't forge scans via PostgREST.
DROP POLICY IF EXISTS qr_scans_admin_read ON public.qr_scans;
CREATE POLICY qr_scans_admin_read ON public.qr_scans
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'co_owner'));

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'qr_scans')        AS table_present,   -- → 1
  (SELECT count(*) FROM pg_policies WHERE tablename = 'qr_scans')                       AS policy_count;    -- → 1

SELECT 'Campaign qr_scans tracking applied' AS status;
