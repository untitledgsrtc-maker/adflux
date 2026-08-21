-- supabase_phase311_final.sql
-- Phase 311 FINAL (2026-08-21) — real WON date on BOTH quotes and leads, so the
-- "Won" filter dates a deal by the month it was WON, not the month it was
-- created / captured. ONE idempotent, RE-RUN-SAFE file (§154).
--
-- WHY: the /quotes Won tab (useQuotes.js) + the /leads Won filter (LeadsV2.jsx)
-- filter the Won view on won_at. A quote SENT in July but WON in August was
-- dropping out of an August filter (it dated by created_at); same on leads. The
-- frontend now degrades to created_at if the column is missing, but the correct
-- behaviour needs the column — run this.
--
-- DEFINITION (owner-locked; matches the proxy every dashboard already used, so NO
-- historical monthly total moves): for EXISTING won rows, won_at = updated_at (the
-- last-touch proxy). Rows won AFTER the trigger goes live carry the real
-- status/stage -> won timestamp (now()), which the trigger never re-dates.
--
-- RE-RUN SAFE: every write below is CREATE ... IF NOT EXISTS / CREATE OR REPLACE,
-- or a backfill gated on `won_at IS NULL` (sets only never-set values -> a second
-- run is a no-op and can NEVER move a real, already-stamped win).
--
-- ⚠ IF YOU EVER RAN the old supabase_phase311_quote_won_at.sql: its backfill dated
-- PAID deals by their final payment_date (settlement month), not the won month.
-- This file does NOT correct that in place — a re-runnable correction cannot tell a
-- payment-date artifact from a genuine win that was simply edited in a later month
-- (any edit bumps quotes.updated_at via the update_updated_at trigger), so it would
-- silently corrupt real wins. If you ran the old file at any point, TELL ME and I
-- will give a separate one-time correction. If you never ran it (won_at is a brand
-- new column), THIS FILE IS COMPLETE AND CORRECT on its own.
--
-- §45-safe: additive columns + BEFORE triggers (set NEW.won_at only) + one-time
-- backfills. No hot-path cost, no existing flow touched.

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 · quotes.won_at
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS won_at timestamptz;

-- Stamp won_at the FIRST time a quote becomes 'won' (and only then). A later edit
-- / payment on a won quote can never re-date the win (NEW.won_at IS NULL guard).
CREATE OR REPLACE FUNCTION public.quote_stamp_won_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'won'
     AND NEW.won_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'won')
  THEN
    NEW.won_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quote_stamp_won_at ON public.quotes;
CREATE TRIGGER trg_quote_stamp_won_at
  BEFORE INSERT OR UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quote_stamp_won_at();

-- One-time backfill for existing won rows -> updated_at (last-touch proxy, no
-- historical total moves). Gated on won_at IS NULL so a re-run is a no-op.
UPDATE public.quotes q
SET won_at = COALESCE(q.updated_at, q.created_at)
WHERE q.status = 'won' AND q.won_at IS NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 · leads.won_at  (mirror of quotes; owner-approved 2026-08-21)
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS won_at timestamptz;

-- Stamp won_at the FIRST time a lead reaches stage 'Won' (and only then).
CREATE OR REPLACE FUNCTION public.lead_stamp_won_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage = 'Won'
     AND NEW.won_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'Won')
  THEN
    NEW.won_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_stamp_won_at ON public.leads;
CREATE TRIGGER trg_lead_stamp_won_at
  BEFORE INSERT OR UPDATE OF stage ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_stamp_won_at();

-- One-time backfill for existing Won leads -> updated_at. Gated on won_at IS NULL.
UPDATE public.leads l
SET won_at = COALESCE(l.updated_at, l.created_at)
WHERE l.stage = 'Won' AND l.won_at IS NULL;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY — MANDATORY. Run this SELECT; q_missing AND l_missing MUST be 0. ──────
-- If either is > 0 the backfill was cut mid-paste (clipboard truncation, §47/§126.1)
-- -> the Won tab would silently drop those rows. Re-run the whole file.
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='quotes' AND column_name='won_at') = 1 AS q_col,
--   (SELECT count(*) FROM pg_trigger WHERE tgname='trg_quote_stamp_won_at')               AS q_trg,
--   (SELECT count(*) FROM public.quotes WHERE status='won' AND won_at IS NULL)             AS q_missing,
--   (SELECT count(*) FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='leads' AND column_name='won_at') = 1  AS l_col,
--   (SELECT count(*) FROM pg_trigger WHERE tgname='trg_lead_stamp_won_at')                 AS l_trg,
--   (SELECT count(*) FROM public.leads WHERE stage='Won' AND won_at IS NULL)               AS l_missing;
