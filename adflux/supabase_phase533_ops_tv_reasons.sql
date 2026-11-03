-- Phase 533: two more reasons in the Ops "What is wrong" list: TV software problem, TV last input problem.
-- Idempotent (skips a reason that already exists).
INSERT INTO public.ops_issue_types (issue_en, issue_gu, solution_en, solution_gu, display_order, is_active)
SELECT v.en, v.gu, v.sol_en, v.sol_gu, v.ord, true
  FROM (VALUES
    ('TV software problem', 'ટીવી સોફ્ટવેર પ્રોબ્લેમ',
     E'1. Switch the TV off at the plug, wait 10 seconds, switch on.\n2. Wait 5 minutes - does the ad come back?\n3. If the TV shows its own menu or an error, take a photo and tell the head.',
     E'૧. ટીવી પ્લગથી બંધ કરો, ૧૦ સેકન્ડ રાહ જુઓ, ચાલુ કરો.\n૨. ૫ મિનિટ રાહ જુઓ - જાહેરાત પાછી આવે છે?\n૩. ટીવી પર મેનુ કે એરર દેખાય તો ફોટો પાડી હેડને જણાવો.', 12),
    ('TV last input problem', 'ટીવી લાસ્ટ ઇનપુટ પ્રોબ્લેમ',
     E'1. The TV came on but shows the wrong source (blue / "no signal").\n2. Press INPUT / SOURCE on the remote and pick the player box (HDMI).\n3. If it falls back again after power cut, take a photo and tell the head.',
     E'૧. ટીવી ચાલુ છે પણ ખોટો સોર્સ (બ્લુ / "નો સિગ્નલ") દેખાય છે.\n૨. રિમોટમાં INPUT / SOURCE દબાવી પ્લેયર બોક્સ (HDMI) પસંદ કરો.\n૩. પાવર કટ પછી ફરી આવું થાય તો ફોટો પાડી હેડને જણાવો.', 13)
  ) AS v(en, gu, sol_en, sol_gu, ord)
 WHERE NOT EXISTS (SELECT 1 FROM public.ops_issue_types t WHERE lower(t.issue_en) = lower(v.en));

NOTIFY pgrst, 'reload schema';

-- VERIFY: 2 rows, both is_active = true
-- SELECT issue_en, is_active, display_order FROM public.ops_issue_types WHERE issue_en IN ('TV software problem','TV last input problem');
