-- supabase_phase34z69_push_audit_fixes.sql
--
-- Phase 34Z.69 — audit cleanup batch.
-- 16 May 2026
--
-- Two SQL-side fixes from the 15 May deep audit:
--
-- #3 (P1) — pg_net.http_post had no timeout in enqueue_push().
--   Default is 180s. If notify-rep stalls, the trigger transaction
--   blocks for 3 minutes — every INSERT/UPDATE that fired the
--   trigger (lead assignment, payment approval, quote won, etc.)
--   freezes the rep's UI. Add timeout_milliseconds := 5000 so
--   push failures fail fast.
--
-- #7 (P1) — per-task push triggers (Phase 34Z.55) silently discard
--   the pg_net request_id. If notify-rep returns 5xx, the
--   notification is lost and no audit trail exists. Add a
--   public.push_log table that records every enqueue attempt so
--   admin can grep for failures.
--
-- Both wired into the existing enqueue_push() helper — no caller
-- changes needed. Idempotent.

-- ─── 1. push_log audit trail ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_log (
  id            uuid primary key default gen_random_uuid(),
  request_id    bigint,
  user_id       uuid,
  title         text,
  body          text,
  url           text,
  tag           text,
  enqueued_at   timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_push_log_enqueued
  ON public.push_log (enqueued_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_log_user
  ON public.push_log (user_id, enqueued_at DESC);

ALTER TABLE public.push_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_log_admin ON public.push_log;
CREATE POLICY push_log_admin ON public.push_log
  FOR ALL USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));


-- ─── 2. enqueue_push: 5s timeout + audit row ─────────────────────
-- -------------------------------------------------------------------------
-- enqueue_push REMOVED from this file (Phase 178).
-- Canonical: db/functions/enqueue_push.sql (push core; §97.A2 REVOKE baked in).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- enqueue_push GRANT removed (Phase 178): §97.A2 revoked EXECUTE from authenticated; the canonical (db/functions/enqueue_push.sql) enforces the revoke. Re-granting here would RE-OPEN the rep-to-rep push-spam hole.

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'push_log') AS table_present,
  (SELECT count(*) FROM pg_proc
    WHERE proname = 'enqueue_push')                            AS function_present;
