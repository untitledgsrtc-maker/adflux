-- supabase_ops_p4_station_cleanup.sql
-- F2 — dedupe + de-test the station registry (owner diagnostic 27 Aug 2026).
-- The aiadflux CMS has multiple groups for one physical station (e.g. "Dwrka Bus
-- Stand" + "DWARKA GSRTC BUS STAND") + a "Test Untitled" group; the sync made a
-- depot for each. Non-destructive: deactivate (is_active=false), NEVER DELETE
-- (old tickets FK a depot). Run PART 1, paste the result; PART 2 is safe now; fill
-- PART 2b merges from PART 1. The permanent fix is deduping the groups in aiadflux.

-- ==== PART 1 · DIAGNOSTIC (run + paste back) =================================
-- Depots + live screen counts + a normalized key. Rows sharing norm_key are the
-- same physical station (dups); a 'test' name is a test row.
SELECT d.id, d.name, d.external_group_id, d.is_active,
       (SELECT count(*) FROM public.ops_screens s WHERE s.depot_id = d.id AND s.is_active) AS screens,
       regexp_replace(lower(d.name), 'gsrtc|gidc|bus ?stand|bus ?stop|stand|depot|station|[^a-z0-9]', '', 'g') AS norm_key
  FROM public.ops_depots d
 ORDER BY norm_key, screens DESC;

-- ==== PART 2 · TEST ROWS (safe to run now) ==================================
-- Deactivate every test depot + its screens (hidden from all station views).
UPDATE public.ops_screens SET is_active = false, updated_at = now()
 WHERE depot_id IN (SELECT id FROM public.ops_depots WHERE name ILIKE '%test%');
UPDATE public.ops_depots SET is_active = false, updated_at = now()
 WHERE name ILIKE '%test%';

-- ==== PART 2b · MERGE A DUP PAIR (fill from PART 1, then run per pair) =======
-- Keep the CANONICAL depot (B, usually the uppercase "… GSRTC …" one with more
-- screens); move the DUP's (A) screens + tickets onto B, then deactivate A.
-- REPLACE the two uuids and run once per dup pair:
--   UPDATE public.ops_screens SET depot_id = '<B_canonical>', updated_at = now() WHERE depot_id = '<A_dup>';
--   UPDATE public.ops_tickets  SET depot_id = '<B_canonical>', updated_at = now() WHERE depot_id = '<A_dup>';
--   UPDATE public.ops_depots   SET is_active = false, updated_at = now() WHERE id = '<A_dup>';

NOTIFY pgrst, 'reload schema';

-- ==== VERIFY (after PART 2 / 2b) ============================================
-- Expect: active depots down by the number of test + merged dups; no active
-- depot whose norm_key repeats among other ACTIVE depots.
-- SELECT count(*) FILTER (WHERE is_active) AS active_depots,
--        count(*) FILTER (WHERE NOT is_active) AS inactive_depots
--   FROM public.ops_depots;
