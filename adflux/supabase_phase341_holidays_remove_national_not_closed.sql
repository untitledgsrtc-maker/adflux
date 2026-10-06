-- =====================================================================
-- supabase_phase341_holidays_remove_national_not_closed.sql
-- Holidays: remove the FUTURE national days the company does NOT close.
-- (Owner 2026-10-06, section 302: "Does the company really close Republic Day /
--  Independence Day / Christmas / Gandhi Jayanti? ... yes delete them".)
--
-- WHY IT MATTERS: a row in `holidays` turns that date into a closed day for the
--   whole app - no morning check-in gate, no 8:30 PM auto-absent, the day is
--   excluded from the daily score and from the leave / working-day counts. A day
--   the team actually works must NOT be listed (a working team would look "off",
--   exactly what happened on 2 Oct 2026, section 301-302).
--
-- WHAT IT DOES: deletes the 5 FUTURE rows of those four names:
--     2026-12-25 Christmas        2027-01-26 Republic Day      2027-08-15 Independence Day
--     2027-10-02 Gandhi Jayanti   2027-12-25 Christmas
--   NOT touched: the official FY2026-27 list (Dussehra, the Diwali block, Makar
--   Sankranti, Holi, ...) and every PAST row (2026-01-26, 2026-08-15, 2026-10-02) -
--   past days already happened and their attendance / score history must not move.
--
-- SAFETY: backup first (public._bak_holidays_p341, RLS on, keep 30 days); a DO
--   block aborts unless exactly 5 rows are backed up; nothing else reads these rows
--   by id. UNDO:
--     INSERT INTO public.holidays (id, holiday_date, name, type, is_recurring, is_active, notes, created_by, created_at)
--     SELECT id, holiday_date, name, type, is_recurring, is_active, notes, created_by, created_at
--       FROM public._bak_holidays_p341 ON CONFLICT DO NOTHING;
-- =====================================================================

-- ===== PART 1 - PREVIEW (read-only) =====
-- SELECT holiday_date, name FROM public.holidays
--  WHERE holiday_date > (now() AT TIME ZONE 'Asia/Kolkata')::date
--    AND type = 'national' AND name IN ('Republic Day','Independence Day','Gandhi Jayanti','Christmas')
--  ORDER BY holiday_date;

CREATE TABLE IF NOT EXISTS public._bak_holidays_p341 AS
  SELECT h.*, now() AS bak_at FROM public.holidays h WHERE false;
ALTER TABLE public._bak_holidays_p341 ENABLE ROW LEVEL SECURITY;

INSERT INTO public._bak_holidays_p341
SELECT h.*, now()
  FROM public.holidays h
 WHERE h.holiday_date > (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND h.type = 'national'
   AND h.name IN ('Republic Day', 'Independence Day', 'Gandhi Jayanti', 'Christmas')
   AND NOT EXISTS (SELECT 1 FROM public._bak_holidays_p341 b WHERE b.id = h.id);

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM public._bak_holidays_p341;
  IF v <> 5 THEN
    RAISE EXCEPTION 'Phase 341 aborted: expected 5 future national holidays in the backup, found %. Nothing was changed - re-run the PART 1 preview.', v;
  END IF;
END $$;

DELETE FROM public.holidays h
 USING public._bak_holidays_p341 b
 WHERE b.id = h.id
   AND h.holiday_date > (now() AT TIME ZONE 'Asia/Kolkata')::date;

-- ===== VERIFY (expect: backed_up 5, still_listed 0, festival_rows_kept 10, total_fy2026_27 12) =====
-- SELECT
--   (SELECT count(*) FROM public._bak_holidays_p341) AS backed_up,
--   (SELECT count(*) FROM public.holidays h JOIN public._bak_holidays_p341 b ON b.id = h.id) AS still_listed,
--   (SELECT count(*) FROM public.holidays WHERE holiday_date >= '2026-08-01' AND holiday_date < '2027-04-01' AND type <> 'national') AS festival_rows_kept,
--   (SELECT count(*) FROM public.holidays WHERE holiday_date >= '2026-04-01' AND holiday_date < '2027-04-01') AS total_fy2026_27;
