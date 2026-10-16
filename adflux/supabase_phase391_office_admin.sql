-- supabase_phase391_office_admin.sql
-- Phase 391 (owner 16 Oct 2026): new role OFFICE ADMIN (dixitagohel02@gmail.com / Dixita Gohel, offer already accepted).
-- She is NOT an admin. Responsibilities: government won-quote report submission, invoice submission, plus running the office
-- people-ops (leaves, TA/DA claims, team roster, attendance, daily check-in, Team Work).
-- Access = additive per-role policies (same pattern as leaves_hr_all / quotes_accounts_read). NO finance, P&L, Master,
-- salary sheet, incentive setup or payments. Quotes are READ-ONLY (no insert/update policy exists for her).
-- Idempotent. RUN ORDER: this file, THEN db/functions/work_daily_checkin.sql (canonical; it adds office_admin to the card function).

-- 1. role allowed on users
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'admin','sales','co_owner','agency','telecaller','office_staff','hr','accounts','staff',
  'operation_head','operation_executive','office_admin']));

-- 1b. team_role allowed on users (the designation below sends team_role='office_admin'; without this Add Member fails 23514)
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_team_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_team_role_check CHECK (team_role IS NULL OR team_role = ANY (ARRAY[
  'admin','government_partner','sales_manager','sales','telecaller','creative_lead','designer','video_editor',
  'ops_execution','accounts','hr','admin_staff','office_boy','agency','office_admin']));

-- 2. designation so HR "Add Member" can pick it (auth_role + team_role)
INSERT INTO public.designations (name, auth_role, team_role, display_order, is_active, notes)
SELECT 'Office Admin', 'office_admin', 'office_admin', 90, true, 'Phase 391: office people-ops + govt won-quote report / invoice submission. No finance.'
 WHERE NOT EXISTS (SELECT 1 FROM public.designations WHERE name = 'Office Admin');

-- 3. policies (additive)
DROP POLICY IF EXISTS leaves_office_admin_all ON public.leaves;
CREATE POLICY leaves_office_admin_all ON public.leaves FOR ALL TO authenticated
  USING (public.get_my_role() = 'office_admin') WITH CHECK (public.get_my_role() = 'office_admin');

DROP POLICY IF EXISTS ta_da_requests_office_admin_all ON public.ta_da_requests;
CREATE POLICY ta_da_requests_office_admin_all ON public.ta_da_requests FOR ALL TO authenticated
  USING (public.get_my_role() = 'office_admin') WITH CHECK (public.get_my_role() = 'office_admin');

DROP POLICY IF EXISTS users_office_admin_read ON public.users;
CREATE POLICY users_office_admin_read ON public.users FOR SELECT TO authenticated USING (public.get_my_role() = 'office_admin');

DROP POLICY IF EXISTS work_sessions_office_admin_read ON public.work_sessions;
CREATE POLICY work_sessions_office_admin_read ON public.work_sessions FOR SELECT TO authenticated USING (public.get_my_role() = 'office_admin');

DROP POLICY IF EXISTS daily_ta_office_admin_read ON public.daily_ta;
CREATE POLICY daily_ta_office_admin_read ON public.daily_ta FOR SELECT TO authenticated USING (public.get_my_role() = 'office_admin');

-- GOVERNMENT segment only (section 8 layer 3: she must not read PRIVATE quote money)
DROP POLICY IF EXISTS quotes_office_admin_read ON public.quotes;
CREATE POLICY quotes_office_admin_read ON public.quotes FOR SELECT TO authenticated
  USING (public.get_my_role() = 'office_admin' AND segment = 'GOVERNMENT');

-- the media lines of those government quotes (report / invoice need them)
DROP POLICY IF EXISTS qc_office_admin_read ON public.quote_cities;
CREATE POLICY qc_office_admin_read ON public.quote_cities FOR SELECT TO authenticated
  USING (public.get_my_role() = 'office_admin'
         AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_cities.quote_id AND q.segment = 'GOVERNMENT'));

-- client master (names, contacts). No money here; payments stay closed to her (owner decision pending).
DROP POLICY IF EXISTS clients_office_admin_read ON public.clients;
CREATE POLICY clients_office_admin_read ON public.clients FOR SELECT TO authenticated USING (public.get_my_role() = 'office_admin');

-- 4. Daily check-in card: she sees it too (and is counted as a person who says hi / shares)
-- work_daily_checkin: canonical in db/functions/work_daily_checkin.sql (office_admin added there).
NOTIFY pgrst, 'reload schema';
-- VERIFY: both constraints list office_admin; designations has 'Office Admin'; 8 policies *_office_admin_*:
-- SELECT (SELECT pg_get_constraintdef(oid) LIKE '%office_admin%' FROM pg_constraint WHERE conname='users_role_check') AS role_ok,
--        (SELECT count(*) FROM designations WHERE auth_role='office_admin') AS desig,
--        (SELECT count(*) FROM pg_policies WHERE policyname LIKE '%office_admin%') AS pols,
--        (SELECT pg_get_constraintdef(oid) LIKE '%office_admin%' FROM pg_constraint WHERE conname='users_team_role_check') AS team_ok;   -- t / 1 / 8 / t
