-- supabase_phase482_dhara_5oct_waive.sql
-- Phase 482 (owner 23 Oct 2026): Dhara's 5 Oct half-day waived (first call 10:13, "Good morning" 10:14; only the app swipe was 14:12).
-- Her one day only. Her 7 Oct half-day stands. Backup row kept in _bak_work_sessions_p482.
CREATE TABLE IF NOT EXISTS public._bak_work_sessions_p482 AS
  SELECT w.* FROM public.work_sessions w JOIN public.users u ON u.id = w.user_id
   WHERE u.name = 'Dhara' AND u.role = 'telecaller' AND w.work_date = '2026-10-05';

UPDATE public.work_sessions w
   SET check_in_status = 'on_time',
       late_reason = COALESCE(late_reason, 'Half-day waived by owner 23 Oct 2026: working from 10:13 (first call), app swipe was 14:12')
  FROM public.users u
 WHERE u.id = w.user_id AND u.name = 'Dhara' AND u.role = 'telecaller'
   AND w.work_date = '2026-10-05' AND w.check_in_status = 'half_day';

NOTIFY pgrst, 'reload schema';
-- VERIFY: salary late_half_days for Dhara Oct = 0.5, unpaid_deduction = 2212, net_payable = 21838
