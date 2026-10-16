-- Blast radius for testope1 as a RESULT GRID (paste this back).
-- Any row with n > 0 is data PART 2 would delete. Business tables
-- (leads / quotes / payments / hr_offers) matter most — expect 0 there.
WITH u AS (SELECT id FROM public.users WHERE email = 'testope1@untitledad.in')
SELECT 'call_logs (user_id)'            AS ref, count(*) n FROM public.call_logs         WHERE user_id     = (SELECT id FROM u)
UNION ALL SELECT 'gps_pings (user_id)',            count(*) FROM public.gps_pings         WHERE user_id     = (SELECT id FROM u)
UNION ALL SELECT 'work_sessions (user_id)',        count(*) FROM public.work_sessions     WHERE user_id     = (SELECT id FROM u)
UNION ALL SELECT 'lead_activities (created_by)',   count(*) FROM public.lead_activities   WHERE created_by  = (SELECT id FROM u)
UNION ALL SELECT 'follow_ups (assigned_to)',       count(*) FROM public.follow_ups        WHERE assigned_to = (SELECT id FROM u)
UNION ALL SELECT 'daily_ta (user_id)',             count(*) FROM public.daily_ta          WHERE user_id     = (SELECT id FROM u)
UNION ALL SELECT 'daily_performance (user_id)',    count(*) FROM public.daily_performance WHERE user_id     = (SELECT id FROM u)
UNION ALL SELECT 'ops_tickets (assigned_to)',      count(*) FROM public.ops_tickets       WHERE assigned_to = (SELECT id FROM u)
UNION ALL SELECT 'ops_depots (assigned_to)',       count(*) FROM public.ops_depots        WHERE assigned_to = (SELECT id FROM u)
UNION ALL SELECT 'leads (assigned_to)',            count(*) FROM public.leads             WHERE assigned_to = (SELECT id FROM u)
UNION ALL SELECT 'leads (telecaller_id)',          count(*) FROM public.leads             WHERE telecaller_id = (SELECT id FROM u)
UNION ALL SELECT 'leads (created_by)',             count(*) FROM public.leads             WHERE created_by  = (SELECT id FROM u)
UNION ALL SELECT 'quotes (created_by)',            count(*) FROM public.quotes            WHERE created_by  = (SELECT id FROM u)
ORDER BY n DESC;
