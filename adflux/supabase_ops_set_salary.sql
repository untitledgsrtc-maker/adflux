-- supabase_ops_set_salary.sql — set an ops exec's monthly_salary so the uptime
-- pay card shows base/variable ₹ (the card splits 70% base / 30% variable, the
-- variable driven by uptime). Fill <EXEC EMAIL>. Idempotent.
--
-- ⚠ MONEY: keep this on the TEST exec for now. Do NOT set a real exec's salary
-- until you've watched a few real uptime days (the curve is the tunable 90->97
-- from p4 Part 3). A real salary + real uptime => real pay via compute_monthly_salary.

INSERT INTO public.staff_incentive_profiles (user_id, monthly_salary)
SELECT id, 18000
  FROM public.users
 WHERE lower(email) = lower('<EXEC EMAIL>') AND role = 'operation_executive'
ON CONFLICT (user_id) DO UPDATE SET monthly_salary = EXCLUDED.monthly_salary;

-- VERIFY
SELECT u.name, u.email, sip.monthly_salary
  FROM public.staff_incentive_profiles sip
  JOIN public.users u ON u.id = sip.user_id
 WHERE u.role = 'operation_executive'
 ORDER BY u.name;
