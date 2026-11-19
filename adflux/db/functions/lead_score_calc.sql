-- ============================================================================
-- db/functions/lead_score_calc.sql - CANONICAL HOME (section 71)
-- ============================================================================
-- Phase 625 (19-11-2026, owner-approved formula). Lead score 0-100 per lead.
--   Stage:            New 5 · Working 20 · QuoteSent 35 · Nurture 10    (max 35)
--   Talked, 7 days:   call with a saved outcome, call >= 10 s (not missed),
--                     a done meeting / site visit, or a WhatsApp reply      20
--   Meeting / interested: sales lead = a done meeting or site visit;
--                     telecaller lead (telecaller_id set or owner role telecaller)
--                     = a done meeting OR a call with outcome 'positive'     15
--   Follow-ups on time: share of the last 5 DUE follow-ups done on/before their
--                     day (auto-closed "rep called this lead again" counts as on
--                     time; system-cancelled rows are ignored)              30
--   Overdue:          any open follow-up past its day                     -15
--   Won = 100, Lost = 0. Clamped 0..100.
-- "Done meeting" uses the section 33 exclusions (auto-check-in companion rows and
-- "Meeting scheduled" rows are NOT meetings).
-- p_ids NULL = every lead. Read-only. Writes happen in recompute_lead_scores().
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lead_score_calc(p_ids uuid[])
 RETURNS TABLE(lead_id uuid, score integer, parts jsonb)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH d AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today),
  l AS (
    SELECT ld.id, ld.stage, ld.telecaller_id,
           COALESCE(ld.assigned_to, ld.telecaller_id, ld.created_by) AS owner
      FROM public.leads ld
     WHERE p_ids IS NULL OR ld.id = ANY (p_ids)
  ),
  x AS (
    SELECT l.id, l.stage,
      CASE l.stage WHEN 'New' THEN 5 WHEN 'Working' THEN 20 WHEN 'QuoteSent' THEN 35 WHEN 'Nurture' THEN 10 ELSE 0 END AS stage_pts,
      (   EXISTS (SELECT 1 FROM public.lead_activities a
                   WHERE a.lead_id = l.id AND a.created_at >= now() - interval '7 days'
                     AND (   (a.activity_type = 'call' AND a.outcome IS NOT NULL)
                          OR (a.activity_type IN ('meeting', 'site_visit')
                              AND COALESCE(a.notes, '') NOT LIKE 'I''m here · auto-check-in%'
                              AND COALESCE(a.notes, '') NOT LIKE 'Meeting scheduled%')))
       OR EXISTS (SELECT 1 FROM public.call_logs c
                   WHERE c.lead_id = l.id AND COALESCE(c.call_at, c.created_at) >= now() - interval '7 days'
                     AND c.duration_seconds >= 10 AND COALESCE(c.direction, '') <> 'missed')
       OR EXISTS (SELECT 1 FROM public.whatsapp_conversations w
                   WHERE w.lead_id = l.id AND w.last_inbound_at >= now() - interval '7 days')
      ) AS talked,
      EXISTS (SELECT 1 FROM public.lead_activities a
               WHERE a.lead_id = l.id AND a.activity_type IN ('meeting', 'site_visit')
                 AND COALESCE(a.notes, '') NOT LIKE 'I''m here · auto-check-in%'
                 AND COALESCE(a.notes, '') NOT LIKE 'Meeting scheduled%') AS met,
      (   (l.telecaller_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = l.owner AND u.role = 'telecaller'))
      AND EXISTS (SELECT 1 FROM public.lead_activities a
                   WHERE a.lead_id = l.id AND a.activity_type = 'call' AND a.outcome = 'positive')
      ) AS interested,
      f.due_n, f.ontime_n,
      EXISTS (SELECT 1 FROM public.follow_ups o
               WHERE o.lead_id = l.id AND o.is_done = false AND o.follow_up_date < d.today) AS overdue
    FROM l CROSS JOIN d
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS due_n,
             count(*) FILTER (WHERE r.is_done AND (
                 r.done_at IS NULL
              OR (r.done_at AT TIME ZONE 'Asia/Kolkata')::date <= r.follow_up_date
              OR COALESCE(r.done_note, '') LIKE 'Auto-closed: rep called%'))::int AS ontime_n
        FROM (SELECT fu.is_done, fu.done_at, fu.done_note, fu.follow_up_date
                FROM public.follow_ups fu
               WHERE fu.lead_id = l.id AND fu.follow_up_date <= d.today
                 AND COALESCE(fu.note, '') NOT LIKE '%[cancelled by stage change]%'
                 AND COALESCE(fu.note, '') NOT LIKE '%[auto-skipped%'
                 AND COALESCE(fu.note, '') NOT LIKE '%[closed: auto follow-ups paused]%'
                 AND COALESCE(fu.done_note, '') NOT LIKE 'Auto-closed: lead is%'
                 AND COALESCE(fu.done_note, '') NOT LIKE 'Auto-closed: quote%'
                 AND COALESCE(fu.done_note, '') NOT LIKE '%[auto-closed: lead marked%'
               ORDER BY fu.follow_up_date DESC
               LIMIT 5) r
    ) f ON true
  ),
  p AS (
    SELECT x.*,
      CASE WHEN talked THEN 20 ELSE 0 END AS talked_pts,
      CASE WHEN met OR interested THEN 15 ELSE 0 END AS meet_pts,
      CASE WHEN due_n > 0 THEN round(30.0 * ontime_n / due_n)::int ELSE 0 END AS ontime_pts,
      CASE WHEN overdue THEN 15 ELSE 0 END AS overdue_pts
    FROM x
  )
  SELECT p.id,
    CASE WHEN p.stage = 'Won' THEN 100
         WHEN p.stage = 'Lost' THEN 0
         ELSE GREATEST(0, LEAST(100, p.stage_pts + p.talked_pts + p.meet_pts + p.ontime_pts - p.overdue_pts)) END,
    jsonb_build_object(
      'stage', p.stage_pts, 'talked', p.talked_pts, 'meet', p.meet_pts,
      'meet_kind', CASE WHEN p.met THEN 'meeting' WHEN p.interested THEN 'interested' END,
      'ontime', p.ontime_pts, 'due_n', p.due_n, 'ontime_n', p.ontime_n,
      'overdue', -p.overdue_pts)
  FROM p;
$function$;

REVOKE ALL ON FUNCTION public.lead_score_calc(uuid[]) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- VERIFY: SELECT score FROM public.lead_score_calc(ARRAY['c0bb5823-00ab-446d-99b4-795dd935d4b1'::uuid]);  -- 70 on 19-11-2026 (Balar Medicine)
