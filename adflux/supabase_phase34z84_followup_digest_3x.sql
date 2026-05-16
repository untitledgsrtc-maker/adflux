-- supabase_phase34z84_followup_digest_3x.sql
-- Phase 34Z.84 — 3-times-a-day follow-up digest push.
-- 16 May 2026
--
-- Owner directive: "I want today follow-up notification 3 times a
-- day with actual number of total follow-up. Ex: still you have 3
-- follow-up pending, 2 renewal call, 1 payment follow-up, 2 quote
-- send follow-up. 3-4 notification every day."
--
-- Replaces the single 9 AM rollup (Phase 33W push_daily_reminders)
-- with a category breakdown that fires 3x per day at IST:
--   09:00 — Morning digest
--   13:00 — Midday update
--   17:00 — Evening reminder
--
-- Each push body lists the open buckets with counts, skipping any
-- bucket whose count is zero. Rep with all zeros gets no push.
--
-- Buckets (Phase 33D.6 cadence_type + payment join):
--   - Pending follow-up   : lead_intro
--   - Quote chase         : quote_chase
--   - Nurture revisit     : nurture | lost_nurture
--   - Payment follow-up   : won quote with outstanding amount and
--                           an open follow_up linked to it
--
-- Idempotent. Skip Sunday + holidays.

-- ─── 1. The digest function ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_followup_digest(p_label text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_dow   int  := EXTRACT(DOW FROM v_today)::int;
  v_holiday boolean;
  v_user  record;
  v_pending int; v_chase int; v_nurture int; v_pay int;
  v_total int;
  v_body text;
  v_parts text[];
  v_count int := 0;
BEGIN
  IF v_dow = 0 THEN RETURN 0; END IF;  -- Sunday off
  SELECT EXISTS(
    SELECT 1 FROM public.holidays
     WHERE holiday_date = v_today AND COALESCE(is_active, true)
  ) INTO v_holiday;
  IF v_holiday THEN RETURN 0; END IF;

  FOR v_user IN
    SELECT id, name FROM public.users
     WHERE role IN ('sales','agency','telecaller')
       AND COALESCE(is_active, true) = true
  LOOP
    -- Pending lead-intro follow-ups due today or overdue.
    SELECT COUNT(*) INTO v_pending
      FROM public.follow_ups
     WHERE assigned_to = v_user.id
       AND is_done = false
       AND follow_up_date <= v_today
       AND cadence_type = 'lead_intro';

    -- Quote chases (rep waiting for client decision after quote sent).
    SELECT COUNT(*) INTO v_chase
      FROM public.follow_ups
     WHERE assigned_to = v_user.id
       AND is_done = false
       AND follow_up_date <= v_today
       AND cadence_type = 'quote_chase';

    -- Nurture revisits (parked + lost_nurture).
    SELECT COUNT(*) INTO v_nurture
      FROM public.follow_ups
     WHERE assigned_to = v_user.id
       AND is_done = false
       AND follow_up_date <= v_today
       AND cadence_type IN ('nurture', 'lost_nurture');

    -- Payment follow-ups: open follow_ups linked to won quotes that
    -- still have outstanding amount.
    SELECT COUNT(DISTINCT fu.id) INTO v_pay
      FROM public.follow_ups fu
      JOIN public.quotes q ON q.id = fu.quote_id
      LEFT JOIN public.payments p ON p.quote_id = q.id
       AND COALESCE(p.approval_status, 'approved') = 'approved'
     WHERE fu.assigned_to = v_user.id
       AND fu.is_done = false
       AND fu.follow_up_date <= v_today
       AND q.status = 'won'
     GROUP BY fu.id, q.total_amount
     HAVING q.total_amount - COALESCE(SUM(p.amount_received), 0) > 0;
    v_pay := COALESCE(v_pay, 0);

    v_total := v_pending + v_chase + v_nurture + v_pay;
    IF v_total = 0 THEN CONTINUE; END IF;

    v_parts := ARRAY[]::text[];
    IF v_pending > 0 THEN
      v_parts := array_append(v_parts,
        v_pending || ' follow-up' || CASE WHEN v_pending > 1 THEN 's' ELSE '' END);
    END IF;
    IF v_chase > 0 THEN
      v_parts := array_append(v_parts,
        v_chase || ' quote chase' || CASE WHEN v_chase > 1 THEN 's' ELSE '' END);
    END IF;
    IF v_nurture > 0 THEN
      v_parts := array_append(v_parts,
        v_nurture || ' nurture');
    END IF;
    IF v_pay > 0 THEN
      v_parts := array_append(v_parts,
        v_pay || ' payment chase' || CASE WHEN v_pay > 1 THEN 's' ELSE '' END);
    END IF;

    v_body := array_to_string(v_parts, ' · ');

    PERFORM public.enqueue_push(
      v_user.id,
      p_label || ' · ' || v_total || ' pending today',
      v_body,
      '/follow-ups',
      'digest-' || to_char(v_today, 'YYYY-MM-DD') || '-' || lower(p_label)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.push_followup_digest(text) TO authenticated;


-- ─── 2. Cron schedule — 3 times daily IST ────────────────────────
-- Convert IST → UTC: subtract 5h30m.
--   09:00 IST = 03:30 UTC
--   13:00 IST = 07:30 UTC
--   17:00 IST = 11:30 UTC

DO $$
BEGIN
  PERFORM cron.unschedule('untitled-digest-morning');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('untitled-digest-midday');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('untitled-digest-evening');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Phase 34Z.84 — also unschedule the old single-9-AM rollup so we
-- don't double-fire alongside the new morning digest. The function
-- push_daily_reminders stays in case admin calls it manually.
DO $$
BEGIN
  PERFORM cron.unschedule('untitled-daily-reminders');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'untitled-digest-morning',
  '30 3 * * *',  -- 03:30 UTC = 09:00 IST
  $$ SELECT public.push_followup_digest('Morning'); $$
);
SELECT cron.schedule(
  'untitled-digest-midday',
  '30 7 * * *',  -- 07:30 UTC = 13:00 IST
  $$ SELECT public.push_followup_digest('Midday'); $$
);
SELECT cron.schedule(
  'untitled-digest-evening',
  '30 11 * * *',  -- 11:30 UTC = 17:00 IST
  $$ SELECT public.push_followup_digest('Evening'); $$
);


NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'push_followup_digest')           AS fn_present,
  (SELECT count(*) FROM cron.job WHERE jobname LIKE 'untitled-digest-%')           AS cron_count,
  (SELECT count(*) FROM cron.job WHERE jobname = 'untitled-daily-reminders')       AS old_cron_present;

-- Fire once manually to test:
-- SELECT public.push_followup_digest('Test');
