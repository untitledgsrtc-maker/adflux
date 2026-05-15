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
CREATE OR REPLACE FUNCTION public.enqueue_push(
  p_user_id  uuid,
  p_title    text,
  p_body     text,
  p_url      text DEFAULT '/work',
  p_tag      text DEFAULT 'untitled'
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_request_id bigint;
  v_url  text := 'https://kompjctmisnitjpbjalh.supabase.co/functions/v1/notify-rep';
  v_anon text := current_setting('app.settings.anon_key', true);
BEGIN
  IF v_anon IS NULL OR v_anon = '' THEN
    v_anon := 'SET_ANON_KEY_VIA_app.settings.anon_key';
  END IF;

  -- Phase 34Z.69 fix #3 — explicit 5s timeout. pg_net defaults to
  -- 180s; long enough to hang the calling transaction if notify-rep
  -- is slow. Push is fire-and-forget, so we want it to fail fast.
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon,
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object(
      'user_id', p_user_id,
      'title',   p_title,
      'body',    p_body,
      'url',     p_url,
      'tag',     p_tag
    ),
    timeout_milliseconds := 5000
  ) INTO v_request_id;

  -- Phase 34Z.69 fix #7 — audit row. Lets admin SELECT * FROM
  -- push_log to see every notification attempt + correlate with
  -- net._http_response by request_id.
  BEGIN
    INSERT INTO public.push_log (request_id, user_id, title, body, url, tag)
    VALUES (v_request_id, p_user_id, p_title, p_body, p_url, p_tag);
  EXCEPTION WHEN OTHERS THEN
    -- Never block the underlying business event because of audit
    -- logging. Push table can fail (RLS, disk, anything); we
    -- swallow.
    NULL;
  END;

  RETURN v_request_id;
END $$;

GRANT EXECUTE ON FUNCTION public.enqueue_push(uuid, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'push_log') AS table_present,
  (SELECT count(*) FROM pg_proc
    WHERE proname = 'enqueue_push')                            AS function_present;
