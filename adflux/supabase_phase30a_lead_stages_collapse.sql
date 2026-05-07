-- supabase_phase30a_lead_stages_collapse.sql
--
-- Phase 30A — collapse 10 lead stages to 5.
--
-- Owner spec (7 May 2026): "10 statuses is too many. Reps will misuse
-- half of them and stats get noisy". Owner gave Claude full authority
-- to decide the collapse; the chosen 5 are:
--
--   New        — uncontacted, just imported / created
--   Working    — actively engaging (was: Contacted + Qualified +
--                SalesReady + MeetingScheduled)
--   QuoteSent  — proposal out, awaiting response (was: QuoteSent +
--                Negotiating)
--   Won        — closed deal
--   Lost       — closed, dead. Long-tail "revisit later" leads keep
--                their nurture_revisit_date column populated; reps
--                filter by that column to surface them.
--
-- Migration steps (idempotent):
--   1. Drop the existing 10-value CHECK constraint.
--   2. UPDATE all rows to the new 5-stage vocabulary.
--      Nurture → Lost. If nurture_revisit_date is null, set it to
--      NOW() + 90 days so the lead can be filtered back later.
--   3. Recreate the CHECK constraint with the 5 new values.
--   4. Reload PostgREST schema.
--
-- The schema markers `qualified_at`, `sales_ready_at`,
-- `handoff_sla_due_at` columns are KEPT — they record the moment
-- those events happened, even though they're no longer distinct
-- stages. Telecaller→sales handoff SLA logic now keys off
-- `handoff_sla_due_at IS NOT NULL AND stage = 'Working'`.

BEGIN;

-- 1) Drop existing CHECK constraint (the SQL was inline on the column,
--    so drop by named constraint if it exists, otherwise via ALTER COLUMN
--    rewriting the constraint).
ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_stage_check;

-- 2) Backfill stage values to the new vocabulary BEFORE re-adding
--    the constraint (otherwise the CHECK fails on the legacy rows).
UPDATE public.leads
   SET stage = 'Working'
 WHERE stage IN ('Contacted', 'Qualified', 'SalesReady', 'MeetingScheduled');

UPDATE public.leads
   SET stage = 'QuoteSent'
 WHERE stage = 'Negotiating';

UPDATE public.leads
   SET stage = 'Lost',
       nurture_revisit_date = COALESCE(nurture_revisit_date, (NOW() + INTERVAL '90 days')::date)
 WHERE stage = 'Nurture';

-- 3) Re-add the CHECK constraint with the 5 new values.
ALTER TABLE public.leads
  ADD CONSTRAINT leads_stage_check
  CHECK (stage IN ('New', 'Working', 'QuoteSent', 'Won', 'Lost'));

COMMIT;

-- 4) Reload PostgREST so it picks up the new CHECK without a connection
--    bounce.
NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT stage, COUNT(*) FROM public.leads GROUP BY stage ORDER BY stage;
--   Expect: New / Working / QuoteSent / Won / Lost (no Contacted /
--   Qualified / SalesReady / MeetingScheduled / Negotiating / Nurture).
--
-- SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname = 'leads_stage_check';
--   Expect: CHECK ((stage = ANY (ARRAY['New'::text, 'Working'::text, 'QuoteSent'::text, 'Won'::text, 'Lost'::text])))
--
-- SELECT name, stage, nurture_revisit_date FROM public.leads
--  WHERE nurture_revisit_date IS NOT NULL ORDER BY nurture_revisit_date;
--   Expect: ex-Nurture leads with revisit dates ~90 days out.
