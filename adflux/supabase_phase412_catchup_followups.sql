-- supabase_phase412_catchup_followups.sql  (Phase 412, 2026-10-18, owner chose plan A)
-- ~900 active leads had NO open follow-up. Give each rep's RECENT leads one catch-up follow-up, spread over 5 working days
-- (Mon 19 - Fri 23 Oct 2026) so nobody gets a flood.
--   WHO GETS ONE : stage New / Working / QuoteSent, PRIVATE segment (government leads are never auto-chased), cadence not paused,
--                  not do-not-call, last contact (or creation) within 60 days, owner = ACTIVE sales / telecaller (rule: assigned_to -> telecaller_id),
--                  and no open follow-up already.
--   NOT TOUCHED  : leads older than 60 days (listed for the owner to review: move to Nurture or Lost), government leads, paused, DNC.
--   HOW          : follow_up_time NULL (no timed push), note starts 'Catch-up:', manual-style row (auto_generated false, no cadence_type).
--   UNDO         : DELETE FROM public.follow_ups f USING public._bak_catchup_p412 b WHERE b.follow_up_id = f.id AND NOT f.is_done;   (keep the table 30 days, then DROP it)
-- Mode: the apply script ends with COMMIT; the dry-run copy ends with ROLLBACK. Idempotent: a re-run finds nothing (every candidate now has an open row).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public._bak_catchup_p412 (
  follow_up_id uuid PRIMARY KEY,
  lead_id      uuid,
  assigned_to  uuid,
  follow_up_date date,
  bak_at       timestamptz DEFAULT now()
);
ALTER TABLE public._bak_catchup_p412 ENABLE ROW LEVEL SECURITY;

WITH cand AS (
  SELECT l.id AS lead_id,
         COALESCE(l.assigned_to, l.telecaller_id) AS owner,
         COALESCE(l.last_contact_at, l.created_at) AS last_touch
    FROM public.leads l
    JOIN public.users u ON u.id = COALESCE(l.assigned_to, l.telecaller_id) AND u.is_active AND u.role IN ('sales','telecaller')
   WHERE l.stage IN ('New','Working','QuoteSent')
     AND COALESCE(l.segment,'PRIVATE') <> 'GOVERNMENT'
     AND NOT COALESCE(l.cadence_paused,false)
     AND NOT COALESCE(l.do_not_call,false)
     AND COALESCE(l.last_contact_at, l.created_at) >= now() - interval '60 days'
     AND NOT EXISTS (SELECT 1 FROM public.follow_ups f WHERE f.lead_id = l.id AND NOT f.is_done)
),
ranked AS (
  SELECT c.*,
         row_number() OVER (PARTITION BY owner ORDER BY last_touch DESC) AS rn,
         count(*)     OVER (PARTITION BY owner) AS cnt
    FROM cand c
),
planned AS (
  SELECT lead_id, owner,
         (ARRAY['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23']::date[])[
            1 + LEAST(4, (rn - 1) / GREATEST(1, ceil(cnt / 5.0)::int))] AS due
    FROM ranked
),
ins AS (
  INSERT INTO public.follow_ups (lead_id, assigned_to, follow_up_date, follow_up_time, note, is_done, auto_generated)
  SELECT lead_id, owner, due, NULL,
         'Catch-up: no follow-up was scheduled for this lead. Call and log the result.', false, false
    FROM planned
  RETURNING id, lead_id, assigned_to, follow_up_date
)
INSERT INTO public._bak_catchup_p412 (follow_up_id, lead_id, assigned_to, follow_up_date)
SELECT id, lead_id, assigned_to, follow_up_date FROM ins;

-- report: total per person (last row = grand total)
SELECT COALESCE(u.name, 'TOTAL') AS owner, count(*) AS follow_ups, min(b.follow_up_date) AS first_day, max(b.follow_up_date) AS last_day
  FROM public._bak_catchup_p412 b JOIN public.users u ON u.id = b.assigned_to
 WHERE b.bak_at >= now() - interval '1 minute'
 GROUP BY GROUPING SETS ((u.name), ())
 ORDER BY (u.name IS NULL), 2 DESC;
-- TAIL_MARKER
