-- ============================================================================
-- Phase 193 — light "team monitor": ONE gated RPC (replaces the Phase 192 leak)
-- ============================================================================
-- Phase 192 gave a per-user viewer (Jayna) team-dashboard access via 13 broad
-- `FOR SELECT USING (is_team_viewer())` policies. RLS is OR/permissive + APP-
-- WIDE, so those policies leaked ALL leads / clients / calls / quotes to her on
-- EVERY page (owner: "jayna can see all the lead why?"). Phase 193 REPLACES that
-- with ONE gated SECURITY DEFINER function that returns only the monitor payload
-- (per-rep live location + today's activity counts). The viewer sees team roll-
-- ups ONLY on /team-monitor and stays own-only on /leads, /work, etc. (§45-safe;
-- no broad RLS anywhere).
--
-- This file is SELF-CONTAINED + re-runnable-safe (§8/§71): it (1) keeps the flag
-- column + is_team_viewer() helper, (2) DROPS the 13 broad leak policies (safe
-- no-op if the owner already dropped them), (3) creates the gated RPC. Running it
-- again only ever re-asserts the closed state — it can NEVER recreate the leak.
-- The old supabase_phase192_*.sql has been neutered to a DROP-only closer.
--
-- TO GRANT a viewer:  UPDATE public.users SET can_view_team_dashboard = true
--                       WHERE email = '<their login email>';
-- TO REVOKE:          set it back to false. No other change needed.
-- ============================================================================

-- ---- 1) flag column (idempotent) -------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_view_team_dashboard boolean NOT NULL DEFAULT false;

-- ---- 2) helper: caller's own flag (SECURITY DEFINER so a policy/RPC can read
--          it without recursing through users RLS; STABLE for planner cache) --
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

-- ---- 3) CLOSE THE LEAK: drop the 13 Phase 192 broad SELECT policies ---------
-- Idempotent. Safe if already dropped by the owner. This is the security fix —
-- with these gone, a flagged viewer has NO broad table access; her only team-
-- wide read is the gated RPC below.
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

-- ---- 4) the ONE gated rollup RPC -------------------------------------------
-- Returns a jsonb array; empty [] for anyone not authorized (no data leak).
-- Exposes ONLY: id/name/role/team_role/avatar + last location + today's
-- call/connected/meeting/lead counts. No financial / P&L / private PII.
CREATE OR REPLACE FUNCTION public.team_monitor_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out  jsonb;
  v_day  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  -- GATE: only a team viewer or admin/co_owner. Everyone else → empty.
  -- Uses IN (...) so a NULL role fails CLOSED (not the NOT IN 3VL trap, §41).
  IF NOT (public.is_team_viewer() OR public.get_my_role() IN ('admin', 'co_owner')) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY nm), '[]'::jsonb) INTO v_out
  FROM (
    SELECT
      u.name AS nm,
      jsonb_build_object(
        'id',           u.id,
        'name',         u.name,
        'role',         u.role,
        'team_role',    u.team_role,
        'avatar',       u.profile_image_url,
        'lat',          lp.lat,
        'lng',          lp.lng,
        'last_ping_at', lp.captured_at,
        'calls',        COALESCE(cl.calls, 0),
        'connected',    COALESCE(cl.connected, 0),
        'meetings',     COALESCE(mt.meetings, 0),
        'leads',        COALESCE(ld.leads, 0)
      ) AS r
    FROM public.users u
    LEFT JOIN LATERAL (
      SELECT p.lat, p.lng, p.captured_at
        FROM public.gps_pings p
       WHERE p.user_id = u.id
       ORDER BY p.captured_at DESC
       LIMIT 1
    ) lp ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS calls,
             count(*) FILTER (WHERE c.duration_seconds >= 10
                              AND COALESCE(c.direction, '') <> 'missed') AS connected
        FROM public.call_logs c
       WHERE c.user_id = u.id
         AND (c.call_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
    ) cl ON true
    LEFT JOIN LATERAL (
      -- §33 done-meeting contract: exclude scheduled + auto-check-in rows,
      -- dedup by COALESCE(lead_id, id). Matches lead_activity_bump_counter.
      SELECT count(DISTINCT COALESCE(a.lead_id::text, a.id::text)) AS meetings
        FROM public.lead_activities a
       WHERE a.created_by = u.id
         AND a.activity_type IN ('meeting', 'site_visit')
         AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
         AND (a.notes IS NULL OR a.notes NOT LIKE 'Meeting scheduled%')
         AND (a.notes IS NULL OR a.notes NOT LIKE 'I''m here · auto-check-in%')
    ) mt ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS leads
        FROM public.leads l
       WHERE (l.telecaller_id = u.id OR l.assigned_to = u.id)
         AND (l.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
    ) ld ON true
    WHERE u.is_active = true
      AND (u.role IN ('sales', 'telecaller', 'agency')
           OR u.team_role IN ('sales', 'telecaller', 'agency', 'sales_manager'))
  ) x;

  RETURN v_out;
END $function$;

GRANT EXECUTE ON FUNCTION public.team_monitor_snapshot() TO authenticated;
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — expect: 0 broad leak policies + helper + RPC + column present.
-- ============================================================================
-- SELECT count(*) AS leak_policies FROM pg_policies
--   WHERE schemaname='public' AND policyname LIKE '%\_team\_viewer\_read';     -- 0
-- SELECT to_regprocedure('public.is_team_viewer()')        IS NOT NULL AS helper_present;   -- t
-- SELECT to_regprocedure('public.team_monitor_snapshot()') IS NOT NULL AS rpc_present;      -- t
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='users'
--     AND column_name='can_view_team_dashboard';                              -- 1 row
-- As admin: SELECT jsonb_array_length(public.team_monitor_snapshot());        -- rep count
-- As a flagged viewer: same call returns the rollup; as a plain rep: '[]'.
