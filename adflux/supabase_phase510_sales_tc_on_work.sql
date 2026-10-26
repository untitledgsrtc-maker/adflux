-- Phase 510: owner 26 Oct 2026 - sales + telecaller get the SAME My Work as the Work team
-- (timer, board, calendar, hours). Reverses Phase 471/472 for the active sales + telecaller people.
-- UNDO: DELETE FROM public.work_members WHERE user_id IN (SELECT id FROM public.users WHERE role IN ('sales','telecaller'));
SELECT set_config('app.work_member_manual', '1', false);
INSERT INTO public.work_members (user_id, is_head, added_by)
SELECT u.id, false, (SELECT id FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1)
FROM public.users u WHERE u.is_active AND u.role IN ('sales','telecaller')
ON CONFLICT (user_id) DO NOTHING;
SELECT count(*) AS sales_tc_members FROM public.work_members m JOIN public.users u ON u.id=m.user_id WHERE u.role IN ('sales','telecaller');
