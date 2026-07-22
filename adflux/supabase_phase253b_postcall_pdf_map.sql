-- supabase_phase253b_postcall_pdf_map.sql
--
-- ███ DO NOT RUN until BOTH edited templates show ACTIVE in WhatsApp Manager ███
--
-- Phase 253 — brochure PDF on Call-later + Nurture (owner decision 22 Jul).
-- Prerequisite: scripts/add-doc-header-post-call.sh edited post_call_callback
-- + post_call_nurture at Meta to carry a DOCUMENT header, and Meta has
-- RE-APPROVED both (WhatsApp Manager → Message templates → status Active).
--
-- Running this EARLY breaks the feature: the send endpoint attaches a header
-- document parameter whenever header_doc_url is set, and Meta rejects a send
-- whose parameters don't match the approved template → every Call-later /
-- Nurture company send errors until the review clears.
--
-- The hazard cuts BOTH ways: once the edited templates go Active, a send
-- WITHOUT the header parameter is rejected too. So run this IMMEDIATELY when
-- both show Active — the Meta approval and this SQL must flip together.
--
-- post_call_lost stays PDF-free ON PURPOSE (§120): a lost lead gets ONE polite
-- sign-off, no re-pitch, no attachment. Do not add it here.

UPDATE public.wa_outcome_templates
   SET header_doc_url  = 'https://kompjctmisnitjpbjalh.supabase.co/storage/v1/object/public/company-assets/PRIVATE/brochure-1782189762086.pdf',
       header_doc_name = 'Untitled Advertising - GSRTC LED Network.pdf'
 WHERE outcome IN ('callback', 'nurture');

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect PDF true on callback / neutral / nurture / positive,
-- false on negative (Lost) + meeting (both PDF-free by design):
--   SELECT outcome, meta_template_name, (header_doc_url IS NOT NULL) AS has_pdf
--     FROM public.wa_outcome_templates ORDER BY outcome;
--
-- ROLLBACK (if sends start failing — templates not re-approved yet):
--   UPDATE public.wa_outcome_templates
--      SET header_doc_url = NULL, header_doc_name = NULL
--    WHERE outcome IN ('callback', 'nurture');
