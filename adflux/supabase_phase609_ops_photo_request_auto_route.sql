-- Phase 609 — Live-photo requests reach the station technician automatically (owner 18-11-2026:
-- "ops didn't get photo request").
-- CAUSE: QuoteDetail "Request live photo" inserts ONE ops_tickets photo_request with NO station
--   and NO technician. OpsHeadApp skips a ticket with no station, OpsTechApp lists only tickets
--   assigned to the tech -> nobody sees it. Phase 419 split them once by hand; never automated.
-- FIX: AFTER INSERT trigger does the Phase 419 split for every new request: one request per
--   station of the quote's cities (match ops_depots.city_id, fallback name prefix), assigned to
--   that station's technician, the original cancelled, one push per technician.
--   A city with no station is skipped; if NO station matches the original stays as it was.
--   Best-effort: never blocks the rep's insert.

CREATE OR REPLACE FUNCTION public.ops_route_photo_request_for(p_ticket uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE NEW public.ops_tickets; c record; v_depot uuid; v_tech uuid; n int := 0; r record;
BEGIN
  SELECT * INTO NEW FROM public.ops_tickets
   WHERE id = p_ticket AND type = 'photo_request' AND status = 'open' AND depot_id IS NULL AND quote_id IS NOT NULL;
  IF NOT FOUND THEN RETURN 0; END IF;
  FOR c IN SELECT DISTINCT qc.city_id, upper(btrim(qc.city_name)) AS city
             FROM public.quote_cities qc WHERE qc.quote_id = NEW.quote_id LOOP
    v_depot := NULL; v_tech := NULL;
    SELECT d.id, d.assigned_to INTO v_depot, v_tech FROM public.ops_depots d
     WHERE d.is_active AND (d.city_id = c.city_id
        OR upper(d.name) LIKE split_part(replace(CASE WHEN c.city = 'DWRKA' THEN 'DWARKA' ELSE c.city END, '(', ' '), ' ', 1) || '%')
     ORDER BY (d.city_id = c.city_id) DESC NULLS LAST, d.name LIMIT 1;
    IF v_depot IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.ops_tickets x WHERE x.quote_id = NEW.quote_id AND x.type = 'photo_request'
                  AND x.depot_id = v_depot AND x.status IN ('open','in_progress')) THEN CONTINUE; END IF;
    INSERT INTO public.ops_tickets (type, depot_id, status, priority, assigned_to, requested_by, quote_id, source, cause, notes, created_by)
    VALUES ('photo_request', v_depot, 'open', NEW.priority, v_tech, NEW.requested_by, NEW.quote_id, NEW.source, NEW.cause,
            COALESCE(NEW.notes,'') || ' · ' || initcap(c.city), NEW.created_by);
    n := n + 1;
  END LOOP;

  -- the request is now covered per station (new or already open) -> cancel the station-less original
  IF EXISTS (SELECT 1 FROM public.ops_tickets x WHERE x.quote_id = NEW.quote_id AND x.type = 'photo_request'
                AND x.depot_id IS NOT NULL AND x.status IN ('open','in_progress')) THEN
    UPDATE public.ops_tickets SET status = 'cancelled', resolved_at = now(), updated_at = now(),
           notes = COALESCE(notes || E'\n', '') || '[split into one request per station - Phase 609]'
     WHERE id = NEW.id;
  END IF;

  IF n > 0 AND COALESCE(public.is_push_allowed_now(), false) THEN
    FOR r IN SELECT x.assigned_to AS uid, count(*)::int AS cnt FROM public.ops_tickets x
              WHERE x.quote_id = NEW.quote_id AND x.type = 'photo_request' AND x.status = 'open'
                AND x.assigned_to IS NOT NULL AND x.created_at >= now() - interval '1 minute'
              GROUP BY 1 LOOP
      PERFORM public.enqueue_push(r.uid, 'ફોટો જોઈએ છે',
        format('%s સ્ટેશન પર જાહેરાતનો લાઇવ ફોટો મોકલો', r.cnt), '/ops-home',
        'ops-photo-' || NEW.quote_id::text || '-' || r.uid::text);
    END LOOP;
  END IF;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.ops_route_photo_request_for(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ops_route_photo_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.ops_route_photo_request_for(NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ops_route_photo_request failed (ignored): %', SQLERRM;   -- never blocks the rep's request
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.ops_route_photo_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ops_route_photo_request ON public.ops_tickets;
CREATE TRIGGER trg_ops_route_photo_request
  AFTER INSERT ON public.ops_tickets
  FOR EACH ROW
  WHEN (NEW.type = 'photo_request' AND NEW.depot_id IS NULL AND NEW.quote_id IS NOT NULL AND NEW.status = 'open')
  EXECUTE FUNCTION public.ops_route_photo_request();

-- Backfill: route the open station-less requests already waiting (UA-2026-0608 / 0609, 13 + 18 Nov).
SELECT id, public.ops_route_photo_request_for(id) AS stations_created
  FROM public.ops_tickets
 WHERE type = 'photo_request' AND status = 'open' AND depot_id IS NULL AND quote_id IS NOT NULL
 ORDER BY created_at;

NOTIFY pgrst, 'reload schema';

-- VERIFY: open station-less photo requests = 0 (or only quotes whose cities have no station)
SELECT count(*) AS open_without_station FROM public.ops_tickets
 WHERE type = 'photo_request' AND status = 'open' AND depot_id IS NULL;
