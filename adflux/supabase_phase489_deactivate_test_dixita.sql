-- supabase_phase489_deactivate_test_dixita.sql
-- Phase 489 (owner 23 Oct 2026): dixita@untitledad.in (operation_head) was a TEST account - taken out of use.
-- Deactivated, NOT deleted (reversible). Backup row in _bak_users_p489. UNDO: UPDATE users SET is_active = true WHERE email = 'dixita@untitledad.in';
CREATE TABLE IF NOT EXISTS public._bak_users_p489 AS SELECT * FROM public.users WHERE email = 'dixita@untitledad.in';
UPDATE public.users SET is_active = false WHERE email = 'dixita@untitledad.in' AND role = 'operation_head' AND name = 'Dixita';
DELETE FROM public.work_members WHERE user_id = (SELECT id FROM public.users WHERE email = 'dixita@untitledad.in');
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT is_active FROM users WHERE email='dixita@untitledad.in'; -> false
