-- supabase_phase249_4_message_text_and_optout.sql
--
-- Two fixes found by the owner in a live pilot send (20 Jul):
--
-- 1. The inbox showed "[template] post_call_callback" instead of the message
--    that actually went to the customer. A rep picking the thread up had no
--    idea what had been said. `preview_body` stores the same text as the Meta
--    template so the send endpoint can substitute the variables and log the
--    REAL message.
--
--    It has to be duplicated here because the approved body lives at Meta and
--    is not readable at send time. KEEP IT IN STEP with the Meta template: if
--    you edit one, edit the other, or the inbox will show text the customer
--    never received. (Only the log is affected — never what is sent.)
--
-- 2. A customer replied "Don't call me again" and nothing happened, because the
--    STOP matcher only accepted exact keywords. See the webhook change in the
--    same phase for the widened matching.

ALTER TABLE public.wa_outcome_templates
  ADD COLUMN IF NOT EXISTS preview_body text;

COMMENT ON COLUMN public.wa_outcome_templates.preview_body IS
  'Copy of the approved Meta template body, {{1}}/{{2}}/… placeholders intact. '
  'Used ONLY to log the real message text into whatsapp_messages so reps can '
  'read what was sent. Must be kept in step with the Meta template.';

UPDATE public.wa_outcome_templates SET preview_body =
  'Hi {{1}}, thank you for speaking with us just now.

As requested on our call, here are the details of the GSRTC bus-station LED screen network.

If you have any questions, reply to this message and {{2}} from Untitled Advertising will assist you.'
 WHERE outcome = 'positive';

UPDATE public.wa_outcome_templates SET preview_body =
  'Hi {{1}}, thank you for your time.

As agreed, {{2}} from Untitled Advertising will call you back on {{3}} at {{4}}.

If that time no longer suits you, reply to this message and we will rearrange.'
 WHERE outcome = 'callback';

UPDATE public.wa_outcome_templates SET preview_body =
  'Hi {{1}}, thank you for your time on the call.

Sharing the details of the GSRTC bus-station LED screen network for your reference.

I will check back in a few days. If you need anything sooner, reply to this message. - {{2}}, Untitled Advertising'
 WHERE outcome = 'neutral';

UPDATE public.wa_outcome_templates SET preview_body =
  'Hi {{1}}, thank you for your time today.

I will leave this with you and check back in about a month. If anything changes before then, reply to this message. - {{2}}, Untitled Advertising'
 WHERE outcome = 'nurture';

UPDATE public.wa_outcome_templates SET preview_body =
  'Hi {{1}}, thank you for your time today.

If you have any requirement for GSRTC bus-station LED advertising in future, you can reply to this message any time. - {{2}}, Untitled Advertising'
 WHERE outcome = 'negative';

UPDATE public.wa_outcome_templates SET preview_body =
  'Hi {{1}}, thank you for your time.

As agreed, {{2}} from Untitled Advertising will meet you on {{3}} at {{4}}.

If that time no longer suits you, reply to this message and we will rearrange.'
 WHERE outcome = 'meeting';

NOTIFY pgrst, 'reload schema';

-- VERIFY — every row should now carry a preview body:
--   SELECT outcome, meta_template_name, (preview_body IS NOT NULL) AS has_preview
--     FROM public.wa_outcome_templates ORDER BY outcome;
