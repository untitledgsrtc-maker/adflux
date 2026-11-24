-- supabase_phase667_hr_fixes.sql (24-11-2026)
-- Owner approved 24-11-2026 ("yes do today fixes, hr can approve ta n deactivate").
-- Run db/functions/admin_create_user.sql too (HR can no longer re-point an existing
-- staff member's login by reusing their email).
--
-- 1. HR can approve / reject / mark paid / edit hotel on TA days (daily_ta). Before, HR
--    could only read the table, so every change silently saved 0 rows. Same reach as
--    the other HR policies: never an admin / co_owner row.
-- 2. A leave approve / reject / add / delete now refreshes that person's day score in the
--    database, whoever did it. Before, the page's refresh call was refused for HR and
--    Office Admin, so an approved leave day stayed counted as a 0% working day.
--    Only past / today dates (a future date must not get a score row), only this month
--    and last month (paid months never move), only sales / telecaller.
-- 3. set_user_active(): lets HR deactivate / reactivate staff (not admin / co_owner, not
--    herself). Same column update the admin does, so the exit-task + sign-in-block
--    triggers fire as before.

-- 1 -------------------------------------------------------------------------
DROP POLICY IF EXISTS daily_ta_hr_update ON public.daily_ta;
CREATE POLICY daily_ta_hr_update ON public.daily_ta
  FOR UPDATE
  USING ((SELECT public.get_my_role()) = 'hr'
         AND daily_ta.user_id <> (SELECT auth.uid())
         AND COALESCE((SELECT u.role FROM public.users u WHERE u.id = daily_ta.user_id), '') NOT IN ('admin', 'co_owner'))
  WITH CHECK ((SELECT public.get_my_role()) = 'hr'
         AND COALESCE((SELECT u.role FROM public.users u WHERE u.id = daily_ta.user_id), '') NOT IN ('admin', 'co_owner'));

-- 1b. Guard (security review): for an HR caller only status, hotel amount and notes can
--     change. Who / which day / km / DA / bike stay as they were, the total is recomputed
--     here (not trusted from the browser), the approver is HR herself, and HR can never
--     touch her own TA. Admin / accounts / the GPS batch are untouched (role is not 'hr').
CREATE OR REPLACE FUNCTION public.daily_ta_hr_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_my_role() IS DISTINCT FROM 'hr' THEN
    RETURN NEW;
  END IF;
  IF OLD.user_id = auth.uid() THEN
    RAISE EXCEPTION 'HR cannot change her own TA' USING ERRCODE = '42501';
  END IF;
  NEW.user_id         := OLD.user_id;
  NEW.ta_date         := OLD.ta_date;
  NEW.primary_city    := OLD.primary_city;
  NEW.city_category   := OLD.city_category;
  NEW.km_traveled     := OLD.km_traveled;
  NEW.da_amount       := OLD.da_amount;
  NEW.bike_amount     := OLD.bike_amount;
  NEW.gps_pings_count := OLD.gps_pings_count;
  NEW.computed_at     := OLD.computed_at;
  NEW.hotel_amount    := GREATEST(0, COALESCE(NEW.hotel_amount, 0));
  NEW.total_amount    := COALESCE(NEW.da_amount, 0) + COALESCE(NEW.bike_amount, 0) + NEW.hotel_amount;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.approved_by := CASE WHEN NEW.status IN ('approved', 'paid') THEN auth.uid() ELSE OLD.approved_by END;
    NEW.approved_at := CASE WHEN NEW.status IN ('approved', 'paid') THEN now() ELSE OLD.approved_at END;
  ELSE
    NEW.approved_by := OLD.approved_by;
    NEW.approved_at := OLD.approved_at;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.daily_ta_hr_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_daily_ta_hr_guard ON public.daily_ta;
CREATE TRIGGER trg_daily_ta_hr_guard
  BEFORE UPDATE ON public.daily_ta
  FOR EACH ROW EXECUTE FUNCTION public.daily_ta_hr_guard();

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_recompute_score()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_prev  text := current_setting('app.score_for', true);
  r       record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.leave_date IS NOT DISTINCT FROM OLD.leave_date
     AND NEW.is_half_day IS NOT DISTINCT FROM OLD.is_half_day
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT DISTINCT x.uid, x.d FROM (
      SELECT NEW.user_id AS uid, NEW.leave_date AS d WHERE TG_OP <> 'DELETE'
      UNION ALL
      SELECT OLD.user_id, OLD.leave_date WHERE TG_OP <> 'INSERT'
    ) x
    WHERE x.uid IS NOT NULL AND x.d IS NOT NULL AND x.d <= v_today
      -- security review: never re-score a closed month (previous month allowed, for
      -- late approvals before salary is run) and only sales / telecaller are scored.
      AND x.d >= (date_trunc('month', v_today) - interval '1 month')::date
      AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = x.uid AND u.role IN ('sales', 'telecaller'))
  LOOP
    BEGIN
      PERFORM set_config('app.score_for', r.uid::text, true);
      PERFORM public.compute_daily_score(r.uid, r.d);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Phase 667 leave score refresh failed for % %: %', r.uid, r.d, SQLERRM;
    END;
  END LOOP;
  PERFORM set_config('app.score_for', COALESCE(v_prev, ''), true);
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.leave_recompute_score() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_leaves_recompute_score ON public.leaves;
CREATE TRIGGER trg_leaves_recompute_score
  AFTER INSERT OR DELETE OR UPDATE OF status, leave_date, is_half_day, user_id ON public.leaves
  FOR EACH ROW EXECUTE FUNCTION public.leave_recompute_score();

-- 3 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_active(p_user_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller text := public.get_my_role();
  v_target text;
BEGIN
  IF v_caller IS NULL OR v_caller NOT IN ('admin', 'co_owner', 'hr') THEN
    RAISE EXCEPTION 'Only admin / co_owner / HR can change who is active' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'user and active flag required';
  END IF;
  SELECT role INTO v_target FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_caller = 'hr' AND (v_target IN ('admin', 'co_owner') OR p_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'HR cannot change this account' USING ERRCODE = '42501';
  END IF;
  UPDATE public.users SET is_active = p_active WHERE id = p_user_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_user_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_active(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect ta_hr_update=1, ta_hr_guard=1, leave_trigger=1, set_active_fn=1
SELECT
  (SELECT count(*) FROM pg_policy WHERE polname = 'daily_ta_hr_update') AS ta_hr_update,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_daily_ta_hr_guard') AS ta_hr_guard,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_leaves_recompute_score') AS leave_trigger,
  (SELECT count(*) FROM pg_proc WHERE proname = 'set_user_active') AS set_active_fn;
