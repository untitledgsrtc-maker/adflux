-- ============================================================================
-- supabase_ops_p5_sync.sql — Operations module Phase 5 (§230). INERT/FUTURE.
-- ============================================================================
-- The cron dispatch that fires /api/ops/sync (the aiadflux CMS adapter) on a
-- schedule. Running this file only CREATES the dispatch fn — it does NOT start
-- a cron (the schedule is a commented step below). The endpoint itself is inert
-- until AIADFLUX_API_URL + AIADFLUX_API_KEY are set in Vercel, so nothing syncs
-- until the owner's CMS dev finalises the API.
--
-- ── OWNER, when the aiadflux API is LIVE + tested on a preview deploy: ──
--   1. Set in Vercel env: OPS_SYNC_SECRET (a long random string),
--      AIADFLUX_API_URL, AIADFLUX_API_KEY.
--   2. Replace <OPS_SYNC_SECRET> below with the SAME value, then run this file.
--   3. Uncomment + run the cron.schedule block (Part 2) to start the 10-min pull.
--   Requires pg_cron + pg_net (already used by other crons).
--
-- Idempotent. Additive — touches only ops_* via the Edge endpoint's service role.
-- ============================================================================

-- ── Part 1 · the dispatch fn (created inert) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_aiadflux_sync_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://app.untitledad.in/api/ops/sync',
    headers := jsonb_build_object('content-type', 'application/json', 'x-ops-secret', '<OPS_SYNC_SECRET>'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
EXCEPTION WHEN OTHERS THEN
  -- best-effort — a pull failure must never error the cron
  NULL;
END;
$$;

-- It fires a WhatsApp-less, secret-gated POST; only pg_cron (postgres) should
-- call it. REVOKE from client roles (§86/§206/§229 — the endpoint is also
-- x-ops-secret gated, so this is defence-in-depth). NOTE: if you ever re-run
-- supabase_phase211_anon_execute_sweep.sql (the blanket GRANT), add this fn to
-- its re-lock loop, or re-run this file after it. Harm if re-opened is nil (the
-- endpoint rejects a request without the secret).
REVOKE ALL ON FUNCTION public.ops_aiadflux_sync_dispatch() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ops_aiadflux_sync_dispatch() TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Part 2 · the cron (UNCOMMENT + RUN when the API is live) ─────────────────
-- Pulls every 10 minutes. Until you uncomment this, nothing is scheduled.
--
-- DO $$ BEGIN
--   PERFORM cron.unschedule('ops-aiadflux-sync');
-- EXCEPTION WHEN OTHERS THEN NULL; END $$;
-- SELECT cron.schedule('ops-aiadflux-sync', '*/10 * * * *',
--                      $$SELECT public.ops_aiadflux_sync_dispatch()$$);

-- ── VERIFY ──
-- SELECT to_regprocedure('public.ops_aiadflux_sync_dispatch()') IS NOT NULL AS dispatch_fn,
--        has_function_privilege('authenticated', 'public.ops_aiadflux_sync_dispatch()', 'EXECUTE') AS auth_can_run; -- want: t, f
-- ============================================================================
