-- ============================================================================
-- supabase_phase358_leave_score_and_oct2.sql   (owner decisions 2026-10-12)
-- ============================================================================
-- RUN ORDER: 1) db/functions/compute_daily_score.sql   (adds the leave exclusion)
--            2) THIS FILE                              (re-scores the affected past days)
--
-- (A) APPROVED LEAVE DAYS from 1 Sep 2026 stop counting as 0% score days.
--     Phase 33G made the score skip an approved leave (is_leave_day); Phase 34Z.66
--     (15 May 2026) dropped it by accident. The function is fixed in step 1; this file
--     re-scores the Sept+ rows that were already stored as a normal zero day.
--     August and earlier are NOT touched (owner: same cut-off rule as the earned-incentive change).
--     Only ever RAISES a monthly average, never lowers one.
-- (B) 2 OCT 2026 WAS A WORKING DAY. The 'Gandhi Jayanti' holiday row (re-inserted on 2 Oct only to
--     stop the 20:30 auto-absent job, CLAUDE.md 302.1) is removed and 2 Oct is re-scored for the
--     sales / telecaller / agency users and, through the uptime trigger, for the ops people.
--
-- BACKUPS (KEEP 30 days, then DROP): _bak_daily_performance_p358, _bak_holidays_p358.
-- UNDO (puts the stored rows and the holiday back; the function itself is reverted by re-running the
--   previous canonical: git show 405be1f:adflux/db/functions/compute_daily_score.sql = the version just before Phase 358):
--   UPDATE public.daily_performance d SET meetings_done=b.meetings_done, meetings_target=b.meetings_target,
--          score_pct=b.score_pct, is_excluded=b.is_excluded, excluded_reason=b.excluded_reason,
--          calculated_at=b.calculated_at
--     FROM public._bak_daily_performance_p358 b WHERE b.user_id=d.user_id AND b.work_date=d.work_date;
--   INSERT INTO public.holidays (id,holiday_date,name,type,is_recurring,is_active,notes,created_by,created_at)
--     SELECT id,holiday_date,name,type,is_recurring,is_active,notes,created_by,created_at
--       FROM public._bak_holidays_p358 ON CONFLICT DO NOTHING;
-- ============================================================================

-- ─── PART 1 - backups (append-once: a re-run never overwrites the first snapshot) ───
CREATE TABLE IF NOT EXISTS public._bak_daily_performance_p358 AS
  SELECT d.*, now() AS bak_at FROM public.daily_performance d WHERE false;
CREATE TABLE IF NOT EXISTS public._bak_holidays_p358 AS
  SELECT h.*, now() AS bak_at FROM public.holidays h WHERE false;
ALTER TABLE public._bak_daily_performance_p358 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_holidays_p358          ENABLE ROW LEVEL SECURITY;

-- rows that Part 2 can change: stored as a scored day although an approved full-day leave exists
INSERT INTO public._bak_daily_performance_p358
SELECT d.*, now()
  FROM public.daily_performance d
  JOIN public.users u ON u.id = d.user_id AND u.role IN ('sales','telecaller','agency')
 WHERE d.is_excluded = false
   AND d.work_date >= DATE '2026-09-01'
   AND d.work_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND EXISTS (SELECT 1 FROM public.leaves l
                WHERE l.user_id = d.user_id AND l.leave_date = d.work_date
                  AND l.status = 'approved' AND COALESCE(l.is_half_day,false) = false)
   AND NOT EXISTS (SELECT 1 FROM public._bak_daily_performance_p358 b
                    WHERE b.user_id = d.user_id AND b.work_date = d.work_date);

-- every stored 2 Oct row (sales / telecaller / agency / ops)
INSERT INTO public._bak_daily_performance_p358
SELECT d.*, now()
  FROM public.daily_performance d
 WHERE d.work_date = DATE '2026-10-02'
   AND NOT EXISTS (SELECT 1 FROM public._bak_daily_performance_p358 b
                    WHERE b.user_id = d.user_id AND b.work_date = d.work_date);

INSERT INTO public._bak_holidays_p358
SELECT h.*, now() FROM public.holidays h
 WHERE h.holiday_date = DATE '2026-10-02'
   AND NOT EXISTS (SELECT 1 FROM public._bak_holidays_p358 b WHERE b.id = h.id);

-- ─── PART 2 - abort unless the scope is the one we shadow-checked ───
DO $$
DECLARE n_leave int; n_oct2 int;
BEGIN
  SELECT count(*) INTO n_leave FROM public._bak_daily_performance_p358 WHERE work_date >= DATE '2026-09-01' AND work_date <> DATE '2026-10-02';
  SELECT count(*) INTO n_oct2  FROM public._bak_daily_performance_p358 WHERE work_date = DATE '2026-10-02';
  IF n_leave > 40 OR n_oct2 > 30 THEN
    RAISE EXCEPTION 'Phase 358 aborted: scope larger than checked (leave rows %, 2 Oct rows %)', n_leave, n_oct2;
  END IF;
  -- "only ever RAISES an average" holds only while the leave days being re-scored carried no real score.
  -- A leave day the rep worked anyway would be dropped from the average (could lower it): stop and look.
  IF EXISTS (SELECT 1 FROM public._bak_daily_performance_p358
              WHERE work_date >= DATE '2026-09-01' AND work_date <> DATE '2026-10-02'
                AND COALESCE(score_pct,0) > 0) THEN
    RAISE EXCEPTION 'Phase 358 aborted: a leave day to re-score has a score above 0 - review before dropping it from the average';
  END IF;
END $$;

-- ─── PART 3 - (A) re-score Sept+ leave days that are stored as scored days ───
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT d.user_id, d.work_date
      FROM public.daily_performance d
      JOIN public.users u ON u.id = d.user_id AND u.role IN ('sales','telecaller','agency')
     WHERE d.is_excluded = false
       AND d.work_date >= DATE '2026-09-01'
       AND d.work_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND EXISTS (SELECT 1 FROM public.leaves l
                    WHERE l.user_id = d.user_id AND l.leave_date = d.work_date
                      AND l.status = 'approved' AND COALESCE(l.is_half_day,false) = false)
  LOOP
    PERFORM public.compute_daily_score(r.user_id, r.work_date);
  END LOOP;
END $$;

-- ─── PART 4 - (B) 2 Oct 2026 = a working day ───
DELETE FROM public.holidays
 WHERE holiday_date = DATE '2026-10-02' AND name = 'Gandhi Jayanti';

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT d.user_id FROM public.daily_performance d
      JOIN public.users u ON u.id = d.user_id AND u.role IN ('sales','telecaller','agency')
     WHERE d.work_date = DATE '2026-10-02'
  LOOP
    PERFORM public.compute_daily_score(r.user_id, DATE '2026-10-02');
  END LOOP;
END $$;

-- ops people: touching the uptime row re-runs the uptime->score trigger, which now sees a normal day
UPDATE public.ops_uptime_daily o
   SET uptime_pct = o.uptime_pct
 WHERE o.work_date = DATE '2026-10-02';

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY (read-only) ───
-- 1) no approved full-day leave since 1 Sep is still stored as a scored day (expect 0):
-- SELECT count(*) FROM public.daily_performance d JOIN public.users u ON u.id=d.user_id AND u.role IN ('sales','telecaller','agency')
--  WHERE d.is_excluded=false AND d.work_date>=DATE '2026-09-01'
--    AND EXISTS (SELECT 1 FROM public.leaves l WHERE l.user_id=d.user_id AND l.leave_date=d.work_date
--                AND l.status='approved' AND COALESCE(l.is_half_day,false)=false);
-- 2) 2 Oct is no longer a holiday and nobody's 2 Oct row says Holiday (expect 0 and 0):
-- SELECT (SELECT count(*) FROM public.holidays WHERE holiday_date=DATE '2026-10-02'),
--        (SELECT count(*) FROM public.daily_performance WHERE work_date=DATE '2026-10-02' AND excluded_reason LIKE 'Holiday:%');
