-- =============================================================================
-- Phase 628 (19-11-2026, owner): Quotes list Follow up column shows WHEN the last
-- follow-up was done and, for a lost quote, WHEN it was lost.
-- quotes had no lost date (only won_at). Adds quotes.lost_at, stamped whenever
-- status becomes 'lost', and backfills the 414 existing lost quotes from the best
-- record we have, in this order:
--   1. the quote's own follow-ups closed by quote_terminal_close_followups
--      ('Auto-closed: quote lost' - done_at = the moment it was marked lost);
--   2. the lead's first move to Lost in lead_stage_log (Phase 610, recent only);
--   3. the lead's follow-ups closed when the lead was marked Lost;
--   4. quotes.updated_at (last edit - approximate).
-- Then run db/functions/team_all_quotes.sql (follow_ups embed gains done_at).
-- =============================================================================
BEGIN;

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS lost_at timestamptz;

CREATE OR REPLACE FUNCTION public.quote_stamp_lost_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'lost' THEN NEW.lost_at := COALESCE(NEW.lost_at, now()); END IF;
  ELSIF NEW.status = 'lost' AND OLD.status IS DISTINCT FROM 'lost' THEN
    NEW.lost_at := now();          -- every move INTO lost re-stamps (lost -> reopened -> lost)
  ELSIF NEW.status IS DISTINCT FROM 'lost' AND OLD.status = 'lost' THEN
    NEW.lost_at := NULL;           -- reopened: no stale lost date
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.quote_stamp_lost_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_quote_stamp_lost_at ON public.quotes;
CREATE TRIGGER trg_quote_stamp_lost_at BEFORE INSERT OR UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quote_stamp_lost_at();

-- Backfill without touching updated_at (the list sorts / dates by it elsewhere).
ALTER TABLE public.quotes DISABLE TRIGGER quotes_updated_at;
UPDATE public.quotes q SET lost_at = COALESCE(
    (SELECT min(f.done_at) FROM public.follow_ups f
      WHERE f.quote_id = q.id AND f.done_note LIKE 'Auto-closed: quote lost%'),
    (SELECT min(s.changed_at) FROM public.lead_stage_log s
      WHERE s.lead_id = q.lead_id AND s.new_stage = 'Lost'),
    (SELECT max(f.done_at) FROM public.follow_ups f
      WHERE f.lead_id = q.lead_id
        AND (f.done_note LIKE '%auto-closed: lead marked Lost%' OR f.done_note LIKE 'Auto-closed: lead is Lost%')),
    q.updated_at)
 WHERE q.status = 'lost' AND q.lost_at IS NULL;
ALTER TABLE public.quotes ENABLE TRIGGER quotes_updated_at;

COMMIT;
NOTIFY pgrst, 'reload schema';

-- VERIFY:
SELECT count(*) FILTER (WHERE status = 'lost') AS lost_quotes,               -- 414 on 19-11-2026
       count(*) FILTER (WHERE status = 'lost' AND lost_at IS NULL) AS no_date, -- 0
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_quote_stamp_lost_at') AS stamp_trigger  -- 1
  FROM public.quotes;
