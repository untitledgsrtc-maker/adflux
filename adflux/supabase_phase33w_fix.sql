-- supabase_phase33w_fix.sql
--
-- Phase 33W fix — Supabase SQL editor can't run ALTER DATABASE SET
-- (permission denied 42501; only superuser). Hardcode the anon key
-- directly into enqueue_push() since anon keys are public-by-design
-- (every browser already has it).
--
-- Owner's anon key (from SQL Editor screenshot):
--   sb_publishable_9_MhDyQkqBES4KQjVQUgxQ_1OsEfoMY
--
-- Run this AFTER supabase_phase33w_push_triggers.sql. CREATE OR
-- REPLACE so it's safe to run on top.

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
  v_anon text := 'sb_publishable_9_MhDyQkqBES4KQjVQUgxQ_1OsEfoMY';
BEGIN
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        v_anon,
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object(
      'user_id', p_user_id,
      'title',   p_title,
      'body',    p_body,
      'url',     p_url,
      'tag',     p_tag
    )
  ) INTO v_request_id;
  RETURN v_request_id;
END $$;

GRANT EXECUTE ON FUNCTION public.enqueue_push(uuid, text, text, text, text) TO authenticated;

-- VERIFY: should return a non-null request_id and your phone should
-- buzz within ~5 seconds.
--   SELECT public.enqueue_push(auth.uid(), 'Trigger test', 'From SQL function');
