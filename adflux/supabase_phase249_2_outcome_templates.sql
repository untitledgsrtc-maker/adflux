-- supabase_phase249_2_outcome_templates.sql
--
-- P3 of docs/PLAN_post_call_business_number_messaging.md — maps each call
-- OUTCOME to the Meta-approved template used when sending from the BUSINESS
-- number.
--
-- WHY A SEPARATE TABLE and not more rows in message_templates:
-- WhatsAppPromptModal queries `message_templates` with
--   .eq('stage', stage).order('display_order').limit(1)
-- so ADDING rows with stage='post_call' could change WHICH body the existing
-- deep-link prompt picks. That path is live on 4 pages. A separate table cannot
-- disturb it (§45).
--
-- The `message_templates.meta_template_name` column added in
-- supabase_phase249_meta_template_link.sql is superseded by this and is left
-- unused (harmless; nothing reads it).

CREATE TABLE IF NOT EXISTS public.wa_outcome_templates (
  outcome            text PRIMARY KEY,
  meta_template_name text NOT NULL,
  language           text NOT NULL DEFAULT 'en',
  -- NULL = no document header. When set, the send endpoint attaches this file
  -- as the template's DOCUMENT header. Per-send so it can later be the lead's
  -- own quote PDF instead of the generic brochure.
  header_doc_url     text,
  header_doc_name    text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_outcome_templates_outcome_check
    CHECK (outcome IN ('positive','neutral','callback','nurture','negative'))
);

COMMENT ON TABLE public.wa_outcome_templates IS
  'Call outcome -> approved Meta template, for post-call sends from the business '
  'number. Outcomes match PostCallOutcomeModal OUTCOMES.';

-- Seed / refresh the five (idempotent).
INSERT INTO public.wa_outcome_templates
  (outcome, meta_template_name, language, header_doc_url, header_doc_name)
VALUES
  ('positive', 'post_call_good',     'en',
   'https://kompjctmisnitjpbjalh.supabase.co/storage/v1/object/public/company-assets/PRIVATE/brochure-1782189762086.pdf',
   'Untitled Advertising - GSRTC LED Network.pdf'),
  ('neutral',  'post_call_maybe',    'en',
   'https://kompjctmisnitjpbjalh.supabase.co/storage/v1/object/public/company-assets/PRIVATE/brochure-1782189762086.pdf',
   'Untitled Advertising - GSRTC LED Network.pdf'),
  -- Callback is an appointment confirmation: NO attachment on purpose. It is the
  -- cleanest Utility case and a brochure would drag it toward Marketing.
  ('callback', 'post_call_callback', 'en', NULL, NULL),
  ('nurture',  'post_call_nurture',  'en', NULL, NULL),
  -- Lost: ONE polite sign-off. No price, no link, no attachment, no re-pitch.
  ('negative', 'post_call_lost',     'en', NULL, NULL)
ON CONFLICT (outcome) DO UPDATE
  SET meta_template_name = EXCLUDED.meta_template_name,
      language           = EXCLUDED.language,
      header_doc_url     = EXCLUDED.header_doc_url,
      header_doc_name    = EXCLUDED.header_doc_name;

ALTER TABLE public.wa_outcome_templates ENABLE ROW LEVEL SECURITY;

-- Any signed-in user may READ the mapping (the send endpoint uses the service
-- role, but the UI may want to show which template will go out).
DROP POLICY IF EXISTS wa_outcome_templates_read ON public.wa_outcome_templates;
CREATE POLICY wa_outcome_templates_read ON public.wa_outcome_templates
  FOR SELECT TO authenticated USING (true);

-- Only admin / co_owner may change the mapping.
DROP POLICY IF EXISTS wa_outcome_templates_admin ON public.wa_outcome_templates;
CREATE POLICY wa_outcome_templates_admin ON public.wa_outcome_templates
  FOR ALL TO authenticated
  USING (COALESCE(public.get_my_role() IN ('admin','co_owner'), false))
  WITH CHECK (COALESCE(public.get_my_role() IN ('admin','co_owner'), false));

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect 5 rows, PDF on positive + neutral only:
--   SELECT outcome, meta_template_name, (header_doc_url IS NOT NULL) AS has_pdf
--     FROM public.wa_outcome_templates ORDER BY outcome;
