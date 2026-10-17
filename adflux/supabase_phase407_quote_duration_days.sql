-- supabase_phase407_quote_duration_days.sql
-- Phase 407: quote duration in DAYS (e.g. 15 days). NULL = whole months exactly as before (duration_months).
-- When set, duration_months still holds the months rounded UP (min 1) so every older reader keeps working, and
-- campaign_total = rate x screens x days / 30 is stored by the wizard. Idempotent.
ALTER TABLE public.quote_cities ADD COLUMN IF NOT EXISTS duration_days integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_cities_duration_days_chk') THEN
    ALTER TABLE public.quote_cities ADD CONSTRAINT quote_cities_duration_days_chk CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 365);
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT count(*) FROM information_schema.columns WHERE table_name='quote_cities' AND column_name='duration_days';   -- 1
