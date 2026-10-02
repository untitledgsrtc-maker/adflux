-- supabase_phase326_holidays_fy2026_27.sql
--
-- Fill the company holiday calendar with the OFFICIAL FY2026-27 list (the same
-- 10 names printed on every offer letter, CLAUDE.md §296). Until now the
-- `holidays` table held only 4 national days (Phase 12 seed) and NO festival
-- days, so Dussehra/Diwali/... were treated as WORKING days: the 8:30 PM
-- tick_attendance job would mark every sales rep + telecaller who did not check
-- in as `unpaid_absent` (a full-day salary cut, §78) on a day the company is
-- closed.
--
-- Same rows you can add by hand in Master -> Holidays. Idempotent: re-running
-- adds nothing (UNIQUE (holiday_date, name) + ON CONFLICT DO NOTHING).
--
-- DATES (Gujarat government 2026 holiday notification + Gujarat 2027 calendars;
-- lunar festivals - CONFIRM the two flagged ones before running):
--   Raksha Bandhan ............ Fri 28 Aug 2026   (already past - recorded for completeness)
--   Janmashtami ............... Fri  4 Sep 2026   (already past - recorded for completeness)
--   Dussehra .................. Tue 20 Oct 2026   <- first one that matters
--   Diwali .................... Sun  8 Nov 2026   (a Sunday: already off, row is for the record)
--   Extra Diwali Holiday ...... Mon  9 Nov 2026   (owner: Diwali block = 8 to 12 Nov)
--   Gujarati New Year (Bestu Varas) Tue 10 Nov 2026
--   Bhai Dooj / Bhai Bij ...... Wed 11 Nov 2026
--   Extra Diwali Holiday ...... Thu 12 Nov 2026   (owner: Diwali block = 8 to 12 Nov)
--   Makar Sankranti / Uttarayan  Thu 14 Jan 2027   (CONFIRM: one calendar says Fri 15 Jan)
--   Holi ...................... Mon 22 Mar 2027   (CONFIRM: one list shows the colour day as Tue 23 Mar)
--
-- All 10 names on the offer letter are covered: 5 Diwali-block days (8 to 12 Nov,
-- Mon 9 + Thu 12 are the two "Extra Diwali Holiday" days) + 5 other festivals.
--
-- Does NOT touch the 4 seeded national days (Republic Day, Independence Day,
-- Gandhi Jayanti, Christmas). The company's list does not include them; whether
-- it really works those days is the owner's call - see the commented block at the
-- bottom.

INSERT INTO public.holidays (holiday_date, name, type, is_recurring, is_active) VALUES
  ('2026-08-28', 'Raksha Bandhan',                  'gujarat_festival', false, true),
  ('2026-09-04', 'Janmashtami',                     'gujarat_festival', false, true),
  ('2026-10-20', 'Dussehra',                        'gujarat_festival', false, true),
  ('2026-11-08', 'Diwali',                          'gujarat_festival', false, true),
  ('2026-11-09', 'Extra Diwali Holiday',            'gujarat_festival', false, true),
  ('2026-11-10', 'Gujarati New Year / Bestu Varas', 'gujarat_festival', false, true),
  ('2026-11-11', 'Bhai Dooj / Bhai Bij',            'gujarat_festival', false, true),
  ('2026-11-12', 'Extra Diwali Holiday',            'gujarat_festival', false, true),
  ('2027-01-14', 'Makar Sankranti / Uttarayan',     'gujarat_festival', false, true),
  ('2027-03-22', 'Holi',                            'gujarat_festival', false, true)
ON CONFLICT (holiday_date, name) DO NOTHING;


-- ---------------------------------------------------------------------------
-- OPTIONAL - run ONLY after you decide the company works these days.
-- Deleting makes the day a normal working day everywhere (check-in required,
-- scored, 8:30 PM auto-absent applies). Aug 15 2026 and Oct 2 2026 are past/today
-- - leave them; this is for the FUTURE national rows.
--
--   DELETE FROM public.holidays
--    WHERE name IN ('Christmas', 'Republic Day', 'Independence Day', 'Gandhi Jayanti')
--      AND holiday_date > (now() AT TIME ZONE 'Asia/Kolkata')::date;
-- ---------------------------------------------------------------------------


-- VERIFY: every holiday in FY2026-27, in date order. Expect the 10 rows above
-- (plus the seeded national days and anything you added before). A festival that
-- shows TWICE on the same date means an earlier row used a slightly different
-- spelling - delete the duplicate in Master -> Holidays.
SELECT holiday_date,
       to_char(holiday_date, 'Dy')  AS day,
       name, type, is_active
  FROM public.holidays
 WHERE holiday_date BETWEEN '2026-04-01' AND '2027-03-31'
 ORDER BY holiday_date, name;
