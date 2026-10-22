-- Phase 472: a task / rule can no longer put a sales or telecaller person on the Work timeclock.
-- Only an admin adding them by hand (work_set_member) still works. Existing members untouched.
-- UNDO: DROP TRIGGER trg_work_members_no_auto_sales_tc ON public.work_members;
--       DROP FUNCTION public.work_members_no_auto_sales_tc();  (work_set_member extra line is harmless)
CREATE OR REPLACE FUNCTION public.work_members_no_auto_sales_tc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text;
BEGIN
  IF COALESCE(current_setting('app.work_member_manual', true), '') = '1' THEN RETURN NEW; END IF;
  SELECT u.role INTO v_role FROM public.users u WHERE u.id = NEW.user_id;
  IF v_role IN ('sales','telecaller') THEN RETURN NULL; END IF;  -- skip silently (callers use ON CONFLICT DO NOTHING)
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.work_members_no_auto_sales_tc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_work_members_no_auto_sales_tc ON public.work_members;
CREATE TRIGGER trg_work_members_no_auto_sales_tc BEFORE INSERT ON public.work_members
  FOR EACH ROW EXECUTE FUNCTION public.work_members_no_auto_sales_tc();

CREATE OR REPLACE FUNCTION public.work_set_member(p_user uuid, p_member boolean, p_head boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_my_role() IS DISTINCT FROM 'admin' OR NOT public.work_is_active_user() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  IF p_member THEN
    PERFORM set_config('app.work_member_manual', '1', true);   -- deliberate add by an admin
    INSERT INTO public.work_members (user_id, is_head, added_by) VALUES (p_user, COALESCE(p_head, false), auth.uid())
    ON CONFLICT (user_id) DO UPDATE SET is_head = COALESCE(p_head, false);
  ELSE
    DELETE FROM public.work_members WHERE user_id = p_user;
  END IF;
END;
$$;

SELECT (SELECT count(*) FROM pg_trigger WHERE tgname='trg_work_members_no_auto_sales_tc') AS trigger_present,
       NOT has_function_privilege('authenticated','public.work_members_no_auto_sales_tc()','EXECUTE') AS locked;
