-- supabase_phase322_meeting_thanks_template.sql
-- Phase 322 — the AFTER-PRESENTATION thank-you.
--
-- The team's real field flow is: log the meeting → present → END presentation →
-- outcome. When the rep taps "End Presentation" (PresentView.jsx), they get a
-- one-tap "Send a thank-you?" prompt → the customer receives a WhatsApp thank-you
-- for meeting + the GSRTC LED brochure, from the company number.
--
-- This is a NEW pseudo-outcome 'meeting_done' (distinct from 'meeting', which is
-- the SCHEDULE-a-future-meeting appointment confirmation, §249.3). send-template.js
-- resolves it via PICK mode: the client POSTs {lead_id, template_key:'meeting_done'}
-- and the server maps it to this row. 2 body vars (name + rep) + the brochure PDF.
--
-- ⚠ RUN ORDER (§126.1 serving-version rule): FIRST create the Meta template
-- `post_meeting_thanks` (gu, with a DOCUMENT header) via
-- scripts/create-meeting-thanks-template.py and WAIT for it to show "Active" in
-- WhatsApp Manager. THEN run this file. If the row is set before the template is
-- Active, every "Send thank-you" tap FAILS (no_template_for_outcome / send_failed).
--
-- Idempotent: re-running re-sets the same row + CHECK.

-- 1. Allow the new pseudo-outcome (superset — safe whether or not phase249_3 ran).
ALTER TABLE public.wa_outcome_templates
  DROP CONSTRAINT IF EXISTS wa_outcome_templates_outcome_check;

ALTER TABLE public.wa_outcome_templates
  ADD CONSTRAINT wa_outcome_templates_outcome_check
  CHECK (outcome IN ('positive','neutral','callback','nurture','negative','meeting','meeting_done'));

-- 2. Map 'meeting_done' → the gu thank-you template + the brochure (same file the
--    other PDF templates use — the created template's SAMPLE must match §126.1).
INSERT INTO public.wa_outcome_templates
  (outcome, meta_template_name, language, header_doc_url, header_doc_name, preview_body)
VALUES
  ('meeting_done', 'post_meeting_thanks', 'gu',
   'https://kompjctmisnitjpbjalh.supabase.co/storage/v1/object/public/company-assets/PRIVATE/brochure-1782189762086.pdf',
   'Untitled Advertising - GSRTC LED Network.pdf',
   E'નમસ્તે {{1}}, આજે રૂબરૂ મળવા બદલ આભાર.\n\nવાત મુજબ, *GSRTC બસ-સ્ટેશન LED સ્ક્રીન નેટવર્ક*ની વિગતો સાથે મોકલી છે.\n\nકોઈ પણ પ્રશ્ન હોય તો *અહીં જ જવાબ આપો* — {{2}} (Untitled Advertising) મદદ કરશે.')
ON CONFLICT (outcome) DO UPDATE
  SET meta_template_name = EXCLUDED.meta_template_name,
      language           = EXCLUDED.language,
      header_doc_url     = EXCLUDED.header_doc_url,
      header_doc_name    = EXCLUDED.header_doc_name,
      preview_body       = EXCLUDED.preview_body,
      is_active          = true;

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect a meeting_done row, gu, has_pdf=true, has_preview=true:
--   SELECT outcome, meta_template_name, language,
--          (header_doc_url IS NOT NULL) AS has_pdf,
--          (preview_body   IS NOT NULL) AS has_preview
--     FROM public.wa_outcome_templates WHERE outcome = 'meeting_done';
