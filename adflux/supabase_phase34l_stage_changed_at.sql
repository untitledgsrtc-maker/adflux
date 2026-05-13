-- =====================================================================
-- Phase 34L — leads.stage_changed_at + auto-stamp trigger
-- 13 May 2026
--
-- Owner spec (CSV review reply, 13 May): pick item A from the
-- audit shortlist — "days in current stage" badge on every lead.
-- Red after 5 days, amber after 3 days. The badge needs an accurate
-- timestamp for "when did this lead last move stages?". Computing
-- it client-side from the latest status_change activity is one
-- extra round-trip per row; persisting it on the leads row keeps
-- the list query a single fetch.
--
-- WHAT THIS MIGRATION DOES
--
-- 1. Add leads.stage_changed_at timestamptz.
-- 2. Backfill: latest lead_activities row with activity_type =
--    'status_change' for each lead → falls back to leads.created_at
--    if there are no status_change activities yet.
-- 3. BEFORE UPDATE trigger: when stage actually changes
--    (NEW.stage IS DISTINCT FROM OLD.stage), stamp now() onto
--    stage_changed_at. Leaves the column untouched on other column
--    edits.
-- 4. BEFORE INSERT default: any new lead gets now() so the badge
--    starts counting from day 0.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

-- ─── 1. Column ───────────────────────────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_stage_changed_at
  ON public.leads (stage_changed_at)
  WHERE stage_changed_at IS NOT NULL;


-- ─── 2. Backfill ─────────────────────────────────────────────────────
-- For existing leads with NULL stage_changed_at, use the latest
-- status_change activity timestamp. If none, fall back to
-- created_at. Wrapped in a single UPDATE for efficiency.
UPDATE public.leads l
   SET stage_changed_at = COALESCE(
         (SELECT MAX(a.created_at)
            FROM public.lead_activities a
           WHERE a.lead_id = l.id
             AND a.activity_type = 'status_change'),
         l.created_at,
         now()
       )
 WHERE l.stage_changed_at IS NULL;


-- ─── 3. Stamp trigger ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lead_stamp_stage_changed_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- On UPDATE, only stamp when stage actually moves.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.stage IS DISTINCT FROM OLD.stage THEN
      NEW.stage_changed_at := now();
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.stage_changed_at := COALESCE(NEW.stage_changed_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_stamp_stage_changed_at ON public.leads;
CREATE TRIGGER trg_lead_stamp_stage_changed_at
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_stamp_stage_changed_at();


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='leads' AND column_name='stage_changed_at') AS col_exists,
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_lead_stamp_stage_changed_at') AS trigger_exists,
  (SELECT count(*) FROM public.leads WHERE stage_changed_at IS NULL) AS null_count_should_be_zero;
