-- db/functions/work_daily_checkin.sql  (CANONICAL - section 71/72: one definition)
-- Daily check-in card data: who said the morning hi / shared the evening report today (IST).
-- Roles allowed to call it: admin, co_owner, hr, accounts, office_admin. Counted people: every active user except admin, co_owner, agency.
-- History: phase 386 (created), phase 391 (office_admin added). Edit THIS file, never a phase file.
CREATE OR REPLACE FUNCTION public.work_daily_checkin() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role text := public.get_my_role();
  v_day  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_since timestamptz := (date_trunc('day', (now() AT TIME ZONE 'Asia/Kolkata')) AT TIME ZONE 'Asia/Kolkata');
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('admin', 'co_owner', 'hr', 'accounts', 'office_admin') THEN
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

NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT pg_get_functiondef('public.work_daily_checkin()'::regprocedure) LIKE '%office_admin%';  -- t
