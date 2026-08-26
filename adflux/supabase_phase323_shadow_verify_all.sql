-- ============================================================================
-- supabase_phase323_shadow_verify_all.sql  (Phase 323)
-- ONE combined verifier for the 5 dashboard aggregation RPCs. Run the WHOLE file
-- in Supabase Studio AFTER the RPCs are created (creation file's Pass 1).
--   * "No rows returned" = ALL 5 RPCs match the current client numbers byte-for-
--                          byte -> safe to wire the frontends.
--   * ANY row            = that finding's RPC disagrees; the `detail` json is the
--                          exact diff. Paste it back.
-- ============================================================================

SELECT 'H4' AS finding, 'admin_dashboard_kpis' AS rpc, to_jsonb(z)::text AS detail
FROM (
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
WHERE ((SELECT j FROM rpc)->key) IS DISTINCT FROM ((SELECT j FROM inline)->key)
) z

UNION ALL

SELECT 'M10' AS finding, 'admin_source_attribution' AS rpc, to_jsonb(z)::text AS detail
FROM (
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
-- both sides' `source` is non-null (RPC filters NULL + normalizes empty -> '—'),
-- so a plain equijoin is correct AND hash/merge-joinable (IS NOT DISTINCT FROM is
-- NOT joinable in a FULL JOIN -> Postgres 0A000).
FULL OUTER JOIN inline i ON i.source = r.source
WHERE r.source IS NULL          -- source only in inline (missing from RPC)
   OR i.source IS NULL          -- source only in RPC (missing from inline)
   OR r.total IS DISTINCT FROM i.total
   OR r.won   IS DISTINCT FROM i.won
) z

UNION ALL

SELECT 'M16' AS finding, 'get_my_settled_this_month' AS rpc, to_jsonb(z)::text AS detail
FROM (
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
ORDER BY diff DESC
) z

UNION ALL

SELECT 'M17' AS finding, 'team_payment_sums' AS rpc, to_jsonb(z)::text AS detail
FROM (
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
    OR r.paid IS DISTINCT FROM j.paid
) z

UNION ALL

SELECT 'M21' AS finding, 'team_dashboard_bundle' AS rpc, to_jsonb(z)::text AS detail
FROM (
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
    OR r.pay_chase   IS DISTINCT FROM j.pay_chase
) z
;
