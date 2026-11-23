-- =============================================================================
-- Phase 649 · Rename leads with junk names (2026-11-23, owner-approved)
--
-- 511 leads had a name with no real word in it ('.', '~', 'N', emoji ...), mostly
-- WhatsApp / Meta / QR leads where the name is the person's WhatsApp profile name.
-- Owner rule: use the company name where it is a real word, else
-- 'Unnamed · <last 5 digits of the phone>'. Nothing is deleted.
-- Old names are kept in _bak_lead_names_p649 (RLS on, no policies = no app access).
-- Undo: UPDATE leads l SET name = b.old_name FROM _bak_lead_names_p649 b WHERE b.id = l.id;
-- Only trigger that fires on a plain UPDATE (lead_set_handoff_sla) acts on stage
-- changes only, so nothing else moves. Safe to re-run (already-clean names skip).
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public._bak_lead_names_p649 (
  id uuid PRIMARY KEY, old_name text, new_name text, saved_at timestamptz DEFAULT now());
ALTER TABLE public._bak_lead_names_p649 ENABLE ROW LEVEL SECURITY;

WITH j AS (
  SELECT id, name,
    CASE
      WHEN company ~ '[A-Za-z0-9઀-૿ऀ-ॿ]{2,}' THEN btrim(company)
      WHEN length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 5
        THEN 'Unnamed · ' || right(regexp_replace(phone, '\D', '', 'g'), 5)
      ELSE 'Unnamed lead'
    END AS new_name
  FROM public.leads
  WHERE name IS NULL OR btrim(name) = '' OR name !~ '[A-Za-z0-9઀-૿ऀ-ॿ]{2,}'
), saved AS (
  INSERT INTO public._bak_lead_names_p649 (id, old_name, new_name)
  SELECT id, name, new_name FROM j
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
UPDATE public.leads l SET name = j.new_name FROM j WHERE l.id = j.id;

COMMIT;

-- VERIFY:
-- SELECT count(*) FROM leads WHERE name IS NULL OR btrim(name)='' OR name !~ '[A-Za-z0-9઀-૿ऀ-ॿ]{2,}';  -- 0
-- SELECT count(*) FROM _bak_lead_names_p649;                                                                         -- 511
