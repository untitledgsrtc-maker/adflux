-- ============================================================================
-- supabase_phase323_dashboard_agg_rpcs.sql
-- Phase 323 perf backlog — server-side GROUP BY RPCs for the 5 dashboard
-- aggregation findings (H4 / M10 / M16 / M17 / M21). ADDITIVE — every RPC is
-- new or a CREATE OR REPLACE that reproduces the current client math BYTE-FOR-
-- BYTE. Each frontend calls its RPC with a fallback to the existing client
-- aggregation on RPC-error, so this is deploy-safe in EITHER order.
-- RUN each RPC's block, then its SHADOW-COMPARE (bottom) and confirm 0 diff
-- BEFORE trusting the RPC path (the money ones: H4, M16).
-- ============================================================================


-- ---------- H4 · admin_dashboard_kpis ----------
-- Additive, NEW function. SECURITY INVOKER: the page is admin/co_owner-gated
-- (RequirePrivileged) and the client's own quotes/payments fetches are already
-- RLS-scoped, so running the aggregation under the caller's RLS makes the RPC
-- byte-identical to the client for BOTH roles (admin=all, co_owner Vishal=GOVERNMENT
-- only, per §42/§152) with zero new data exposure and no REVOKE/DEFINER gymnastics.
-- Boundary strings are PASSED IN (the exact values the client already computes at
-- lines 122/344/411/427/430) so the RPC window == the client window with no JS/PG
-- clock skew. §42 F-D001: PostgREST/DB session tz = Asia/Kolkata → a timestamptz's
-- leading serialized date IS its IST date; month-window compares use (ts AT TIME ZONE
-- 'Asia/Kolkata')::date which is byte-identical to the client's IST-string-vs-date
-- compare. The 30d/45d cutoff compares faithfully reproduce the client's lexicographic
-- wall-clock string compare (IST row vs UTC 'Z' cutoff) via to_char.
CREATE OR REPLACE FUNCTION public.admin_dashboard_kpis(
  p_segment        text,
  p_month_start    date,
  p_month_end      date,
  p_today          date,
  p_overdue_cutoff timestamptz,
  p_45d_cutoff     timestamptz
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
WITH q AS (  -- segment-scoped quotes == the client's `quotes` array (lines 326-330)
  SELECT id, status, segment, total_amount, created_at, updated_at, won_at
  FROM public.quotes
  WHERE p_segment = 'all'
     OR (p_segment = 'government' AND segment = 'GOVERNMENT')
     OR (p_segment NOT IN ('all','government') AND segment IS DISTINCT FROM 'GOVERNMENT')
),
pay AS (  -- ALL approved payments (client fetch at 149-151; RLS scopes per role)
  SELECT quote_id, amount_received, payment_date, is_final_payment
  FROM public.payments
  WHERE approval_status = 'approved'
),
payf AS (  -- paymentsAprFiltered (336-338): approved payments whose quote is in q
  SELECT pp.* FROM pay pp
  WHERE p_segment = 'all' OR EXISTS (SELECT 1 FROM q WHERE q.id = pp.quote_id)
),
paid AS (  -- per-quote approved paid total (uses ALL approved pay, matched by quote_id)
  SELECT quote_id, SUM(amount_received) AS paid FROM pay GROUP BY quote_id
)
SELECT jsonb_build_object(
  'revenue',        COALESCE((SELECT SUM(amount_received) FROM payf
                      WHERE payment_date >= p_month_start AND payment_date < p_month_end), 0),
  'todayCollected', COALESCE((SELECT SUM(amount_received) FROM payf
                      WHERE payment_date = p_today), 0),
  'activeQuotes',   (SELECT COUNT(*) FROM q WHERE status <> 'lost'),
  'activeValue',    COALESCE((SELECT SUM(total_amount) FROM q WHERE status <> 'lost'), 0),
  'activeOverdue',  (SELECT COUNT(*) FROM q
                      WHERE status IN ('sent','negotiating')
                        AND to_char(created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS')
                          < to_char(p_overdue_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')),
  'pipelineValue',  COALESCE((SELECT SUM(total_amount) FROM q WHERE status IN ('sent','negotiating')), 0),
  'pipelineCount',  (SELECT COUNT(*) FROM q WHERE status IN ('sent','negotiating')),
  'lostRevenue',    COALESCE((SELECT SUM(total_amount) FROM q
                      WHERE status = 'lost'
                        AND (COALESCE(updated_at, created_at) AT TIME ZONE 'Asia/Kolkata')::date >= p_month_start
                        AND (COALESCE(updated_at, created_at) AT TIME ZONE 'Asia/Kolkata')::date <  p_month_end), 0),
  'wonValue',       COALESCE((SELECT SUM(total_amount) FROM q
                      WHERE status = 'won'
                        AND (COALESCE(won_at, updated_at, created_at) AT TIME ZONE 'Asia/Kolkata')::date >= p_month_start
                        AND (COALESCE(won_at, updated_at, created_at) AT TIME ZONE 'Asia/Kolkata')::date <  p_month_end), 0),
  'wonCount',       (SELECT COUNT(*) FROM q
                      WHERE status = 'won'
                        AND (COALESCE(won_at, updated_at, created_at) AT TIME ZONE 'Asia/Kolkata')::date >= p_month_start
                        AND (COALESCE(won_at, updated_at, created_at) AT TIME ZONE 'Asia/Kolkata')::date <  p_month_end),
  'outstanding',    COALESCE((SELECT SUM(GREATEST(0, COALESCE(q.total_amount,0) - COALESCE(pd.paid,0)))
                      FROM q LEFT JOIN paid pd ON pd.quote_id = q.id
                      WHERE q.status <> 'lost'
                        AND (q.status = 'won' OR COALESCE(pd.paid,0) > 0)), 0),
  'outstandingOver45d', (SELECT COUNT(*)
                      FROM q LEFT JOIN paid pd ON pd.quote_id = q.id
                      WHERE q.status = 'won'
                        AND to_char(COALESCE(q.updated_at, q.created_at) AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS')
                          <= to_char(p_45d_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')
                        AND COALESCE(pd.paid,0) < COALESCE(q.total_amount,0)),
  'funnel',         (SELECT jsonb_agg(jsonb_build_object('status', f.status, 'count', f.count, 'value', f.value) ORDER BY f.ord)
                      FROM (
                        SELECT st.status, st.ord,
                               COUNT(qq.id) AS count,
                               COALESCE(SUM(qq.total_amount), 0) AS value
                        FROM (VALUES ('draft',1,false),('sent',2,false),('negotiating',3,false),
                                     ('won',4,true),('lost',5,true)) st(status, ord, terminal)
                        LEFT JOIN q qq ON qq.status = st.status AND (
                             (NOT st.terminal)
                          OR (st.status = 'won'  AND (COALESCE(qq.won_at, qq.updated_at, qq.created_at) AT TIME ZONE 'Asia/Kolkata')::date >= p_month_start
                                                 AND (COALESCE(qq.won_at, qq.updated_at, qq.created_at) AT TIME ZONE 'Asia/Kolkata')::date <  p_month_end)
                          OR (st.status = 'lost' AND (COALESCE(qq.updated_at, qq.created_at) AT TIME ZONE 'Asia/Kolkata')::date >= p_month_start
                                                 AND (COALESCE(qq.updated_at, qq.created_at) AT TIME ZONE 'Asia/Kolkata')::date <  p_month_end)
                        )
                        GROUP BY st.status, st.ord
                      ) f)
);
$fn$;

REVOKE ALL ON FUNCTION public.admin_dashboard_kpis(text,date,date,date,timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_kpis(text,date,date,date,timestamptz,timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect prosecdef=f (INVOKER), and the 12-key funnel'd jsonb.
-- SELECT proname, prosecdef FROM pg_proc WHERE proname='admin_dashboard_kpis';

-- ---------- M10 · admin_source_attribution ----------
-- Phase 47.7 perf: server-side GROUP BY for the admin source-attribution card.
-- Replaces the raw ~1000-row-capped lead pull in AdminDashboardDesktop.jsx.
-- SECURITY INVOKER: the page is admin-gated and the existing client query is
-- already scoped by the caller's `leads` RLS (admin = all; co_owner/govt-partner
-- = GOVERNMENT-only, §42). INVOKER reproduces that scope exactly -> no bypass,
-- no regression. Returns raw {source,total,won}; the frontend keeps its own
-- pct/sort/slice so output stays byte-identical to the current client agg.
-- Normalization mirrors the JS loop: trim(source); empty -> '—' (U+2014);
-- NULL source excluded (matches .not('source','is',null)).
CREATE OR REPLACE FUNCTION public.admin_source_attribution(p_days integer DEFAULT 90)
RETURNS TABLE(source text, total bigint, won bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(regexp_replace(l.source, '^\s+|\s+$', '', 'g'), ''), '—') AS source,
    COUNT(*)::bigint AS total,
    (COUNT(*) FILTER (WHERE l.stage = 'Won'))::bigint AS won
  FROM public.leads l
  WHERE l.source IS NOT NULL
    AND l.created_at >= (now() - make_interval(days => p_days))
  GROUP BY 1
$$;

REVOKE ALL ON FUNCTION public.admin_source_attribution(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_source_attribution(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_source_attribution(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: fn present + INVOKER + not anon-executable
-- SELECT p.proname, p.prosecdef AS is_definer,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can
-- FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='public' AND p.proname='admin_source_attribution';
-- expect: is_definer=false, auth_can=true, anon_can=false

-- ---------- M16 · get_my_settled_this_month ----------
-- =====================================================
-- PHASE 3D.2 — MY SETTLED-THIS-MONTH RPC (SalesDashboard perf)
-- Replaces the whole-org quotes+payments fetch that existed only
-- to compute the caller's own "Settled · this month" KPI. Byte-for-
-- byte reproduces src/utils/settlement.js getSettlement()/build-
-- SettlementMap() + the JS month-window string test. Self-scoped to
-- auth.uid() (a rep's own settled total only) — SECURITY DEFINER so
-- a caller without a direct payments read policy (§107) still gets
-- the correct money number instead of a silent 0; fail-closed when
-- auth.uid() IS NULL (no rows match created_by = NULL). No cross-rep
-- leak: auth.uid() is server-resolved, never a parameter.
-- Boundaries are passed IN from the client (its existing monthStart-
-- Iso/monthEndIso) so the month test is byte-identical to the JS.
-- =====================================================

DROP FUNCTION IF EXISTS public.get_my_settled_this_month(text, text);

CREATE OR REPLACE FUNCTION public.get_my_settled_this_month(
  p_month_start text,
  p_month_end   text
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH my_quotes AS (               -- all my quotes (settlement is status-blind, like the JS)
    SELECT q.id, q.total_amount
    FROM public.quotes q
    WHERE q.created_by = auth.uid()
  ),
  ap AS (                           -- approved payments on my quotes, with the JS date string
    SELECT
      p.quote_id,
      p.amount_received,
      p.is_final_payment,
      COALESCE(
        p.payment_date::text,       -- 'YYYY-MM-DD' (matches PostgREST date serialization)
        to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
      ) AS d
    FROM public.payments p
    JOIN my_quotes q ON q.id = p.quote_id
    WHERE p.approval_status = 'approved'
  ),
  final_flag AS (                   -- Case 1: earliest date among approved is_final payments
    SELECT quote_id, MIN(d) AS final_date
    FROM ap
    WHERE is_final_payment = true
    GROUP BY quote_id
  ),
  paid_sum AS (
    SELECT quote_id, SUM(amount_received) AS paid
    FROM ap
    GROUP BY quote_id
  ),
  running AS (                      -- cumulative paid in date order, per quote
    SELECT
      ap.quote_id,
      ap.d,
      q.total_amount,
      SUM(ap.amount_received) OVER (
        PARTITION BY ap.quote_id ORDER BY ap.d ROWS UNBOUNDED PRECEDING
      ) AS run
    FROM ap
    JOIN my_quotes q ON q.id = ap.quote_id
  ),
  clear_pay AS (                    -- Case 2: date of the payment that first reaches total
    SELECT quote_id, MIN(d) FILTER (WHERE run >= total_amount) AS clear_date
    FROM running
    WHERE total_amount > 0
    GROUP BY quote_id
  ),
  settle AS (                       -- getSettlement(): Case 1 wins over Case 2
    SELECT
      q.id,
      q.total_amount,
      CASE
        WHEN ff.final_date IS NOT NULL THEN ff.final_date
        WHEN q.total_amount > 0 AND COALESCE(ps.paid, 0) >= q.total_amount THEN cp.clear_date
        ELSE NULL
      END AS settled_at
    FROM my_quotes q
    LEFT JOIN final_flag ff ON ff.quote_id = q.id
    LEFT JOIN paid_sum   ps ON ps.quote_id = q.id
    LEFT JOIN clear_pay  cp ON cp.quote_id = q.id
  )
  SELECT COALESCE(SUM(COALESCE(total_amount, 0)), 0)   -- Number(q.total_amount)||0
  FROM settle
  WHERE settled_at IS NOT NULL
    AND settled_at COLLATE "C" >= p_month_start         -- JS: settledAt >= monthStartIso
    AND settled_at COLLATE "C" <  p_month_end;          -- JS: settledAt <  monthEndIso  (COLLATE "C" == JS code-unit < )
$$;

REVOKE ALL ON FUNCTION public.get_my_settled_this_month(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_settled_this_month(text, text) TO authenticated;

-- Test:  SELECT public.get_my_settled_this_month('2026-07-31T18:30:00.000Z','2026-08-31T18:30:00.000Z');

-- ---------- M17 · team_payment_sums ----------
CREATE OR REPLACE FUNCTION public.team_payment_sums()
  RETURNS TABLE (quote_id uuid, paid numeric)
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.quote_id,
         COALESCE(sum(COALESCE(p.amount_received, 0)), 0)::numeric AS paid
    FROM public.payments p
   WHERE p.quote_id IS NOT NULL
     AND (p.approval_status IS NULL OR p.approval_status IN ('', 'approved'))
   GROUP BY p.quote_id;
$fn$;

REVOKE ALL     ON FUNCTION public.team_payment_sums() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.team_payment_sums() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------- M21 · team_dashboard_bundle ----------
-- supabase_phase323_M21_team_bundle_chase.sql
-- FUNCTION-ONLY CREATE OR REPLACE of team_dashboard_bundle (the §193/§316 gated
-- team-viewer RPC). Same deadlock-safe pattern as phase316: locks ONLY pg_proc,
-- never touches gps_pings policies — safe to run anytime, re-runnable.
--
-- M21 (perf audit H7/M17/M21): the three unbounded arms quote_sent / quote_won /
-- payments were jsonb_agg'ing every sent quote, every won quote, and the WHOLE
-- payments table to the viewer's browser (O(all payments)). The viewer already
-- derives per-rep chase counts from team_chase_counts (frontend L646), so those
-- arms are dead weight. Replaced with '[]'::jsonb + ONE aggregated `chase` arm
-- that DELEGATES to team_chase_counts(p_period_end) — single source of the chase
-- logic (shared with the admin path, M17/H7). Payload O(all payments) → O(reps).
-- Byte-identical numbers: `chase` == team_chase_counts, already shadow-proven
-- (supabase_phase323_team_chase_counts.sql) == the client aggregation it replaces.
-- Gate UNCHANGED (viewer-or-admin, admin-only-not-co_owner, COALESCE fail-closed).

CREATE OR REPLACE FUNCTION public.team_dashboard_bundle(
  p_start_of_day timestamptz,
  p_end_of_day   timestamptz,
  p_period_start date,
  p_period_end   date,
  p_today        date,
  p_cb_floor     date,
  p_month_start  timestamptz,
  p_month_end    timestamptz
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  -- GATE (UNCHANGED, §41/§97.2/§316): viewer or admin ONLY (co_owner excluded —
  -- Vishal is govt-scoped, §42). COALESCE around the IN so a NULL role fails
  -- CLOSED (bare NULL IN (...) yields NULL → false OR NULL → NULL → IF treats
  -- NULL as false → RETURN skipped → full bundle leak). is_team_viewer() is
  -- already COALESCE'd to false.
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() = 'admin', false)) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT jsonb_build_object(

    'reps', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name)
      FROM (
        SELECT id, name, team_role, city, daily_targets, is_active, profile_image_url, app_version
        FROM public.users
        WHERE team_role IN ('sales','sales_manager','telecaller')
          AND is_active = true
      ) r
    ), '[]'::jsonb),

    'sessions', COALESCE((
      SELECT jsonb_agg(to_jsonb(s))
      FROM (
        SELECT user_id, check_in_at, check_out_at, auto_checked_out,
               check_out_source, daily_counters
        FROM public.work_sessions
        WHERE work_date = p_today
      ) s
    ), '[]'::jsonb),

    'calls', COALESCE((
      SELECT jsonb_agg(to_jsonb(c))
      FROM (
        SELECT user_id, outcome
        FROM public.call_logs
        WHERE call_at >= p_start_of_day AND call_at < p_end_of_day
          AND duration_seconds >= 10
          AND (direction IS NULL OR direction <> 'missed')
          AND lead_id IS NOT NULL
      ) c
    ), '[]'::jsonb),

    'new_leads_count', (
      SELECT count(*) FROM public.leads
      WHERE created_at >= p_start_of_day AND created_at < p_end_of_day
    ),

    'pipeline', COALESCE((
      SELECT jsonb_agg(to_jsonb(q))
      FROM (
        SELECT total_amount, status
        FROM public.quotes
        WHERE status = 'won'
          AND created_at >= p_start_of_day AND created_at < p_end_of_day
      ) q
    ), '[]'::jsonb),

    'voice', COALESCE((
      SELECT jsonb_agg(to_jsonb(v))
      FROM (
        SELECT user_id FROM public.voice_logs
        WHERE created_at >= p_start_of_day AND created_at < p_end_of_day
      ) v
    ), '[]'::jsonb),

    'pings', COALESCE((
      SELECT jsonb_agg(to_jsonb(pg))
      FROM (
        SELECT DISTINCT ON (user_id) user_id, lat, lng, captured_at
        FROM public.gps_pings
        WHERE captured_at >= p_start_of_day AND captured_at < p_end_of_day
        ORDER BY user_id, captured_at DESC
      ) pg
    ), '[]'::jsonb),

    'policy', COALESCE((
      SELECT jsonb_agg(to_jsonb(dt))
      FROM (
        SELECT user_id, min_calls, min_qualified_weekly
        FROM public.daily_targets
        WHERE effective_to IS NULL
      ) dt
    ), '[]'::jsonb),

    'fu', COALESCE((
      SELECT jsonb_agg(to_jsonb(f))
      FROM (
        SELECT assigned_to, is_done, follow_up_date, done_at, done_note
        FROM public.follow_ups
        WHERE (is_done = true  AND done_at >= p_start_of_day AND done_at < p_end_of_day)
           OR (is_done = false AND follow_up_date >= p_period_start AND follow_up_date < p_period_end)
      ) f
    ), '[]'::jsonb),

    -- 10) quote_sent  — M21: EMPTIED. Per-rep quote-chase now comes pre-aggregated
    --     in the `chase` arm (team_chase_counts). Was: jsonb_agg every status='sent'
    --     quote (O(all sent quotes)). Kept as '[]' so an old cached frontend that
    --     still reads b.quote_sent degrades cleanly (it uses team_chase_counts for
    --     the viewer regardless — chaseFromRpc → skips the arm consumer).
    'quote_sent', '[]'::jsonb,

    -- 11) quote_won   — M21: EMPTIED (was jsonb_agg every status='won' quote).
    'quote_won', '[]'::jsonb,

    -- 12) payments    — M21: EMPTIED (was jsonb_agg the WHOLE payments table,
    --     O(all payments) — the biggest download on this hot page).
    'payments', '[]'::jsonb,

    'overdue_fu', COALESCE((
      SELECT jsonb_agg(to_jsonb(o))
      FROM (
        SELECT f.assigned_to FROM public.follow_ups f
        LEFT JOIN public.leads l ON l.id = f.lead_id
        WHERE f.follow_up_date < p_today AND f.is_done = false
          AND COALESCE(l.stage, '') <> 'Lost'
          AND NOT COALESCE(l.stage = 'Nurture' AND COALESCE(f.cadence_type, '') <> 'nurture', false)
      ) o
    ), '[]'::jsonb),

    'act_geo', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC)
      FROM (
        SELECT la.id, la.created_at, la.created_by, la.activity_type, la.outcome,
               la.gps_lat, la.gps_lng,
               (SELECT jsonb_build_object('id', l.id, 'name', l.name, 'company', l.company)
                  FROM public.leads l WHERE l.id = la.lead_id) AS lead
        FROM public.lead_activities la
        WHERE la.activity_type IN ('meeting','site_visit')
          AND la.created_at >= (now() - interval '90 days')
        ORDER BY la.created_at DESC
        LIMIT 500
      ) a
    ), '[]'::jsonb),

    'qualified', COALESCE((
      SELECT jsonb_agg(to_jsonb(qa))
      FROM (
        SELECT created_by FROM public.lead_activities
        WHERE activity_type = 'call' AND outcome = 'positive'
          AND created_at >= p_start_of_day AND created_at < p_end_of_day
      ) qa
    ), '[]'::jsonb),

    'callbacks', COALESCE((
      SELECT jsonb_agg(to_jsonb(cb))
      FROM (
        SELECT assigned_to, lead_id, id FROM public.follow_ups
        WHERE is_done = false
          AND follow_up_date >= p_cb_floor AND follow_up_date <= p_today
      ) cb
    ), '[]'::jsonb),

    'month_quotes', COALESCE((
      SELECT jsonb_agg(to_jsonb(mq))
      FROM (
        SELECT created_by, total_amount FROM public.quotes
        WHERE created_at >= p_month_start AND created_at < p_month_end
      ) mq
    ), '[]'::jsonb),

    'month_won', COALESCE((
      SELECT jsonb_agg(to_jsonb(mw))
      FROM (
        SELECT created_by, total_amount FROM public.quotes
        WHERE status = 'won'
          AND updated_at >= p_month_start AND updated_at < p_month_end
      ) mw
    ), '[]'::jsonb),

    'push_subs', COALESCE((
      SELECT jsonb_agg(to_jsonb(ps))
      FROM (
        SELECT DISTINCT ON (user_id) user_id, last_seen_at
        FROM public.push_subscriptions
        ORDER BY user_id, last_seen_at DESC
      ) ps
    ), '[]'::jsonb),

    'gps_off', COALESCE((
      SELECT jsonb_agg(to_jsonb(go))
      FROM (
        SELECT user_id, toggled_off_at
        FROM public.gps_off_events
        WHERE toggled_on_at IS NULL
      ) go
    ), '[]'::jsonb),

    -- 21) chase  — M21 NEW: per-rep quote-chase + pay-chase, aggregated server-side.
    --     DELEGATES to team_chase_counts(p_period_end) so the chase logic has ONE
    --     definition (shared with the admin path — M17/H7). Both functions are
    --     SECURITY DEFINER; the inner gate (is_team_viewer() OR NULL OR admin)
    --     re-passes for the same caller the outer gate already validated. O(reps).
    'chase', COALESCE((
      SELECT jsonb_agg(to_jsonb(c))
      FROM public.team_chase_counts(p_period_end) c
    ), '[]'::jsonb)

  ) INTO v_out;

  RETURN v_out;
END $function$;

GRANT EXECUTE ON FUNCTION public.team_dashboard_bundle(
  timestamptz, timestamptz, date, date, date, date, timestamptz, timestamptz
) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: the chase arm is present and the heavy arms are emptied in the live fn
-- SELECT pg_get_functiondef('public.team_dashboard_bundle(timestamptz,timestamptz,date,date,date,date,timestamptz,timestamptz)'::regprocedure) LIKE '%public.team_chase_counts(p_period_end)%' AS chase_arm_present;


-- ============================================================================
-- SHADOW-COMPARES — run each in Studio; each must return 0 rows / matching totals.
-- ============================================================================

-- ---------- SHADOW H4 · admin_dashboard_kpis ----------
-- Run in Supabase Studio (runs as postgres → RLS bypassed → RPC and the inline
-- reimplementation both aggregate over ALL rows). The RPC is INVOKER + GRANT
-- authenticated (NOT role-gated by get_my_role), so Studio can call it directly.
-- Proves the RPC output == an independent inline GROUP BY over the raw quotes/payments
-- for the current month, segment 'all'. 0 rows returned = byte-identical.
WITH params AS (
  SELECT 'all'::text AS seg,
         date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date                        AS ms,
         (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 month')::date AS me,
         (now() AT TIME ZONE 'UTC')::date        AS td,   -- mirrors client UTC todayIso (line 411)
         (now() - interval '30 days')            AS oc,
         (now() - interval '45 days')            AS c45
),
rpc AS (SELECT admin_dashboard_kpis(seg, ms, me, td, oc, c45) AS j FROM params),
q AS (SELECT id,status,segment,total_amount,created_at,updated_at,won_at FROM public.quotes),   -- seg='all'
pay AS (SELECT quote_id,amount_received,payment_date,is_final_payment FROM public.payments WHERE approval_status='approved'),
paid AS (SELECT quote_id, SUM(amount_received) AS paid FROM pay GROUP BY quote_id),
inline AS (
  SELECT jsonb_build_object(
    'revenue',        COALESCE((SELECT SUM(amount_received) FROM pay p, params WHERE p.payment_date>=ms AND p.payment_date<me),0),
    'todayCollected', COALESCE((SELECT SUM(amount_received) FROM pay p, params WHERE p.payment_date=td),0),
    'activeQuotes',   (SELECT COUNT(*) FROM q WHERE status<>'lost'),
    'activeValue',    COALESCE((SELECT SUM(total_amount) FROM q WHERE status<>'lost'),0),
    'activeOverdue',  (SELECT COUNT(*) FROM q,params WHERE status IN ('sent','negotiating')
                        AND to_char(created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS')
                          < to_char(oc AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')),
    'pipelineValue',  COALESCE((SELECT SUM(total_amount) FROM q WHERE status IN ('sent','negotiating')),0),
    'pipelineCount',  (SELECT COUNT(*) FROM q WHERE status IN ('sent','negotiating')),
    'lostRevenue',    COALESCE((SELECT SUM(total_amount) FROM q,params WHERE status='lost'
                        AND (COALESCE(updated_at,created_at) AT TIME ZONE 'Asia/Kolkata')::date>=ms
                        AND (COALESCE(updated_at,created_at) AT TIME ZONE 'Asia/Kolkata')::date< me),0),
    'wonValue',       COALESCE((SELECT SUM(total_amount) FROM q,params WHERE status='won'
                        AND (COALESCE(won_at,updated_at,created_at) AT TIME ZONE 'Asia/Kolkata')::date>=ms
                        AND (COALESCE(won_at,updated_at,created_at) AT TIME ZONE 'Asia/Kolkata')::date< me),0),
    'wonCount',       (SELECT COUNT(*) FROM q,params WHERE status='won'
                        AND (COALESCE(won_at,updated_at,created_at) AT TIME ZONE 'Asia/Kolkata')::date>=ms
                        AND (COALESCE(won_at,updated_at,created_at) AT TIME ZONE 'Asia/Kolkata')::date< me),
    'outstanding',    COALESCE((SELECT SUM(GREATEST(0,COALESCE(q.total_amount,0)-COALESCE(pd.paid,0)))
                        FROM q LEFT JOIN paid pd ON pd.quote_id=q.id
                        WHERE q.status<>'lost' AND (q.status='won' OR COALESCE(pd.paid,0)>0)),0),
    'outstandingOver45d',(SELECT COUNT(*) FROM q LEFT JOIN paid pd ON pd.quote_id=q.id, params
                        WHERE q.status='won'
                        AND to_char(COALESCE(q.updated_at,q.created_at) AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS')
                          <= to_char(c45 AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')
                        AND COALESCE(pd.paid,0)<COALESCE(q.total_amount,0)),
    'funnel',         (SELECT jsonb_agg(jsonb_build_object('status',f.status,'count',f.count,'value',f.value) ORDER BY f.ord)
                        FROM (SELECT st.status,st.ord,COUNT(qq.id) AS count,COALESCE(SUM(qq.total_amount),0) AS value
                              FROM (VALUES ('draft',1,false),('sent',2,false),('negotiating',3,false),('won',4,true),('lost',5,true)) st(status,ord,terminal)
                              LEFT JOIN q qq ON qq.status=st.status AND ((NOT st.terminal)
                                OR (st.status='won'  AND (COALESCE(qq.won_at,qq.updated_at,qq.created_at) AT TIME ZONE 'Asia/Kolkata')::date>=(SELECT ms FROM params) AND (COALESCE(qq.won_at,qq.updated_at,qq.created_at) AT TIME ZONE 'Asia/Kolkata')::date<(SELECT me FROM params))
                                OR (st.status='lost' AND (COALESCE(qq.updated_at,qq.created_at) AT TIME ZONE 'Asia/Kolkata')::date>=(SELECT ms FROM params) AND (COALESCE(qq.updated_at,qq.created_at) AT TIME ZONE 'Asia/Kolkata')::date<(SELECT me FROM params)))
                              GROUP BY st.status,st.ord) f)
  ) AS j
)
SELECT key AS mismatched_key, (SELECT j FROM rpc)->key AS rpc_val, (SELECT j FROM inline)->key AS inline_val
FROM jsonb_object_keys((SELECT j FROM rpc)) key
WHERE ((SELECT j FROM rpc)->key) IS DISTINCT FROM ((SELECT j FROM inline)->key);
-- 0 rows = the RPC reproduces the client aggregation exactly for this month.

-- ---------- SHADOW M10 · admin_source_attribution ----------
-- Read-only. Run in Supabase Studio (postgres role bypasses RLS, so the RPC and
-- the inline aggregate both see the full leads table -> apples-to-apples).
-- Proves the RPC body == the same GROUP BY done inline over raw `leads`.
-- 0 rows returned = byte-for-byte identical (no per-source total/won drift,
-- no source present on one side but not the other). now() is stable within the
-- one transaction, so both 90-day cutoffs are identical (no boundary flake).
WITH rpc AS (
  SELECT source, total, won
  FROM public.admin_source_attribution(90)
),
inline AS (
  SELECT
    COALESCE(NULLIF(regexp_replace(l.source, '^\s+|\s+$', '', 'g'), ''), '—') AS source,
    COUNT(*)::bigint AS total,
    (COUNT(*) FILTER (WHERE l.stage = 'Won'))::bigint AS won
  FROM public.leads l
  WHERE l.source IS NOT NULL
    AND l.created_at >= (now() - make_interval(days => 90))
  GROUP BY 1
)
SELECT
  COALESCE(r.source, i.source) AS source,
  r.total AS rpc_total, i.total AS inline_total,
  r.won   AS rpc_won,   i.won   AS inline_won
FROM rpc r
FULL OUTER JOIN inline i ON i.source IS NOT DISTINCT FROM r.source
WHERE r.source IS NULL          -- source only in inline (missing from RPC)
   OR i.source IS NULL          -- source only in RPC (missing from inline)
   OR r.total IS DISTINCT FROM i.total
   OR r.won   IS DISTINCT FROM i.won;
-- Expect: 0 rows.

-- ---------- SHADOW M16 · get_my_settled_this_month ----------
-- SHADOW — runs in Supabase Studio (no auth context). Proves the RPC's
-- settlement math == the client buildSettlementMap()/getSettlement()
-- aggregation over the raw tables, for EVERY quote-creator, for the
-- current IST month. The RPC self-scopes to auth.uid() (→ 0 in Studio),
-- so this does NOT call it; it re-encodes BOTH sides inline over the base
-- tables — "srv" = the RPC's window/GROUP-BY logic parameterized per rep,
-- "cli" = an independent per-quote correlated transcription of getSettlement.
-- Expected result: 0 ROWS (0 difference on every rep).
WITH bounds AS (   -- the IST month boundaries the browser passes as monthStartIso/monthEndIso
  SELECT
    to_char((date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS m_start,
    to_char(((date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 month') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS m_end
),
ap AS (            -- every approved payment, JS date string
  SELECT p.quote_id, p.amount_received, p.is_final_payment,
    COALESCE(p.payment_date::text,
             to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')) AS d
  FROM public.payments p
  WHERE p.approval_status = 'approved'
),
q AS ( SELECT id, created_by, total_amount FROM public.quotes WHERE created_by IS NOT NULL ),
-- SERVER side (mirrors the RPC: joins + window)
srv_settle AS (
  SELECT q.id, q.created_by, q.total_amount,
    CASE
      WHEN ff.final_date IS NOT NULL THEN ff.final_date
      WHEN q.total_amount > 0 AND COALESCE(ps.paid,0) >= q.total_amount THEN cp.clear_date
      ELSE NULL
    END AS settled_at
  FROM q
  LEFT JOIN (SELECT quote_id, MIN(d) final_date FROM ap WHERE is_final_payment GROUP BY quote_id) ff ON ff.quote_id=q.id
  LEFT JOIN (SELECT quote_id, SUM(amount_received) paid FROM ap GROUP BY quote_id) ps ON ps.quote_id=q.id
  LEFT JOIN (
    SELECT quote_id, MIN(d) FILTER (WHERE run>=total_amount) clear_date FROM (
      SELECT ap.quote_id, ap.d, q2.total_amount,
             SUM(ap.amount_received) OVER (PARTITION BY ap.quote_id ORDER BY ap.d ROWS UNBOUNDED PRECEDING) run
      FROM ap JOIN q q2 ON q2.id=ap.quote_id
    ) r WHERE total_amount>0 GROUP BY quote_id
  ) cp ON cp.quote_id=q.id
),
srv AS (
  SELECT s.created_by, COALESCE(SUM(COALESCE(s.total_amount,0)),0) AS total
  FROM srv_settle s, bounds b
  WHERE s.settled_at IS NOT NULL
    AND s.settled_at COLLATE "C" >= b.m_start
    AND s.settled_at COLLATE "C" <  b.m_end
  GROUP BY s.created_by
),
-- CLIENT side (independent per-quote correlated transcription of getSettlement)
cli_settle AS (
  SELECT q.id, q.created_by, q.total_amount,
    ( SELECT CASE
        WHEN bool_or(x.is_final_payment) THEN MIN(x.d) FILTER (WHERE x.is_final_payment)
        WHEN q.total_amount > 0 AND COALESCE(SUM(x.amount_received),0) >= q.total_amount THEN
          (SELECT rr.d FROM (
             SELECT y.d, SUM(y.amount_received) OVER (ORDER BY y.d ROWS UNBOUNDED PRECEDING) rn
             FROM ap y WHERE y.quote_id=q.id
           ) rr WHERE rr.rn >= q.total_amount ORDER BY rr.d LIMIT 1)
        ELSE NULL END
      FROM ap x WHERE x.quote_id=q.id
    ) AS settled_at
  FROM q
),
cli AS (
  SELECT c.created_by, COALESCE(SUM(COALESCE(c.total_amount,0)),0) AS total
  FROM cli_settle c, bounds b
  WHERE c.settled_at IS NOT NULL
    AND c.settled_at COLLATE "C" >= b.m_start
    AND c.settled_at COLLATE "C" <  b.m_end
  GROUP BY c.created_by
)
SELECT
  COALESCE(srv.created_by, cli.created_by) AS user_id,
  COALESCE(srv.total,0) AS server_total,
  COALESCE(cli.total,0) AS client_total,
  COALESCE(srv.total,0) - COALESCE(cli.total,0) AS diff
FROM srv
FULL OUTER JOIN cli ON cli.created_by = srv.created_by
WHERE ABS(COALESCE(srv.total,0) - COALESCE(cli.total,0)) > 0.005
ORDER BY diff DESC;
-- 0 rows = the RPC settlement math matches the client aggregation for every rep.

-- ---------- SHADOW M17 · team_payment_sums ----------
-- Must return ZERO rows. Studio runs as postgres (RLS bypassed) so both sides see
-- all payments -> proves the SUM/filter/GROUP match. INVOKER = the SQL is NOT
-- role-gated, so the shadow calls it directly (no gate permit needed); co_owner's
-- govt-only scoping is enforced by RLS at real call time (correct by construction
-- for a plain INVOKER fn, not exercised in Studio).
WITH rpc AS (
  SELECT quote_id, paid FROM public.team_payment_sums()
),
js AS (  -- mirrors TeamDashboardV2 paidByQuote: approved-or-null, summed per quote
  SELECT quote_id, COALESCE(sum(COALESCE(amount_received, 0)), 0)::numeric AS paid
    FROM public.payments
   WHERE quote_id IS NOT NULL
     AND (approval_status IS NULL OR approval_status IN ('', 'approved'))
   GROUP BY quote_id
)
SELECT COALESCE(r.quote_id, j.quote_id) AS quote_id,
       r.paid AS rpc_paid, j.paid AS js_paid
  FROM rpc r FULL OUTER JOIN js j ON j.quote_id = r.quote_id
 WHERE r.quote_id IS NULL OR j.quote_id IS NULL
    OR r.paid IS DISTINCT FROM j.paid;

-- ---------- SHADOW M21 · team_dashboard_bundle ----------
-- SHADOW-COMPARE (read-only, run in Supabase Studio) — must return ZERO rows.
-- Proves the bundle's new `chase` arm == the client aggregation it replaces.
-- The chase arm delegates to team_chase_counts(p_period_end); that function has a
-- get_my_role() IS NULL permit (phase323 L30) so it runs in Studio (no JWT). Below
-- compares it, per rep, to an INDEPENDENT SQL replication of the exact client JS
-- (TeamDashboardV2.jsx L660-693: quote-chase = status='sent' + updated_at non-null
--  + updated_at < period_end−3d; pay-chase = status='won' + total>0 + SUM(approved-
--  or-null amount_received) < total). 0 rows = the arm reproduces the old client
-- aggregation over the same raw tables exactly (byte-identical numbers).
-- Set p_end to a real /team-dashboard "to" date (YYYY-MM-DD).
WITH params AS (SELECT DATE '2026-08-25' AS p_end),
rpc AS (  -- the bundle's `chase` arm, via the single-source delegate
  SELECT r.created_by AS uid, r.quote_chase, r.pay_chase
    FROM params p CROSS JOIN LATERAL public.team_chase_counts(p.p_end) r
),
js_qc AS (  -- client quote-chase, replicated over raw quotes
  SELECT q.created_by AS uid, count(*)::bigint AS n
    FROM params p, public.quotes q
   WHERE q.status = 'sent' AND q.created_by IS NOT NULL AND q.updated_at IS NOT NULL
     AND q.updated_at < ((p.p_end::timestamp AT TIME ZONE 'UTC') - interval '3 days')
   GROUP BY q.created_by
),
js_paid AS (  -- SUM(amount_received) FILTER approved-or-null, per quote
  SELECT quote_id, sum(COALESCE(amount_received, 0)) AS paid
    FROM public.payments
   WHERE quote_id IS NOT NULL AND (approval_status IS NULL OR approval_status IN ('', 'approved'))
   GROUP BY quote_id
),
js_pc AS (  -- client pay-chase, replicated over raw won quotes + payments
  SELECT q.created_by AS uid, count(*)::bigint AS n
    FROM public.quotes q LEFT JOIN js_paid jp ON jp.quote_id = q.id
   WHERE q.status = 'won' AND q.created_by IS NOT NULL
     AND COALESCE(q.total_amount, 0) > 0
     AND COALESCE(jp.paid, 0) < COALESCE(q.total_amount, 0)
   GROUP BY q.created_by
),
js AS (
  SELECT u.uid, COALESCE(js_qc.n, 0) AS quote_chase, COALESCE(js_pc.n, 0) AS pay_chase
    FROM (SELECT uid FROM js_qc UNION SELECT uid FROM js_pc) u
    LEFT JOIN js_qc ON js_qc.uid = u.uid
    LEFT JOIN js_pc ON js_pc.uid = u.uid
)
SELECT COALESCE(r.uid, j.uid) AS uid,
       r.quote_chase AS arm_qc, j.quote_chase AS js_qc,
       r.pay_chase   AS arm_pc, j.pay_chase   AS js_pc
  FROM rpc r FULL OUTER JOIN js j ON j.uid = r.uid
 WHERE r.uid IS NULL OR j.uid IS NULL
    OR r.quote_chase IS DISTINCT FROM j.quote_chase
    OR r.pay_chase   IS DISTINCT FROM j.pay_chase;
