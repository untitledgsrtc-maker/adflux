-- Phase 523: owner 26 Oct 2026 - fix the 8 hand-added entries saved as AM that were meant as PM (Rana, Piyush, Khushbu, Akshar; 22 + 26 Oct).
-- Rule: entry without overlap after +12 h -> shifted +12 h. Entry that WOULD overlap time the person already logged -> declined
-- (the meeting is already inside their timers; shifting would double count). Declines are reversible: set status back to 'approved'.
-- Only touches source='added_later', status='approved', start before 07:00 IST, last 30 days. Idempotent (a second run finds nothing).
-- Expected today: 2 shifted (22 Oct Akshar, Piyush), 6 declined.
BEGIN;
CREATE TEMP TABLE _am_fix ON COMMIT DROP AS
SELECT e.id,
       EXISTS (SELECT 1 FROM public.work_time_entries o
                WHERE o.user_id = e.user_id AND o.id <> e.id AND o.status <> 'declined'
                  AND tstzrange(o.started_at, COALESCE(o.ended_at, now())) && tstzrange(e.started_at + interval '12 hours', e.ended_at + interval '12 hours')) AS overlaps
  FROM public.work_time_entries e
 WHERE e.source = 'added_later' AND e.status = 'approved' AND e.ended_at IS NOT NULL
   AND e.started_at > now() - interval '30 days'
   AND extract(hour FROM e.started_at AT TIME ZONE 'Asia/Kolkata') < 7;

UPDATE public.work_time_entries e
   SET started_at = e.started_at + interval '12 hours', ended_at = e.ended_at + interval '12 hours',
       note = COALESCE(e.note || ' ', '') || '[Phase 523: AM typed, shifted +12 h to PM]'
  FROM _am_fix f WHERE f.id = e.id AND NOT f.overlaps;

UPDATE public.work_time_entries e
   SET status = 'declined', decided_at = now(),
       decided_by = (SELECT id FROM public.users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1),
       note = COALESCE(e.note || ' ', '') || '[Phase 523: AM typed, time already in timers - declined]'
  FROM _am_fix f WHERE f.id = e.id AND f.overlaps;
COMMIT;
NOTIFY pgrst, 'reload schema';

-- VERIFY: 0 approved hand-added entries before 07:00 IST in the last 30 days
-- SELECT count(*) FROM work_time_entries WHERE source='added_later' AND status='approved' AND started_at > now() - interval '30 days'
--   AND extract(hour FROM started_at AT TIME ZONE 'Asia/Kolkata') < 7;   -- 0
