-- ============================================================================
-- Phase 192 — SUPERSEDED by Phase 193. NEUTERED to a DROP-ONLY closer.
-- ============================================================================
-- ⚠️  DO NOT restore the CREATE POLICY loop that used to live here.
--
-- Phase 192 originally granted a per-user viewer (Jayna) team access via 13
-- broad `FOR SELECT USING (is_team_viewer())` policies. RLS is OR/permissive +
-- APP-WIDE, so those policies LEAKED all leads / clients / calls / quotes to her
-- on EVERY page (owner: "jayna can see all the lead why?"). That was the leak.
--
-- Phase 193 replaced the approach with ONE gated SECURITY DEFINER RPC
-- (`team_monitor_snapshot()`, supabase_phase193_team_monitor_rpc.sql) + a light
-- /team-monitor page. The viewer now sees team rollups ONLY there and stays
-- own-only everywhere else.
--
-- This file is kept ONLY so re-running it is SAFE: it now just re-asserts the
-- flag column + helper and DROPS the 13 leak policies (never recreates them).
-- The canonical, self-contained file to run is Phase 193 — running THAT does
-- everything this file does plus creates the RPC. (§8/§71 no-re-runnable-leak.)
-- ============================================================================

-- flag column (idempotent) — still used by Phase 193's RPC + the route guard.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_view_team_dashboard boolean NOT NULL DEFAULT false;

-- helper (idempotent) — read the caller's own flag; used by team_monitor_snapshot().
CREATE OR REPLACE FUNCTION public.is_team_viewer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT can_view_team_dashboard FROM public.users WHERE id = auth.uid()),
    false)
$function$;

GRANT EXECUTE ON FUNCTION public.is_team_viewer() TO authenticated;

-- CLOSE THE LEAK: drop the 13 broad SELECT policies (never recreate them).
-- Idempotent + safe if already dropped. This is the whole point of the neuter.
DO $$
DECLARE t text;
  tbls text[] := ARRAY[
    'gps_pings','gps_off_events','users','work_sessions','call_logs','leads',
    'quotes','voice_logs','daily_targets','follow_ups','payments',
    'lead_activities','push_subscriptions'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_team_viewer_read', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — expect 0 leak policies remaining.
-- ============================================================================
-- SELECT count(*) AS leak_policies FROM pg_policies
--   WHERE schemaname='public' AND policyname LIKE '%\_team\_viewer\_read';   -- 0
