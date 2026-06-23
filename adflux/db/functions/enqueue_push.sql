-- ============================================================================
-- db/functions/enqueue_push.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place enqueue_push is allowed to live. EDIT THIS FILE to change it;
--    never re-paste it into a new phaseN file (§71). It lived in 3 phase files
--    (phase33w_fix, phase33w_push_triggers, phase34z69_push_audit_fixes).
--
-- WHAT IT DOES: the PUSH PIPELINE CORE (§28 frozen). SECURITY DEFINER fn that
--    POSTs to the notify-rep edge function via net.http_post (5s timeout) and
--    writes a best-effort push_log audit row. Called by ~10 internal callers
--    (push triggers + cron + SECDEF helpers) — all DEFINER-owned, so they run as
--    postgres and bypass the EXECUTE revoke below.
--
-- 🔒 SECURITY (§97.A2) — EXECUTE is REVOKED from PUBLIC / anon / authenticated.
--    Live ACL (2026-06-23) = {postgres, service_role} only. This stops any rep
--    from calling rpc('enqueue_push', ...) to spam-push another rep. The canonical
--    ENFORCES the revoke below, so re-running THIS file keeps the hole closed.
--    ⚠ THE LANDMINE THIS CLOSES: the 3 old phase files each GRANTed enqueue_push
--    TO authenticated — re-running any of them RE-OPENED the spam hole that §97.A2
--    shut. Phase 178 removed those GRANT lines from all 3, so they can't anymore.
--
-- §34Z.69 CONTRACTS in the body (do NOT change): 5s net.http_post timeout;
--    best-effort push_log audit (EXCEPTION WHEN OTHERS → NULL, never blocks the
--    push); HARDCODED anon key (Supabase HOSTED blocks ALTER DATABASE, so
--    current_setting() can't hold it — the key is the PUBLIC anon key, already
--    shipped in every client bundle, NOT a secret). search_path public,extensions
--    (extensions = where net.http_post lives). The "-- replace with the eyJ… key"
--    comment is a stale setup note carried in the live body; harmless.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 via
--    pg_get_functiondef. Single signature (5 args). Running this file is a NO-OP
--    on behaviour (it re-asserts the same body + the same secure ACL).
--
-- TRIGGER / CRON CALLERS stay in their phase files (DEFINER-owned). This canonical
--    owns the function body + its grant state only.
--
-- SUPERSEDES (Phase 178 removed the body AND the dangerous GRANT-to-authenticated
--    from each):
--      supabase_phase33w_fix.sql
--      supabase_phase33w_push_triggers.sql   (keeps its 4 push-trigger functions)
--      supabase_phase34z69_push_audit_fixes.sql
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_push(p_user_id uuid, p_title text, p_body text, p_url text DEFAULT '/work'::text, p_tag text DEFAULT 'untitled'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_request_id bigint;
  v_url  text := 'https://kompjctmisnitjpbjalh.supabase.co/functions/v1/notify-rep';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvbXBqY3RtaXNuaXRqcGJqYWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NTA3NjIsImV4cCI6MjA5MzEyNjc2Mn0.K83a7Col0_FcPpfDWVkfHA-5hrq-SAu9zj4gKe7hgqw';  -- replace with the eyJ... key you just copied
BEGIN
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

  BEGIN
    INSERT INTO public.push_log (request_id, user_id, title, body, url, tag)
    VALUES (v_request_id, p_user_id, p_title, p_body, p_url, p_tag);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_request_id;
END $function$;

-- §97.A2 security state — lock EXECUTE to postgres (owner) + service_role only.
REVOKE EXECUTE ON FUNCTION public.enqueue_push(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enqueue_push(uuid, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. The 5 body checks must be TRUE,
-- and the ACL must show NO 'authenticated' grant (§97.A2 in force).
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%timeout_milliseconds := 5000%' AS timeout_5s,
--   pg_get_functiondef(p.oid) LIKE '%push_log%'                     AS push_log_audit,
--   pg_get_functiondef(p.oid) LIKE '%notify-rep%'                   AS edge_fn_url,
--   pg_get_functiondef(p.oid) LIKE '%EXCEPTION WHEN OTHERS%'        AS audit_best_effort,
--   pg_get_functiondef(p.oid) LIKE '%apikey%'                       AS hardcoded_key,
--   (p.proacl::text NOT LIKE '%authenticated=%')                    AS authenticated_revoked
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'enqueue_push';
