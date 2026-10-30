-- ============================================================================
-- Phase 535 — meeting must be logged within 100 m of the client (approval instead of a dead end)
-- ============================================================================
-- Owner 2026-10-30: when a rep logs a meeting and their real GPS is not at the
-- client, block it; 100 m is fine. Agreed design:
--   * the client's location = the Google listing pin saved on the lead when the rep
--     picks the listing (leads.lat / lng, geocode_source = 'google_place');
--   * blocked only when distance MINUS the rep's GPS accuracy is over 100 m;
--   * no Google pin (no listing / old leads) = allowed, not verified;
--   * a blocked rep can REQUEST APPROVAL with a reason; admin approves or rejects.
-- The check itself runs in the app (src/utils/meetingLocation.js). This file only
-- adds the request table + its RLS + two pushes.
--
-- ADDITIVE ONLY: one new table, its RLS, two trigger functions + triggers. No
-- existing table, policy, trigger or function is changed.
--   Approval is valid for 12 hours for the same rep + same pin (checked in the app),
--   so one approval covers a rep who retries or logs two meetings at that site.
--   co_owner is intentionally NOT included (section 42: admin policies stay 'admin').
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.meeting_location_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  company         text,
  pin_lat         numeric NOT NULL,
  pin_lng         numeric NOT NULL,
  rep_lat         numeric NOT NULL,
  rep_lng         numeric NOT NULL,
  rep_accuracy_m  numeric,
  distance_m      integer NOT NULL,
  reason          text NOT NULL CHECK (length(btrim(reason)) >= 3),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  decided_by      uuid REFERENCES public.users(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_location_requests_status_idx ON public.meeting_location_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS meeting_location_requests_user_idx   ON public.meeting_location_requests (user_id, created_at DESC);

ALTER TABLE public.meeting_location_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mlr_admin_all ON public.meeting_location_requests;
CREATE POLICY mlr_admin_all ON public.meeting_location_requests
  FOR ALL USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS mlr_self_read ON public.meeting_location_requests;
CREATE POLICY mlr_self_read ON public.meeting_location_requests
  FOR SELECT USING (user_id = auth.uid());

-- A rep can only create their OWN request, always pending, never self-decided.
DROP POLICY IF EXISTS mlr_self_insert ON public.meeting_location_requests;
CREATE POLICY mlr_self_insert ON public.meeting_location_requests
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND decided_by IS NULL
    AND decided_at IS NULL
    AND decision_note IS NULL
  );

-- Push to admins when a request arrives.
CREATE OR REPLACE FUNCTION public.tg_push_on_meeting_location_request()
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
    SELECT name INTO v_name FROM public.users WHERE id = NEW.user_id;
    IF public.is_push_allowed_now() THEN
      FOR v_admin IN SELECT id FROM public.users WHERE role = 'admin' AND is_active LOOP
        PERFORM public.enqueue_push(
          v_admin.id,
          'Meeting location · ' || COALESCE(v_name, 'a rep'),
          COALESCE(NEW.company, 'A client') || ' · ' || NEW.distance_m::text || ' m away. Approval needed.',
          '/pending-approvals',
          'mlr-' || NEW.id::text
        );
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- never block the request on a push problem
  END;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_push_on_meeting_location_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_on_meeting_location_request ON public.meeting_location_requests;
CREATE TRIGGER trg_push_on_meeting_location_request
  AFTER INSERT ON public.meeting_location_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_push_on_meeting_location_request();

-- Push to the rep when admin decides.
CREATE OR REPLACE FUNCTION public.tg_push_on_meeting_location_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    IF NEW.status IN ('approved','rejected') AND OLD.status = 'pending' THEN
      PERFORM public.enqueue_push(
        NEW.user_id,
        CASE WHEN NEW.status = 'approved' THEN 'Meeting location approved' ELSE 'Meeting location not approved' END,
        COALESCE(NEW.company, 'Your meeting') ||
          CASE WHEN NEW.status = 'approved' THEN ' · you can log it now.' ELSE ' · ask admin if unsure.' END,
        '/work',
        'mlr-d-' || NEW.id::text
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_push_on_meeting_location_decision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_on_meeting_location_decision ON public.meeting_location_requests;
CREATE TRIGGER trg_push_on_meeting_location_decision
  AFTER UPDATE OF status ON public.meeting_location_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_push_on_meeting_location_decision();

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — expect: table_present = 1, policies = 3, triggers = 2, rls_on = true
-- ============================================================================
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public' AND table_name='meeting_location_requests')  AS table_present,
--   (SELECT count(*) FROM pg_policies
--     WHERE schemaname='public' AND tablename='meeting_location_requests')     AS policies,
--   (SELECT count(*) FROM pg_trigger
--     WHERE tgrelid='public.meeting_location_requests'::regclass AND NOT tgisinternal) AS triggers,
--   (SELECT relrowsecurity FROM pg_class
--     WHERE oid='public.meeting_location_requests'::regclass)                  AS rls_on;
