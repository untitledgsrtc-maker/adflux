-- supabase_phase319_gu_templates.sql
-- Phase 319 — switch the post-call templates to GUJARATI.
--
-- ⚠ RUN THIS ONLY AFTER all 5 gu templates show "Active" in WhatsApp Manager
-- (Message templates). Until then leave the app on English — the en versions are
-- still approved and keep sending; flipping language to 'gu' before Meta approves
-- the gu versions makes every post-call send FAIL (§126.1 serving-version rule).
--
-- What it does (no app deploy needed — send-template.js reads tpl.language):
--   • language 'en' -> 'gu' on all 5 outcome rows.
--   • preview_body -> the Gujarati text (the inbox log shows the real message).
--   • callback: drops the brochure (header_doc_url NULL) — the gu callback template
--     was created WITHOUT a doc header (appointment confirmation, per the approved
--     wording). Its header must be null or the send would try to attach a doc the
--     template has no slot for. good / maybe / nurture keep the brochure.
--
-- Idempotent: re-running just re-sets the same values.

UPDATE public.wa_outcome_templates SET
  language = 'gu',
  preview_body = E'નમસ્તે {{1}}, હમણાં તમારી સાથે વાત કરીને આનંદ થયો.\n\nવાત મુજબ, *GSRTC બસ-સ્ટેશન LED સ્ક્રીન નેટવર્ક*ની વિગતો સાથે મોકલી છે.\n\nજોઈને તમારો અભિપ્રાય જરૂર જણાવજો — *કોઈ પણ પ્રશ્ન હોય તો અહીં જ જવાબ આપો*, {{2}} (Untitled Advertising) મદદ કરશે.'
WHERE outcome = 'positive';

UPDATE public.wa_outcome_templates SET
  language = 'gu',
  header_doc_url = NULL,
  header_doc_name = NULL,
  preview_body = E'નમસ્તે {{1}}, કદાચ તમે અત્યારે વ્યસ્ત હશો. મેં *GSRTC બસ-સ્ટેશન LED સ્ક્રીન* વિશે વિગતવાર વાત કરવા ફોન કર્યો હતો.\n\n{{2}} (Untitled Advertising) તમને *{{3}}* ના રોજ *{{4}}* વાગ્યે ફરી ફોન કરશે.\n\nજો બીજો સમય અનુકૂળ હોય, તો અહીં જ જવાબ આપો — ગોઠવી લઈશું.'
WHERE outcome = 'callback';

UPDATE public.wa_outcome_templates SET
  language = 'gu',
  preview_body = E'નમસ્તે {{1}}, ફોન પર સમય આપવા બદલ આભાર.\n\nતમારા સંદર્ભ માટે *GSRTC બસ-સ્ટેશન LED સ્ક્રીન નેટવર્ક*ની વિગતો મોકલી છે.\n\nનિરાંતે જોજો — *તમને યોગ્ય લાગે તો અહીં જ જવાબ આપજો*, {{2}} (Untitled Advertising).'
WHERE outcome = 'neutral';

UPDATE public.wa_outcome_templates SET
  language = 'gu',
  preview_body = E'નમસ્તે {{1}}, આજે સમય આપવા બદલ આભાર.\n\nતમારા સંદર્ભ માટે અમારી *GSRTC LED નેટવર્ક*ની વિગતો મોકલી છે. કોઈ ઉતાવળ નથી — હું *લગભગ એક મહિના પછી* ફરી સંપર્ક કરીશ.\n\nત્યાં સુધીમાં કંઈ પણ ફેરફાર થાય તો અહીં જ જવાબ આપજો. — {{2}}, Untitled Advertising'
WHERE outcome = 'nurture';

UPDATE public.wa_outcome_templates SET
  language = 'gu',
  preview_body = E'નમસ્તે {{1}}, આજે સમય આપવા બદલ આભાર.\n\nભવિષ્યમાં ક્યારેય *GSRTC બસ-સ્ટેશન LED જાહેરાત* વિશે જરૂર જણાય, તો અહીં જ જવાબ આપી શકો છો.\n\nતમને શુભકામનાઓ. — {{2}}, Untitled Advertising'
WHERE outcome = 'negative';

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect 5 rows, all language=gu; callback has_pdf=false, other 3 true):
-- SELECT outcome, meta_template_name, language,
--        (header_doc_url IS NOT NULL) AS has_pdf, left(preview_body, 24) AS body
--   FROM public.wa_outcome_templates ORDER BY outcome;
