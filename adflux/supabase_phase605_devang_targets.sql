-- Phase 605 — Sales head Devang daily targets (owner 18-11-2026): 3 meetings, 10 new leads
-- Sales branch of compute_daily_score + /work + Team Live + My Team read users.daily_targets
-- (JSONB). Calls stay 20. His November days (joined 16 Nov, month not paid yet) are re-scored
-- with the new target so the month average is consistent. Applies to Devang only.
UPDATE public.users
   SET daily_targets = coalesce(daily_targets, '{}'::jsonb) || '{"meetings": 3, "new_leads": 10}'::jsonb
 WHERE id = '98c7c578-1426-4ab6-916d-e79a89bef9bd';

SELECT public.compute_daily_score('98c7c578-1426-4ab6-916d-e79a89bef9bd', d::date)
  FROM generate_series(date '2026-11-16', (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') d
 WHERE EXISTS (SELECT 1 FROM daily_performance p WHERE p.user_id = '98c7c578-1426-4ab6-916d-e79a89bef9bd' AND p.work_date = d::date);

-- VERIFY:
-- SELECT daily_targets FROM users WHERE id='98c7c578-1426-4ab6-916d-e79a89bef9bd';   -- meetings 3, new_leads 10
-- SELECT work_date, score_pct FROM daily_performance WHERE user_id='98c7c578-1426-4ab6-916d-e79a89bef9bd' ORDER BY 1;
