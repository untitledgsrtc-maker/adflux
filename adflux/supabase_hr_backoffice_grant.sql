-- =====================================================================
-- HR back-office grant — HR (Riya) gets Leaves + TA/DA + Team roster + Attendance
-- 2026-08-03 · owner directive. ADDITIVE RLS only (mirrors the Phase 182 accounts
-- grant). HR stays WALLED OFF from sales + money: NO policy here touches
-- leads / quotes / payments / salary_payouts / incentive / monthly_sales_data /
-- lead_activities / call_logs. So on the Team-Dashboard the map + attendance show
-- for HR, but the sales/revenue cards return ZERO rows (RLS blocks them) — no leak.
--   HR gets: approve leaves + TA/DA claims; view team roster; view attendance + GPS.
-- Idempotent (§8). Fails closed (each policy is a positive grant gated on = 'hr').
-- =====================================================================

-- ---- Leaves — approve/reject (FOR ALL, like accounts) ----------------
DROP POLICY IF EXISTS leaves_hr_all ON public.leaves;
CREATE POLICY leaves_hr_all ON public.leaves FOR ALL
  USING (public.get_my_role() = 'hr') WITH CHECK (public.get_my_role() = 'hr');

-- ---- TA/DA claims — approve/reject (FOR ALL) -------------------------
DROP POLICY IF EXISTS ta_da_requests_hr_all ON public.ta_da_requests;
CREATE POLICY ta_da_requests_hr_all ON public.ta_da_requests FOR ALL
  USING (public.get_my_role() = 'hr') WITH CHECK (public.get_my_role() = 'hr');

-- daily_ta — READ only (the TA page shows the computed ₹/km; the approval merges
-- via the DEFINER trigger, so HR needs read, not write)
DROP POLICY IF EXISTS daily_ta_hr_read ON public.daily_ta;
CREATE POLICY daily_ta_hr_read ON public.daily_ta FOR SELECT
  USING (public.get_my_role() = 'hr');

-- ---- Attendance / GPS — READ only -----------------------------------
DROP POLICY IF EXISTS gps_pings_hr_read ON public.gps_pings;
CREATE POLICY gps_pings_hr_read ON public.gps_pings FOR SELECT
  USING (public.get_my_role() = 'hr');

DROP POLICY IF EXISTS work_sessions_hr_read ON public.work_sessions;
CREATE POLICY work_sessions_hr_read ON public.work_sessions FOR SELECT
  USING (public.get_my_role() = 'hr');

DROP POLICY IF EXISTS gps_off_events_hr_read ON public.gps_off_events;
CREATE POLICY gps_off_events_hr_read ON public.gps_off_events FOR SELECT
  USING (public.get_my_role() = 'hr');

-- ---- Team roster — READ users (names/roles/designations for the roster) ----
DROP POLICY IF EXISTS users_hr_read ON public.users;
CREATE POLICY users_hr_read ON public.users FOR SELECT
  USING (public.get_my_role() = 'hr');

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Expect 7 hr policies; NONE on leads/quotes/payments/salary_payouts/incentive_*.
SELECT tablename, policyname, cmd
FROM   pg_policies
WHERE  schemaname='public' AND policyname LIKE '%\_hr\_%'
  AND  tablename IN ('leaves','ta_da_requests','daily_ta','gps_pings','work_sessions','gps_off_events','users')
ORDER  BY tablename, policyname;
-- Sanity: HR must have NO grant on the sales/money tables (expect 0 rows):
SELECT count(*) AS hr_sales_money_leak
FROM   pg_policies
WHERE  schemaname='public'
  AND  qual LIKE '%''hr''%'
  AND  tablename IN ('leads','quotes','payments','salary_payouts','incentive_payouts','monthly_sales_data','lead_activities','call_logs');
