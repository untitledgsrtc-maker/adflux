-- supabase_phase31n_stage_v3.sql
--
-- Phase 31N (10 May 2026) — restore Nurture as a 6th stage.
--
-- Owner directive: a lead in QuoteSent whose customer says "revisit
-- next quarter" is a real signal that Phase 30A merged into Lost or
-- Working — both wrong. Nurture comes back as a parked-but-open state
-- that requires a revisit_date so deals don't sit forever.
--
-- What this migration does:
--   1. Adds 'Nurture' to the leads.stage CHECK constraint.
--   2. Adds leads.revisit_date date column (used only when
--      stage='Nurture'; nullable for every other stage).
--   3. Adds an index for dashboards / cron jobs that want to find
--      leads whose Nurture revisit_date has passed.
--   4. Idempotent — safe to re-run.
--
-- Existing data: nothing to backfill. The Phase 30A migration already
-- converted all old 'Nurture' rows to 'Working'. Reps will set new
-- leads to Nurture going forward via the ChangeStageModal.
--
-- Stage transitions enforced in the app (NOT at DB level — keep RLS
-- simple and let the modal validate):
--   New      → Working
--   Working  → QuoteSent (auto when quote.status='sent')
--   QuoteSent → Won | Lost | Nurture
--   Nurture  → QuoteSent | Won | Lost   (rep reactivates when ready)
--   Won/Lost → terminal (no transitions out)

-- 1) Drop + recreate the stage CHECK to add Nurture.
--    Postgres has no "alter check constraint" — drop + add is the path.
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_stage_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_stage_check
  CHECK (stage IN ('New', 'Working', 'QuoteSent', 'Nurture', 'Won', 'Lost'));

-- 2) Add revisit_date — nullable, no default. Only meaningful for
--    Nurture rows. The frontend defaults it to today + 30 days when
--    the rep moves a lead to Nurture; reps can edit before saving.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS revisit_date date;

-- 3) Index for the "Nurture leads ready to revisit" query the
--    dashboard / Action Inbox will use. Partial index keeps it small —
--    we only care about rows in Nurture stage.
CREATE INDEX IF NOT EXISTS idx_leads_nurture_revisit
  ON public.leads (revisit_date)
  WHERE stage = 'Nurture';

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT consrc FROM pg_constraint WHERE conname = 'leads_stage_check';
--   (Postgres 12+: SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'leads_stage_check';)
--   should include 'Nurture' in the IN (...) list.
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='leads'
--    AND column_name='revisit_date';
--   should return 1 row.
