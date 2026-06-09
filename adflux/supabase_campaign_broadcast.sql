-- =====================================================================
-- Campaign — Broadcast (bulk template send to a saved segment)
-- 2026-06-09
--
-- A broadcast = one approved template sent to every lead in a saved segment.
-- campaign_broadcasts holds the run + live counters; broadcast_recipients holds
-- one row per recipient with its delivery status (the funnel: queued → sent /
-- failed). The send is driven by api/wa/broadcast (batched, rate-limited) and
-- can ONLY fire with a Meta-APPROVED template — so these tables stay empty/inert
-- until the owner has one.
--
-- SAFE (§45): two NEW campaign tables. No live-app table touched. The recipient
-- list is resolved by READING leads (phones) at create time — read-only, no
-- lead write, no hot-path trigger. Admin/co_owner only. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.campaign_broadcasts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id        uuid REFERENCES public.campaign_segments(id) ON DELETE SET NULL,
  segment_name      text,
  template_name     text NOT NULL,
  template_language text NOT NULL DEFAULT 'en',
  status            text NOT NULL DEFAULT 'queued',   -- queued | sending | done | failed
  total             integer NOT NULL DEFAULT 0,
  sent              integer NOT NULL DEFAULT 0,
  failed            integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id  uuid NOT NULL REFERENCES public.campaign_broadcasts(id) ON DELETE CASCADE,
  lead_id       uuid,
  phone         text NOT NULL,
  name          text,
  status        text NOT NULL DEFAULT 'queued',       -- queued | sent | failed
  wamid         text,
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Fast "next batch of unsent recipients for this broadcast" lookup.
CREATE INDEX IF NOT EXISTS idx_bcast_recip_queued
  ON public.broadcast_recipients (broadcast_id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_bcast_recip_bid
  ON public.broadcast_recipients (broadcast_id);

ALTER TABLE public.campaign_broadcasts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bcast_admin_all ON public.campaign_broadcasts;
CREATE POLICY bcast_admin_all ON public.campaign_broadcasts
  FOR ALL USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

DROP POLICY IF EXISTS bcast_recip_admin_all ON public.broadcast_recipients;
CREATE POLICY bcast_recip_admin_all ON public.broadcast_recipients
  FOR ALL USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'campaign_broadcasts')   AS broadcasts_table,   -- 1
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'broadcast_recipients')  AS recipients_table,   -- 1
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('campaign_broadcasts', 'broadcast_recipients')) AS policy_count; -- 2

SELECT 'Campaign broadcast tables applied' AS status;
