-- Phase 462: send a "say hi" / "send your evening report" reminder to chosen people from the Daily check-in card.
-- Shows as a banner when they open the app (+ push, + WhatsApp when their 24h window is open). Admin, co_owner, HR send.
CREATE TABLE IF NOT EXISTS public.work_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('morning','evening')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz
);
CREATE INDEX IF NOT EXISTS work_reminders_user_idx ON public.work_reminders (user_id, created_at DESC);
ALTER TABLE public.work_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_reminders_own_read ON public.work_reminders;
CREATE POLICY work_reminders_own_read ON public.work_reminders FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.work_reminders FROM anon, authenticated;
GRANT SELECT ON public.work_reminders TO authenticated;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.work_reminders; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- internal: WhatsApp part. Secret is taken from the live evening dispatch function (same value the other team-nudge jobs use).
DO $do$
DECLARE v_def text; v_secret text;
BEGIN
  SELECT pg_get_functiondef('public.evening_report_wa_dispatch()'::regprocedure) INTO v_def;
  v_secret := substring(v_def from $re$x-ta-secret',\s*'([^']+)'$re$);
  IF v_secret IS NULL THEN RAISE EXCEPTION 'could not read the team-nudge secret from evening_report_wa_dispatch'; END IF;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.work__reminder_wa(p_kind text, p_users uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $body$
    BEGIN
      PERFORM net.http_post(
        url     := 'https://app.untitledad.in/api/wa/team-nudge',
        headers := jsonb_build_object('Content-Type','application/json','x-ta-secret', %L),
        body    := jsonb_build_object('mode','manual','kind',p_kind,'users',to_jsonb(p_users)),
        timeout_milliseconds := 25000);
    EXCEPTION WHEN OTHERS THEN NULL;
    END; $body$;
  $fn$, v_secret);
END $do$;
REVOKE ALL ON FUNCTION public.work__reminder_wa(text, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.work_send_reminder(p_users uuid[], p_kind text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := public.get_my_role(); v_ids uuid[]; r record; n int := 0;
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('admin','co_owner','hr') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF p_kind NOT IN ('morning','evening') THEN RAISE EXCEPTION 'bad kind'; END IF;
  SELECT COALESCE(array_agg(id), '{}') INTO v_ids FROM (
    SELECT id FROM public.users WHERE id = ANY(COALESCE(p_users, '{}')) AND is_active AND role NOT IN ('admin','co_owner','agency')
       -- morning = "say hi to the assistant number": a person with no mapped WhatsApp number would land in the CUSTOMER funnel (sections 197/198), so skip them
       AND (p_kind <> 'morning' OR length(regexp_replace(COALESCE(whatsapp_number, ''), '\D', '', 'g')) >= 10)
     LIMIT 60) q;
  FOR r IN SELECT id FROM public.users WHERE id = ANY(v_ids) LOOP
    DELETE FROM public.work_reminders WHERE user_id = r.id AND kind = p_kind AND seen_at IS NULL;
    INSERT INTO public.work_reminders (user_id, kind, created_by) VALUES (r.id, p_kind, auth.uid());
    PERFORM public.work_push(r.id,
      CASE WHEN p_kind = 'morning' THEN 'Say good morning' ELSE 'Send your evening report' END,
      CASE WHEN p_kind = 'morning' THEN 'Please say hi on WhatsApp to start your day.' ELSE 'Please open the app and send your evening report.' END,
      '/my-work', 'work-rem-' || p_kind);
    n := n + 1;
  END LOOP;
  IF n > 0 THEN PERFORM public.work__reminder_wa(p_kind, v_ids); END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.work_send_reminder(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_send_reminder(uuid[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.work_reminder_seen(p_kind text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.work_reminders SET seen_at = now() WHERE user_id = auth.uid() AND kind = p_kind AND seen_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.work_reminder_seen(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_reminder_seen(text) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- VERIFY (all true): the copied secret is a real value, not a placeholder; clients cannot run the internal sender.
-- SELECT pg_get_functiondef('public.work__reminder_wa(text,uuid[])'::regprocedure) NOT LIKE '%<%>%' AS secret_is_real,
--        NOT has_function_privilege('anon','public.work__reminder_wa(text,uuid[])','execute') AS anon_blocked,
--        (SELECT count(*) FROM pg_proc WHERE proname IN ('work_send_reminder','work_reminder_seen','work__reminder_wa')) = 3 AS three_fns;
