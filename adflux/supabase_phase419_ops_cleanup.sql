-- Phase 419 (owner 2026-10-19): make the operations screens work for the technicians.
--  A. plain fix steps (Gujarati + English) for the 10 issue types
--  B. cancel auto tickets whose station is fine now (backup first)
--  C. switch off the 2 office test screens that belong to no station
--  D. live-photo requests from sales: one request per station, each given to that station's technician
-- Idempotent. Backups: _bak_ops_tickets_p419 (KEEP 30 days, then DROP TABLE). UNDO for C: UPDATE ops_screens SET is_active=true WHERE id IN
-- ('6f30c3cd-09a3-429c-89e3-3efed0c9ad3f','ab9bbaae-afb2-4b3b-b396-b3fdc341805c');

-- ============ A. fix steps ============
UPDATE public.ops_issue_types SET solution_en = v.en, solution_gu = v.gu
FROM (VALUES
 ('Power cut',
  E'1. Check the main switch and fuse at the station.\n2. Call the depot manager - is there power in the building?\n3. If the whole station has no power, tell the head and wait for the light to come back.',
  E'૧. સ્ટેશન પર મુખ્ય સ્વિચ અને ફ્યુઝ તપાસો.\n૨. ડેપો મેનેજરને ફોન કરો - બિલ્ડિંગમાં લાઇટ છે?\n૩. આખા સ્ટેશન પર લાઇટ ન હોય તો હેડને જણાવો અને લાઇટ આવવાની રાહ જુઓ.'),
 ('Light bill not paid',
  E'1. Ask the depot manager if the electricity bill is pending.\n2. Tell the head - the bill must be paid.\n3. When the light is back, check that all screens turn on.',
  E'૧. ડેપો મેનેજરને પૂછો કે લાઇટ બિલ બાકી છે?\n૨. હેડને જણાવો - બિલ ભરવું પડશે.\n૩. લાઇટ આવે પછી બધી સ્ક્રીન ચાલુ થઈ કે નહીં તપાસો.'),
 ('Software issue',
  E'1. Restart the player (switch the box off, wait 10 seconds, switch on).\n2. Wait 5 minutes - does the ad play?\n3. If not, tell the head with a photo of the screen.',
  E'૧. પ્લેયર રીસ્ટાર્ટ કરો (બોક્સ બંધ કરો, ૧૦ સેકન્ડ રાહ જુઓ, ચાલુ કરો).\n૨. ૫ મિનિટ રાહ જુઓ - જાહેરાત ચાલે છે?\n૩. ન ચાલે તો સ્ક્રીનના ફોટા સાથે હેડને જણાવો.'),
 ('Wiring problem',
  E'1. Look for loose, cut or burnt wires behind the screen.\n2. Push every plug in tight. Do not touch wires while the power is on.\n3. If a wire is damaged, switch off, photo it and tell the head.',
  E'૧. સ્ક્રીનની પાછળ ઢીલા, કપાયેલા કે બળેલા વાયર જુઓ.\n૨. દરેક પ્લગ બરાબર દબાવો. લાઇટ ચાલુ હોય ત્યારે વાયરને અડશો નહીં.\n૩. વાયર ખરાબ હોય તો બંધ કરો, ફોટો પાડો અને હેડને જણાવો.'),
 ('Ethernet / internet issue',
  E'1. Check the internet cable is pushed in at the box and the router.\n2. Restart the router (off 10 seconds, then on).\n3. Wait 5 minutes. Still offline? Tell the head.',
  E'૧. બોક્સ અને રાઉટરમાં ઇન્ટરનેટ કેબલ બરાબર લાગેલો છે તપાસો.\n૨. રાઉટર રીસ્ટાર્ટ કરો (૧૦ સેકન્ડ બંધ, પછી ચાલુ).\n૩. ૫ મિનિટ રાહ જુઓ. હજી બંધ હોય તો હેડને જણાવો.'),
 ('Timer issue',
  E'1. Check the timer switch: the screen must be ON from 7 AM to 9 PM.\n2. Set the correct time on the timer.\n3. Check at 7 AM and 9 PM that the screen turns on and off.',
  E'૧. ટાઈમર તપાસો: સ્ક્રીન સવારે ૭ થી રાત્રે ૯ સુધી ચાલુ હોવી જોઈએ.\n૨. ટાઈમરમાં સાચો સમય સેટ કરો.\n૩. સવારે ૭ અને રાત્રે ૯ વાગ્યે સ્ક્રીન ચાલુ-બંધ થાય છે તે તપાસો.'),
 ('Pigeon / bird nest problem',
  E'1. Switch off the screen. Carefully remove the nest and droppings.\n2. Clean the box and the wires with a dry cloth.\n3. Block the gap so birds cannot come back, then switch on.',
  E'૧. સ્ક્રીન બંધ કરો. માળો અને ગંદકી સાચવીને દૂર કરો.\n૨. બોક્સ અને વાયર સૂકા કપડાથી સાફ કરો.\n૩. પક્ષી પાછું ન આવે તેવી જગ્યા બંધ કરો, પછી ચાલુ કરો.'),
 ('Switch problem',
  E'1. Check the switch is ON and not loose or burnt.\n2. Try another switch point if there is one.\n3. If it is damaged, photo it and tell the head to replace it.',
  E'૧. સ્વિચ ચાલુ છે અને ઢીલી કે બળેલી નથી તે તપાસો.\n૨. બીજો સ્વિચ પોઇન્ટ હોય તો તેમાં લગાવી જુઓ.\n૩. ખરાબ હોય તો ફોટો પાડી હેડને બદલવા જણાવો.'),
 ('Display / screen damage / blank',
  E'1. Is the screen black or broken? Check the power and the cable first.\n2. Take a clear photo of the screen.\n3. If the glass or panel is broken, tell the head - it needs a replacement.',
  E'૧. સ્ક્રીન કાળી કે તૂટેલી છે? પહેલાં લાઇટ અને કેબલ તપાસો.\n૨. સ્ક્રીનનો સ્પષ્ટ ફોટો પાડો.\n૩. કાચ કે પેનલ તૂટેલી હોય તો હેડને જણાવો - બદલવી પડશે.'),
 ('Cleaning required',
  E'1. Switch off the screen.\n2. Wipe the screen with a soft dry cloth. Never pour water on it.\n3. Clean the dust from the box and switch on.',
  E'૧. સ્ક્રીન બંધ કરો.\n૨. સ્ક્રીન નરમ સૂકા કપડાથી લૂછો. તેના પર પાણી ક્યારેય ન નાખો.\n૩. બોક્સમાંથી ધૂળ સાફ કરો અને ચાલુ કરો.')
) AS v(issue, en, gu)
WHERE ops_issue_types.issue_en = v.issue AND ops_issue_types.is_active
  AND COALESCE(NULLIF(btrim(ops_issue_types.solution_en), ''), NULLIF(btrim(ops_issue_types.solution_gu), '')) IS NULL;   -- never overwrite steps someone wrote

-- ============ B. stale auto tickets (station is fine now) ============
CREATE TABLE IF NOT EXISTS public._bak_ops_tickets_p419 AS SELECT t.*, now() AS bak_at, 'stale'::text AS why FROM public.ops_tickets t WHERE false;
ALTER TABLE public._bak_ops_tickets_p419 ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE n_stale int; n_photo int;
BEGIN
  -- auto-offline tickets at a station with no offline screen; auto-camera tickets at a station with no dead camera
  INSERT INTO public._bak_ops_tickets_p419
  SELECT t.*, now(), 'stale' FROM public.ops_tickets t
   WHERE t.status IN ('open','in_progress')
     AND ((t.source = 'auto_offline' AND NOT EXISTS (SELECT 1 FROM public.ops_screens s WHERE s.depot_id = t.depot_id AND s.is_active AND s.status = 'offline'))
       OR (t.source = 'auto_camera'  AND NOT EXISTS (SELECT 1 FROM public.ops_screens s WHERE s.depot_id = t.depot_id AND s.is_active AND s.camera_active = false)))
     AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p419 b WHERE b.id = t.id);
  GET DIAGNOSTICS n_stale = ROW_COUNT;
  IF n_stale > 6 THEN RAISE EXCEPTION 'Phase 419 aborted: % stale tickets (expected at most 6)', n_stale; END IF;
  UPDATE public.ops_tickets t
     SET status = 'cancelled', resolved_at = now(), updated_at = now(),
         notes = COALESCE(t.notes || E'\n', '') || '[closed: station is fully working now - cleanup Phase 419]'
   WHERE t.id IN (SELECT b.id FROM public._bak_ops_tickets_p419 b WHERE b.why = 'stale')
     AND t.status IN ('open','in_progress');
END $$;

-- ============ C. two office test screens that belong to no station ============
UPDATE public.ops_screens SET is_active = false
 WHERE id IN ('6f30c3cd-09a3-429c-89e3-3efed0c9ad3f','ab9bbaae-afb2-4b3b-b396-b3fdc341805c') AND depot_id IS NULL AND is_active;

-- ============ D. live-photo requests -> one per station, each to that station's technician ============
DO $$
DECLARE o record; c record; v_depot uuid; v_tech uuid; nn int := 0;
BEGIN
  FOR o IN SELECT * FROM public.ops_tickets WHERE source = 'sales_request' AND type = 'photo_request' AND status = 'open' AND depot_id IS NULL AND quote_id IS NOT NULL LOOP
    INSERT INTO public._bak_ops_tickets_p419 SELECT t.*, now(), 'photo_original' FROM public.ops_tickets t WHERE t.id = o.id AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p419 b WHERE b.id = t.id);
    FOR c IN SELECT DISTINCT upper(btrim(city_name)) AS city FROM public.quote_cities WHERE quote_id = o.quote_id LOOP
      SELECT d.id, d.assigned_to INTO v_depot, v_tech FROM public.ops_depots d
       WHERE d.is_active AND (upper(d.name) LIKE c.city || '%' OR (c.city = 'DWRKA' AND d.name ILIKE 'DWARKA%') OR (c.city = 'SURAT' AND d.name ILIKE 'SURAT%'))
       ORDER BY d.name LIMIT 1;
      IF v_depot IS NULL THEN CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.ops_tickets x WHERE x.quote_id = o.quote_id AND x.source = 'sales_request' AND x.depot_id = v_depot) THEN
        INSERT INTO public.ops_tickets (type, depot_id, status, priority, assigned_to, requested_by, quote_id, source, cause, notes, created_by)
        VALUES ('photo_request', v_depot, 'open', o.priority, v_tech, o.requested_by, o.quote_id, 'sales_request', o.cause,
                COALESCE(o.notes,'') || ' · ' || initcap(c.city), o.created_by);
        nn := nn + 1;
      END IF;
    END LOOP;
    -- the single request that covered several stations is replaced by the per-station ones
    IF (SELECT count(*) FROM public.ops_tickets x WHERE x.quote_id = o.quote_id AND x.source = 'sales_request' AND x.depot_id IS NOT NULL) > 0 THEN
      UPDATE public.ops_tickets SET status = 'cancelled', resolved_at = now(), updated_at = now(),
             notes = COALESCE(notes || E'\n', '') || '[replaced by one request per station - Phase 419]' WHERE id = o.id;
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only)
-- SELECT (SELECT count(*) FROM ops_issue_types WHERE is_active AND solution_en IS NOT NULL) steps_filled,
--        (SELECT count(*) FROM ops_screens WHERE is_active AND depot_id IS NULL) screens_without_station,
--        (SELECT count(*) FROM ops_tickets WHERE source='sales_request' AND status='open' AND assigned_to IS NULL) photo_unassigned,
--        (SELECT count(*) FROM ops_tickets WHERE status IN ('open','in_progress') AND source IN ('auto_offline','auto_camera')) auto_open;
