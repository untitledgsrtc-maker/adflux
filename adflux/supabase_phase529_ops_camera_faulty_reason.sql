-- Phase 529: "Camera faulty" reason in the Ops "What is wrong" list.
-- Idempotent. The central call numbers (hardware, accounts) live in OpsTechApp.jsx, not in the DB.
INSERT INTO public.ops_issue_types (issue_en, issue_gu, solution_en, solution_gu, display_order, is_active)
SELECT 'Camera faulty', 'કેમેરા ખરાબ',
       E'1. Check the camera cable and power at the box.\n2. Switch the camera off, wait 10 seconds, switch on.\n3. Still off? Take a photo and call the hardware number.',
       E'૧. બોક્સ પર કેમેરાનો કેબલ અને પાવર તપાસો.\n૨. કેમેરા બંધ કરો, ૧૦ સેકન્ડ રાહ જુઓ, ચાલુ કરો.\n૩. હજી બંધ હોય તો ફોટો પાડો અને હાર્ડવેર નંબર પર કૉલ કરો.',
       11, true
 WHERE NOT EXISTS (SELECT 1 FROM public.ops_issue_types WHERE lower(issue_en) = 'camera faulty');

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect 1 row, is_active = true
-- SELECT issue_en, is_active, display_order FROM public.ops_issue_types WHERE lower(issue_en) = 'camera faulty';
