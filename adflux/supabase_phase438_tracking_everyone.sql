-- Phase 438 (owner 2026-10-22: "all rule will be same like Safika for using the app"):
-- switch Activity tracking ON for every active Work member except admins (the owner). Same as the Team Work > Activity switch, one row per person.
-- Each person still has to accept the notice on first launch of the Windows app before anything is recorded (consent_at).
-- Records ONLY while a timer runs: program + window title + idle per minute, a screenshot every 10 min, the "Still working?" question; kept 30 days.
-- Idempotent. UNDO: UPDATE public.work_tracking_people SET enabled=false WHERE user_id <> '541a127a-09f1-45b8-ad5c-e0bfb4fdc0af';  (that id = Safika)
INSERT INTO public.work_tracking_people (user_id, enabled, changed_by, changed_at)
SELECT m.user_id, true, (SELECT id FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1), now()
  FROM public.work_members m JOIN public.users u ON u.id = m.user_id
 WHERE u.is_active AND u.role <> 'admin'
ON CONFLICT (user_id) DO UPDATE SET enabled = true, changed_at = now();
-- VERIFY: select count(*) from work_tracking_people where enabled;  -- = Safika + every other active non-admin member
