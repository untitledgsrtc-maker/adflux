-- Phase 606 — Sales head Devang meetings target back to 5 (owner 18-11-2026: same 5-meeting rule as all reps).
-- Reverses only the meetings part of Phase 605; new_leads stays 10, calls stay 20.
-- Re-scores his November days so the month average uses 5.
UPDATE public.users
   SET daily_targets = coalesce(daily_targets, '{}'::jsonb) || '{"meetings": 5}'::jsonb
 WHERE id = '98c7c578-1426-4ab6-916d-e79a89bef9bd';

SELECT public.compute_daily_score('98c7c578-1426-4ab6-916d-e79a89bef9bd', d::date)
  FROM generate_series(date '2026-11-16', (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') d
 WHERE EXISTS (SELECT 1 FROM daily_performance p WHERE p.user_id = '98c7c578-1426-4ab6-916d-e79a89bef9bd' AND p.work_date = d::date);

-- VERIFY:
SELECT daily_targets FROM users WHERE id='98c7c578-1426-4ab6-916d-e79a89bef9bd';   -- meetings 5, new_leads 10
SELECT work_date, score_pct FROM daily_performance WHERE user_id='98c7c578-1426-4ab6-916d-e79a89bef9bd' ORDER BY 1;
