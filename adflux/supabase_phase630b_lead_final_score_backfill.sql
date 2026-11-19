-- Phase 630 part 2: backfill final_score for leads already Won/Lost (see supabase_phase630_lead_final_score.sql).
BEGIN;
WITH t AS (
  SELECT l.id, l.stage AS final_stage, l.telecaller_id,
         COALESCE(l.assigned_to, l.telecaller_id, l.created_by) AS owner,
         s.changed_at AS at_ts, s.old_stage
    FROM public.leads l
    JOIN LATERAL (SELECT changed_at, old_stage FROM public.lead_stage_log x
                   WHERE x.lead_id = l.id AND x.new_stage = l.stage ORDER BY changed_at DESC LIMIT 1) s ON true
   WHERE l.stage IN ('Won', 'Lost')
), u AS (
  SELECT t.*, (t.at_ts AT TIME ZONE 'Asia/Kolkata')::date AS at_day,
    COALESCE(t.old_stage,
      CASE WHEN EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = t.id AND q.created_at <= t.at_ts) THEN 'QuoteSent'
           WHEN EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = t.id AND a.created_at <= t.at_ts) THEN 'Working'
           ELSE 'New' END) AS prior
    FROM t
), x AS (
  SELECT u.id, u.at_ts,
    CASE u.prior WHEN 'New' THEN 5 WHEN 'Working' THEN 20 WHEN 'QuoteSent' THEN 35 WHEN 'Nurture' THEN 10 ELSE 0 END AS stage_pts,
    (   EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = u.id
                 AND a.created_at BETWEEN u.at_ts - interval '7 days' AND u.at_ts
                 AND ((a.activity_type = 'call' AND a.outcome IS NOT NULL)
                   OR (a.activity_type IN ('meeting','site_visit') AND COALESCE(a.notes,'') NOT LIKE 'I''m here · auto-check-in%' AND COALESCE(a.notes,'') NOT LIKE 'Meeting scheduled%')))
     OR EXISTS (SELECT 1 FROM public.call_logs c WHERE c.lead_id = u.id
                 AND COALESCE(c.call_at, c.created_at) BETWEEN u.at_ts - interval '7 days' AND u.at_ts
                 AND c.duration_seconds >= 10 AND COALESCE(c.direction,'') <> 'missed')) AS talked,
    EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = u.id AND a.created_at <= u.at_ts
             AND a.activity_type IN ('meeting','site_visit')
             AND COALESCE(a.notes,'') NOT LIKE 'I''m here · auto-check-in%' AND COALESCE(a.notes,'') NOT LIKE 'Meeting scheduled%') AS met,
    (   (u.telecaller_id IS NOT NULL OR (SELECT r.role FROM public.users r WHERE r.id = u.owner) = 'telecaller')
    AND EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = u.id AND a.created_at <= u.at_ts
                 AND a.activity_type = 'call' AND a.outcome = 'positive')) AS interested,
    f.due_n, f.ontime_n,
    EXISTS (SELECT 1 FROM public.follow_ups o WHERE o.lead_id = u.id AND o.follow_up_date < u.at_day
             AND o.created_at <= u.at_ts
             AND (o.is_done = false OR o.done_at >= u.at_ts - interval '5 minutes')
             AND COALESCE(o.note,'') NOT LIKE '%[cancelled by stage change]%') AS overdue
  FROM u
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS due_n,
           count(*) FILTER (WHERE r.is_done AND r.done_at < u.at_ts - interval '5 minutes' AND (
               (r.done_at AT TIME ZONE 'Asia/Kolkata')::date <= r.follow_up_date
            OR COALESCE(r.done_note,'') LIKE 'Auto-closed: rep called%'))::int AS ontime_n
      FROM (SELECT fu.is_done, fu.done_at, fu.done_note, fu.follow_up_date FROM public.follow_ups fu
             WHERE fu.lead_id = u.id AND fu.follow_up_date <= u.at_day AND fu.created_at <= u.at_ts
               AND COALESCE(fu.note,'') NOT LIKE '%[cancelled by stage change]%'
               AND COALESCE(fu.note,'') NOT LIKE '%[auto-skipped%'
               AND COALESCE(fu.note,'') NOT LIKE '%[closed: auto follow-ups paused]%'
             ORDER BY fu.follow_up_date DESC LIMIT 5) r
  ) f ON true
)
UPDATE public.lead_scores ls
   SET final_score = GREATEST(0, LEAST(100, x.stage_pts
                       + CASE WHEN x.talked THEN 20 ELSE 0 END
                       + CASE WHEN x.met OR x.interested THEN 15 ELSE 0 END
                       + CASE WHEN x.due_n > 0 THEN round(30.0 * x.ontime_n / x.due_n)::int ELSE 0 END
                       - CASE WHEN x.overdue THEN 15 ELSE 0 END)),
       final_at = x.at_ts,
       final_estimated = true
  FROM x
 WHERE ls.lead_id = x.id AND ls.final_score IS NULL;
COMMIT;

-- refresh so every row's parts gains lead_stage (frozen values are kept by COALESCE)
SELECT public.recompute_lead_scores(NULL);
NOTIFY pgrst, 'reload schema';

-- VERIFY:
SELECT count(*) FILTER (WHERE l.stage IN ('Won','Lost')) AS terminal,
       count(*) FILTER (WHERE l.stage IN ('Won','Lost') AND s.final_score IS NULL) AS terminal_without_final,   -- ~0
       round(avg(s.final_score) FILTER (WHERE l.stage = 'Lost')) AS avg_lost_final,
       (SELECT final_score FROM public.lead_scores WHERE lead_id = 'a5d9cfa4-9a36-4aba-9429-b788f1f62264') AS sample
  FROM public.leads l JOIN public.lead_scores s ON s.lead_id = l.id;
