-- =====================================================================
-- Phase 33D.4 — auto follow-up for every new lead (next day 10:00 AM)
-- 11 May 2026
--
-- Owner directive: when a new lead is created, automatically schedule
-- a follow-up for the next morning. Rep sees it in /follow-ups + on
-- /work's task panel without manually setting a next-action.
--
-- Implementation:
--   1. follow_ups already has columns (quote_id, assigned_to,
--      follow_up_date, note, is_done). Add a nullable lead_id column
--      so the same table powers both quote-linked AND lead-linked
--      follow-ups. The existing `follow_ups_auto_create` trigger
--      stays — it handles the quote path.
--   2. New trigger trg_lead_auto_followup AFTER INSERT ON leads
--      → INSERT follow_ups row with lead_id, follow_up_date = tomorrow,
--      assigned_to = lead.assigned_to OR created_by.
--   3. RLS: existing fu_sales_own policy keys on assigned_to which
--      we set correctly. Add a parallel policy for lead-linked rows
--      so admin/co_owner can also see them.
--
-- Idempotent.
-- =====================================================================

-- ─── 1. Extend follow_ups with lead_id ─────────────────────────────
ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS follow_up_time time DEFAULT '10:00:00',
  ADD COLUMN IF NOT EXISTS auto_generated boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_follow_ups_lead       ON follow_ups (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follow_ups_date_open  ON follow_ups (follow_up_date) WHERE is_done = false;

-- ─── 2. Auto-create follow-up trigger on lead INSERT ───────────────
CREATE OR REPLACE FUNCTION public.lead_auto_create_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  -- Owner of the follow-up: prefer assigned_to (the rep who will
  -- action it), fall back to created_by (the person who entered the
  -- lead). One of these is always non-null for sales-created leads.
  v_owner := COALESCE(NEW.assigned_to, NEW.created_by);
  IF v_owner IS NULL THEN
    -- No owner = no actionable follow-up (e.g. legacy import). Skip.
    RETURN NEW;
  END IF;

  -- Only auto-schedule for active stages. Won/Lost/Nurture leads
  -- don't need a "first contact tomorrow" prompt.
  IF NEW.stage NOT IN ('New', 'Working') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.follow_ups (
    lead_id, assigned_to, follow_up_date, follow_up_time,
    note, auto_generated
  ) VALUES (
    NEW.id,
    v_owner,
    (CURRENT_DATE + INTERVAL '1 day')::date,
    '10:00:00',
    'Auto-scheduled: follow up with new lead',
    true
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_auto_followup ON public.leads;
CREATE TRIGGER trg_lead_auto_followup
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_auto_create_followup();

-- ─── 3. RLS update — admin/co_owner can read lead-linked follow-ups
DROP POLICY IF EXISTS "fu_admin_all" ON public.follow_ups;
CREATE POLICY "fu_admin_all" ON public.follow_ups FOR ALL
  USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

-- Existing fu_sales_own policy already covers assigned_to = auth.uid()
-- for sales / agency. Lead-linked rows inherit that gate. No change.

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='follow_ups' AND column_name='lead_id') AS lead_id_exists,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='follow_ups' AND column_name='follow_up_time') AS time_exists,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname='trg_lead_auto_followup') AS trigger_exists;
