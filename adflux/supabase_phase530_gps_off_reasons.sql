-- ============================================================================
-- Phase 530 — reason for a long GPS-off gap, sent to admin for Excused / Not excused
-- ============================================================================
-- Owner 2026-10-29: when a field rep's GPS has been off for 10+ minutes during
-- the working day, one non-skippable popup asks why. Decision: the rep is released
-- as soon as the reason is SENT; admin then marks the gap Excused / Not excused.
-- Excused / Not excused is a label only: it does not touch score, TA or incentive.
--
-- ADDITIVE ONLY: one new table, its RLS, one push trigger. No existing table,
-- policy, trigger or function is changed.
--   gps_off_reasons.event_id UNIQUE -> exactly one reason per gps_off_events row.
--   RLS: a rep may insert / read ONLY their own reason for THEIR OWN event, always
--        as status 'pending' (they can never decide it). Admin reads + decides.
--        co_owner is intentionally NOT included (section 42 doctrine: admin
--        policies stay singular 'admin').
--   Push: an AFTER INSERT trigger tells each active admin. SECURITY DEFINER because
--        enqueue_push is revoked from clients (Phase 97.A2); quiet-hours gated
--        (Phase 98.A); wrapped so a push failure can never block the rep's insert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gps_off_reasons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL UNIQUE REFERENCES public.gps_off_events(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason_code  text NOT NULL
               CHECK (reason_code IN ('phone_off','battery_dead','turned_off_by_mistake','saving_battery','other')),
  reason_note  text,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','excused','not_excused')),
  decided_by   uuid REFERENCES public.users(id),
  decided_at   timestamptz,
  decision_note text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gps_off_reasons_status_idx ON public.gps_off_reasons (status, created_at DESC);
CREATE INDEX IF NOT EXISTS gps_off_reasons_user_idx   ON public.gps_off_reasons (user_id, created_at DESC);

ALTER TABLE public.gps_off_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gps_off_reasons_admin_all ON public.gps_off_reasons;
CREATE POLICY gps_off_reasons_admin_all ON public.gps_off_reasons
  FOR ALL USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS gps_off_reasons_self_read ON public.gps_off_reasons;
CREATE POLICY gps_off_reasons_self_read ON public.gps_off_reasons
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS gps_off_reasons_self_insert ON public.gps_off_reasons;
CREATE POLICY gps_off_reasons_self_insert ON public.gps_off_reasons
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND decided_by IS NULL
    AND decided_at IS NULL
    AND decision_note IS NULL
    AND EXISTS (
      SELECT 1 FROM public.gps_off_events e
       WHERE e.id = event_id AND e.user_id = auth.uid()
    )
  );

-- Admin push on a new reason.
CREATE OR REPLACE FUNCTION public.tg_push_on_gps_off_reason()
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
    -- One push per send: a rep who explains 3 gaps at once inserts 3 rows in one
    -- statement; only the row with the lowest id (within 2 min) pushes.
    IF NEW.id <> (
      SELECT r.id FROM public.gps_off_reasons r
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
          'GPS was off · ' || COALESCE(v_name, 'a rep'),
          'Reason sent for your review.',
          '/pending-approvals',
          'gps-off-' || NEW.id::text
        );
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- never block the rep's reason on a push problem
  END;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_push_on_gps_off_reason() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_on_gps_off_reason ON public.gps_off_reasons;
CREATE TRIGGER trg_push_on_gps_off_reason
  AFTER INSERT ON public.gps_off_reasons
  FOR EACH ROW EXECUTE FUNCTION public.tg_push_on_gps_off_reason();

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — expect: table_present = 1, policies = 3, trigger_present = true, rls_on = true
-- ============================================================================
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public' AND table_name='gps_off_reasons')            AS table_present,
--   (SELECT count(*) FROM pg_policies
--     WHERE schemaname='public' AND tablename='gps_off_reasons')               AS policies,
--   EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_push_on_gps_off_reason') AS trigger_present,
--   (SELECT relrowsecurity FROM pg_class WHERE oid='public.gps_off_reasons'::regclass) AS rls_on;
