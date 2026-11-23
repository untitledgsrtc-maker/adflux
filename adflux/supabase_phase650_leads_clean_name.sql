-- =============================================================================
-- Phase 650 · Junk lead names fixed on the way in (2026-11-23, owner-approved)
--
-- Same rule as Phase 649 for every NEW lead and every name edit, from any source
-- (WhatsApp / QR / Meta webhooks, Excel upload, app forms): a name with no real
-- word ('.', '~', 'N', emoji) becomes the company name if that is a real word,
-- else 'Unnamed · <last 5 phone digits>'. The app forms also refuse such names
-- (src/utils/leadName.js, same regex). Pure in-row regex, no table reads: no
-- slowdown on lead save. Safe to re-run.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.leads_clean_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.name IS NULL OR NEW.name !~ '[A-Za-z0-9઀-૿ऀ-ॿ]{2,}' THEN
    NEW.name := CASE
      WHEN NEW.company ~ '[A-Za-z0-9઀-૿ऀ-ॿ]{2,}' THEN btrim(NEW.company)
      WHEN length(regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g')) >= 5
        THEN 'Unnamed · ' || right(regexp_replace(NEW.phone, '\D', '', 'g'), 5)
      ELSE 'Unnamed lead'
    END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.leads_clean_name() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_leads_clean_name ON public.leads;
CREATE TRIGGER trg_leads_clean_name
  BEFORE INSERT OR UPDATE OF name ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_clean_name();

-- VERIFY:
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trg_leads_clean_name';   -- 1 row
