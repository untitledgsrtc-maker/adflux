-- supabase_phase249_3_meeting_template.sql
--
-- Adds the MEETING confirmation to the post-call send.
--
-- Why it isn't a real "outcome": scheduling a meeting is a NEXT ACTION, not a
-- call outcome — a rep can book one off Good, Maybe or Call-later. So 'meeting'
-- is a PSEUDO-outcome in the mapping table: the send endpoint resolves it FIRST
-- (a meeting was just scheduled) and only falls back to the actual outcome if
-- no meeting was booked. A confirmed appointment always beats a generic
-- follow-up.
--
-- Strongest Utility case of the set: it confirms a specific date + time the
-- customer just agreed to. No offer, no price, no attachment.

ALTER TABLE public.wa_outcome_templates
  DROP CONSTRAINT IF EXISTS wa_outcome_templates_outcome_check;

ALTER TABLE public.wa_outcome_templates
  ADD CONSTRAINT wa_outcome_templates_outcome_check
  CHECK (outcome IN ('positive','neutral','callback','nurture','negative','meeting'));

INSERT INTO public.wa_outcome_templates
  (outcome, meta_template_name, language, header_doc_url, header_doc_name)
VALUES
  -- No attachment on purpose: same reasoning as post_call_callback. A brochure
  -- on an appointment confirmation drags it toward Marketing.
  ('meeting', 'post_call_meeting', 'en', NULL, NULL)
ON CONFLICT (outcome) DO UPDATE
  SET meta_template_name = EXCLUDED.meta_template_name,
      language           = EXCLUDED.language,
      header_doc_url     = EXCLUDED.header_doc_url,
      header_doc_name    = EXCLUDED.header_doc_name;

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect 6 rows now, PDF still only on positive + neutral:
--   SELECT outcome, meta_template_name, (header_doc_url IS NOT NULL) AS has_pdf
--     FROM public.wa_outcome_templates ORDER BY outcome;
