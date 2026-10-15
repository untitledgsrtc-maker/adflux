-- supabase_phase386_daily_checkin.sql
-- Phase 386 - ONE "Daily check-in" card (morning hi + evening report) for admin, co-owner, HR and accounts.
-- HR cannot read team_assistant_requests directly (RLS), so this SECURITY DEFINER function returns only
-- who said hi / who shared today, per active person. Read-only, idempotent.
CREATE OR REPLACE FUNCTION public.work_daily_checkin() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role text := public.get_my_role();
  v_day  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_since timestamptz := (date_trunc('day', (now() AT TIME ZONE 'Asia/Kolkata')) AT TIME ZONE 'Asia/Kolkata');
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('admin', 'co_owner', 'hr', 'accounts') THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', u.id, 'name', u.name, 'role', u.role, 'photo', u.profile_image_url,
             'said_hi', EXISTS (SELECT 1 FROM public.team_assistant_requests r WHERE r.user_id = u.id AND r.created_at >= v_since),
             'shared',  EXISTS (SELECT 1 FROM public.work_report_shares s WHERE s.user_id = u.id AND s.work_date = v_day)
                        OR EXISTS (SELECT 1 FROM public.work_sessions w WHERE w.user_id = u.id AND w.work_date = v_day AND w.evening_summary_sent_at IS NOT NULL))
           ORDER BY u.name)
      FROM public.users u
     WHERE u.is_active AND u.role NOT IN ('admin', 'co_owner', 'agency')
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.work_daily_checkin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_daily_checkin() TO authenticated;
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT has_function_privilege('anon','public.work_daily_checkin()','EXECUTE') -> f ; authenticated -> t
