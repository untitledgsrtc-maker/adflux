-- supabase_phase47_8_call_language.sql
-- Phase 47.8 — language tag on call_logs.
-- 18 May 2026
--
-- Owner directive: tag each call as Gujarati / Hindi / English.
-- Analytics insight into which language drives conversion in B2B
-- OOH market.
--
-- Schema:
--   call_logs.language text CHECK (language IN ('gu','hi','en'))
--   NULL allowed (legacy rows + rep skipped the picker).
--
-- Idempotent.

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS language text
    CHECK (language IS NULL OR language IN ('gu','hi','en'));

CREATE INDEX IF NOT EXISTS idx_call_logs_language
  ON public.call_logs (language)
  WHERE language IS NOT NULL;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='call_logs'
      AND column_name='language')                              AS col_present;

-- Expected: col_present = 1
