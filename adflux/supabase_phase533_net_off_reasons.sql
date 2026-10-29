-- ============================================================================
-- Phase 533 — reason for a long internet-off gap (same popup as GPS-off)
-- ============================================================================
-- Owner 2026-10-30: the "why was it off" popup also covers internet gaps of 10+
-- minutes in the working day. Same rules as Phase 530: the rep is released as
-- soon as the reason is SENT; admin marks Excused / Not excused (label only: no
-- score, TA or incentive effect).
--
-- ADDITIVE: one new table (net_off_reasons) mirroring gps_off_reasons, its RLS
-- and a push trigger. The only change to an existing object is WIDENING the
-- gps_off_reasons reason_code list (adds 'no_signal', 'data_finished') so one
-- popup can offer one reason list for both kinds of gap.
-- ============================================================================

ALTER TABLE public.gps_off_reasons DROP CONSTRAINT IF EXISTS gps_off_reasons_reason_code_check;
ALTER TABLE public.gps_off_reasons ADD CONSTRAINT gps_off_reasons_reason_code_check
  CHECK (reason_code IN ('phone_off','battery_dead','turned_off_by_mistake','saving_battery','no_signal','data_finished','other'));

CREATE TABLE IF NOT EXISTS public.net_off_reasons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL UNIQUE REFERENCES public.network_off_events(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason_code  text NOT NULL
               CHECK (reason_code IN ('phone_off','battery_dead','turned_off_by_mistake','saving_battery','no_signal','data_finished','other')),
  reason_note  text,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','excused','not_excused')),
  decided_by   uuid REFERENCES public.users(id),
  decided_at   timestamptz,
  decision_note text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS net_off_reasons_status_idx ON public.net_off_reasons (status, created_at DESC);
CREATE INDEX IF NOT EXISTS net_off_reasons_user_idx   ON public.net_off_reasons (user_id, created_at DESC);

ALTER TABLE public.net_off_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS net_off_reasons_admin_all ON public.net_off_reasons;
CREATE POLICY net_off_reasons_admin_all ON public.net_off_reasons
  FOR ALL USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS net_off_reasons_self_read ON public.net_off_reasons;
CREATE POLICY net_off_reasons_self_read ON public.net_off_reasons
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS net_off_reasons_self_insert ON public.net_off_reasons;
CREATE POLICY net_off_reasons_self_insert ON public.net_off_reasons
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND decided_by IS NULL
    AND decided_at IS NULL
    AND decision_note IS NULL
    AND EXISTS (
      SELECT 1 FROM public.network_off_events e
       WHERE e.id = event_id AND e.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.tg_push_on_net_off_reason()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name  text;
  v_admin record;
BEGIN
  BEGIN
    -- One push per send (a rep explaining several gaps inserts several rows).
    IF NEW.id <> (
      SELECT r.id FROM public.net_off_reasons r
       WHERE r.user_id = NEW.user_id AND r.created_at > now() - interval '2 minutes'
       ORDER BY r.created_at, r.id LIMIT 1
    ) THEN
      RETURN NEW;
    END IF;
    SELECT name INTO v_name FROM public.users WHERE id = NEW.user_id;
    IF public.is_push_allowed_now() THEN
      FOR v_admin IN SELECT id FROM public.users WHERE role = 'admin' AND is_active LOOP
        PERFORM public.enqueue_push(
          v_admin.id,
          'Internet was off · ' || COALESCE(v_name, 'a rep'),
          'Reason sent for your review.',
          '/pending-approvals',
          'net-off-' || NEW.id::text
        );
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- never block the rep's reason on a push problem
  END;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_push_on_net_off_reason() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_on_net_off_reason ON public.net_off_reasons;
CREATE TRIGGER trg_push_on_net_off_reason
  AFTER INSERT ON public.net_off_reasons
  FOR EACH ROW EXECUTE FUNCTION public.tg_push_on_net_off_reason();

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — expect: table_present = 1, policies = 3, trigger_present = true, rls_on = true, gps_codes_widened = true
-- ============================================================================
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public' AND table_name='net_off_reasons')            AS table_present,
--   (SELECT count(*) FROM pg_policies
--     WHERE schemaname='public' AND tablename='net_off_reasons')               AS policies,
--   EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_push_on_net_off_reason') AS trigger_present,
--   (SELECT relrowsecurity FROM pg_class WHERE oid='public.net_off_reasons'::regclass) AS rls_on,
--   (SELECT pg_get_constraintdef(oid) LIKE '%data_finished%' FROM pg_constraint
--     WHERE conname='gps_off_reasons_reason_code_check')                       AS gps_codes_widened;
