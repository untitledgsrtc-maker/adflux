-- supabase_ops_p3_issue_types.sql
-- OPERATIONS — replace the generic seeded issue types with the owner's real
-- "what was wrong" list (2026-08-27). Data-driven: the Log-a-screen-issue
-- dropdown reads ops_issue_types WHERE is_active. Non-destructive to history —
-- the old generic types are DEACTIVATED (not deleted), so existing tickets keep
-- their issue_type_id (FK intact). Idempotent + re-runnable. Owner runs in Studio.
-- ═════════════════════════════════════════════════════════════════════════

-- 1 · hide every current issue type (the generic §230 seeds + any prior run)
UPDATE public.ops_issue_types SET is_active = false;

-- 2 · insert the owner's 10 (skip if already present from a prior run)
INSERT INTO public.ops_issue_types (issue_en, issue_gu, solution_en, solution_gu, display_order, is_active)
SELECT v.issue_en, v.issue_gu, NULL, NULL, v.ord, true
FROM (VALUES
  ('Power cut',                         'પાવર કટ (વીજળી ગઈ)',            1),
  ('Light bill not paid',               'લાઇટ બિલ ભરેલું નથી',           2),
  ('Software issue',                    'સોફ્ટવેર પ્રોબ્લેમ',            3),
  ('Wiring problem',                    'વાયરિંગ પ્રોબ્લેમ',             4),
  ('Ethernet / internet issue',        'ઇન્ટરનેટ પ્રોબ્લેમ',            5),
  ('Timer issue',                       'ટાઈમર પ્રોબ્લેમ',               6),
  ('Pigeon / bird nest problem',        'કબૂતર / પક્ષીનો માળો',          7),
  ('Switch problem',                    'સ્વિચ પ્રોબ્લેમ',               8),
  ('Display / screen damage / blank',   'ડિસ્પ્લે / સ્ક્રીન ખરાબ / બ્લેન્ક', 9),
  ('Cleaning required',                 'સફાઈ જરૂરી',                    10)
) AS v(issue_en, issue_gu, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ops_issue_types t WHERE t.issue_en = v.issue_en
);

-- 3 · (re-run safety) make sure the owner's 10 are the active set
UPDATE public.ops_issue_types
   SET is_active = true,
       display_order = m.ord
FROM (VALUES
  ('Power cut',1),('Light bill not paid',2),('Software issue',3),('Wiring problem',4),
  ('Ethernet / internet issue',5),('Timer issue',6),('Pigeon / bird nest problem',7),
  ('Switch problem',8),('Display / screen damage / blank',9),('Cleaning required',10)
) AS m(issue_en, ord)
WHERE public.ops_issue_types.issue_en = m.issue_en;

NOTIFY pgrst, 'reload schema';

-- ==== VERIFY (run after) — expect active_count = 10, ordered list =====
-- SELECT count(*) FILTER (WHERE is_active) AS active_count FROM public.ops_issue_types;
-- SELECT display_order, issue_en, issue_gu FROM public.ops_issue_types WHERE is_active ORDER BY display_order;
