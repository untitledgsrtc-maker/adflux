-- =============================================================================
-- Phase 629 (19-11-2026, owner: "lost leads stage not logged in leads, every log
-- should be there"). The lead page timeline only showed stage changes made from the
-- stage menu (status_change activities: 86 of 10,319 Lost leads). Lost via a
-- Negative call, a lost quote, bulk change or import left no trace.
--   * lead_stage_log (Phase 610 trigger, every UPDATE path) becomes the timeline's
--     stage source; anyone who can SEE the lead can read its stage history
--     (was: only admin / the person who made the change / their manager).
--   * Backfill, ONCE, for history before 19-11-2026 (changed_by NULL, note says the
--     date is estimated): Lost, Won, and Quote sent entries for leads that have none.
--     Lost date = when its follow-ups were closed for the loss, else its quote's
--     lost_at, else the lead's last edit. Won = leads.won_at. Quote sent = first quote.
--   Backfilled rows have changed_by NULL, so they never show on a rep's day page.
-- =============================================================================
BEGIN;

ALTER TABLE public.lead_stage_log ADD COLUMN IF NOT EXISTS note text;

DROP POLICY IF EXISTS lsl_lead_read ON public.lead_stage_log;
CREATE POLICY lsl_lead_read ON public.lead_stage_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_stage_log.lead_id));

INSERT INTO public.lead_stage_log (lead_id, old_stage, new_stage, lost_reason, changed_by, changed_at, note)
SELECT l.id, NULL, 'QuoteSent', NULL, NULL, q.first_at, 'Recorded later - first quote date'
  FROM public.leads l
  JOIN LATERAL (SELECT min(created_at) AS first_at FROM public.quotes WHERE lead_id = l.id) q ON q.first_at IS NOT NULL
 WHERE NOT EXISTS (SELECT 1 FROM public.lead_stage_log s WHERE s.lead_id = l.id AND s.new_stage = 'QuoteSent');

INSERT INTO public.lead_stage_log (lead_id, old_stage, new_stage, lost_reason, changed_by, changed_at, note)
SELECT l.id, NULL, 'Won', NULL, NULL, l.won_at, 'Recorded later - won date'
  FROM public.leads l
 WHERE l.stage = 'Won' AND l.won_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.lead_stage_log s WHERE s.lead_id = l.id AND s.new_stage = 'Won');

INSERT INTO public.lead_stage_log (lead_id, old_stage, new_stage, lost_reason, changed_by, changed_at, note)
SELECT l.id, NULL, 'Lost', l.lost_reason, NULL,
       COALESCE(
         (SELECT max(f.done_at) FROM public.follow_ups f
           WHERE f.lead_id = l.id
             AND (f.done_note ILIKE '%auto-closed: lead marked Lost%' OR f.done_note LIKE 'Auto-closed: lead is Lost%')),
         (SELECT max(q.lost_at) FROM public.quotes q WHERE q.lead_id = l.id),
         l.updated_at),
       'Recorded later - date estimated'
  FROM public.leads l
 WHERE l.stage = 'Lost'
   AND NOT EXISTS (SELECT 1 FROM public.lead_stage_log s WHERE s.lead_id = l.id AND s.new_stage = 'Lost');

COMMIT;
NOTIFY pgrst, 'reload schema';

-- VERIFY:
SELECT (SELECT count(*) FROM public.leads l WHERE l.stage = 'Lost'
          AND NOT EXISTS (SELECT 1 FROM public.lead_stage_log s WHERE s.lead_id = l.id AND s.new_stage = 'Lost')) AS lost_without_log,  -- 0
       (SELECT count(*) FROM public.lead_stage_log WHERE note LIKE 'Recorded later%') AS backfilled,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'lead_stage_log' AND policyname = 'lsl_lead_read') AS lead_read_policy;     -- 1
