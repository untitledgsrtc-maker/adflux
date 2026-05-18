-- supabase_phase47_5_dnc_optout.sql
-- Phase 47.5 — DNC (Do Not Call) + WhatsApp opt-out flags on leads.
-- 18 May 2026
--
-- Owner directive: when a lead says "STOP" / "don't call me", we
-- must stop. Adds two boolean flags + reason + timestamp. UI then
-- disables call/WA buttons when flagged.
--
-- Schema additions on public.leads:
--   do_not_call boolean DEFAULT false
--   wa_opt_out  boolean DEFAULT false
--   dnc_reason  text (optional — why the customer asked to stop)
--   dnc_at      timestamptz (when the flag was set)
--
-- No backfill (existing leads are false by default).
-- Idempotent.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS do_not_call boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wa_opt_out  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dnc_reason  text,
  ADD COLUMN IF NOT EXISTS dnc_at      timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_dnc
  ON public.leads (do_not_call)
  WHERE do_not_call = true;
CREATE INDEX IF NOT EXISTS idx_leads_wa_optout
  ON public.leads (wa_opt_out)
  WHERE wa_opt_out = true;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='leads'
      AND column_name IN ('do_not_call','wa_opt_out','dnc_reason','dnc_at'))  AS new_cols;

-- Expected: new_cols = 4
