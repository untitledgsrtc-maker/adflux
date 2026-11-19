-- =============================================================================
-- Phase 629.1 (19-11-2026): better estimate for backfilled lost dates.
-- 629 / 628 fell back to updated_at (last EDIT, e.g. yesterday's score/flag writes)
-- when no closure record existed -> Lost shown as 18 Nov for a lead last contacted
-- 23 Oct. New order: lead follow-ups closed for the loss -> the quote's follow-ups
-- closed for "quote lost" -> last_contact_at -> updated_at. Only rows the backfill made
-- (note 'Recorded later - date estimated') and only the 90 quotes whose lost_at came
-- from updated_at are touched. Real stamps (trigger, live changes) are never changed.
-- =============================================================================
BEGIN;

UPDATE public.lead_stage_log s SET changed_at = COALESCE(
    (SELECT max(f.done_at) FROM public.follow_ups f
      WHERE f.lead_id = s.lead_id
        AND (f.done_note ILIKE '%auto-closed: lead marked Lost%' OR f.done_note LIKE 'Auto-closed: lead is Lost%')),
    (SELECT min(f.done_at) FROM public.follow_ups f JOIN public.quotes q ON q.id = f.quote_id
      WHERE q.lead_id = s.lead_id AND f.done_note LIKE 'Auto-closed: quote lost%'),
    l.last_contact_at,
    l.updated_at)
  FROM public.leads l
 WHERE l.id = s.lead_id AND s.new_stage = 'Lost' AND s.note = 'Recorded later - date estimated';

ALTER TABLE public.quotes DISABLE TRIGGER quotes_updated_at;
UPDATE public.quotes q SET lost_at = COALESCE(
    (SELECT max(f.done_at) FROM public.follow_ups f
      WHERE f.lead_id = q.lead_id
        AND (f.done_note ILIKE '%auto-closed: lead marked Lost%' OR f.done_note LIKE 'Auto-closed: lead is Lost%')),
    (SELECT GREATEST(l.last_contact_at, q.created_at) FROM public.leads l WHERE l.id = q.lead_id),
    q.updated_at)
 WHERE q.status = 'lost' AND q.lost_at = q.updated_at
   AND NOT EXISTS (SELECT 1 FROM public.follow_ups f WHERE f.quote_id = q.id AND f.done_note LIKE 'Auto-closed: quote lost%');
ALTER TABLE public.quotes ENABLE TRIGGER quotes_updated_at;

COMMIT;

-- VERIFY:
SELECT (SELECT changed_at::date FROM public.lead_stage_log
         WHERE lead_id = 'a5d9cfa4-9a36-4aba-9429-b788f1f62264' AND new_stage = 'Lost') AS sample_lost_day,   -- 2026-10-23
       (SELECT count(*) FROM public.lead_stage_log
         WHERE note = 'Recorded later - date estimated' AND changed_at::date >= '2026-11-18') AS still_recent;    -- small
