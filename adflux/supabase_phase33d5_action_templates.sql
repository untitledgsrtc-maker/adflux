-- =====================================================================
-- Phase 33D.5 — post-action WhatsApp templates (11 May 2026)
--
-- Owner directive: after every action (meeting saved, call logged,
-- stage changed), pop a modal offering to send the appropriate
-- thank-you / engagement WhatsApp template.
--
-- Two new template "stages" added beyond the existing 6 lead stages:
--   post_meeting  — fires after a meeting activity is saved
--   post_call     — fires after a call activity is logged
-- Existing stage templates (New / Working / QuoteSent / Nurture /
-- Won / Lost) continue to power the post-stage-change prompt.
--
-- Idempotent.
-- =====================================================================

-- Relax the CHECK so the 2 new pseudo-stages are valid.
ALTER TABLE message_templates
  DROP CONSTRAINT IF EXISTS message_templates_stage_check;
ALTER TABLE message_templates
  ADD CONSTRAINT message_templates_stage_check
  CHECK (stage IN (
    'New','Working','QuoteSent','Nurture','Won','Lost',
    'post_meeting','post_call'
  ));

-- Seed the 2 new templates. Admin can edit via Master → Message
-- Templates later. {media} resolves at send time to "LED screens" for
-- Private leads or "outdoor hoardings" for Govt — see the client
-- helper. {name}/{company}/{rep} same as existing templates.

INSERT INTO message_templates (name, stage, body, display_order, is_active)
VALUES
  ('Thanks · post-meeting', 'post_meeting',
'Hello {name},

Thank you for your time today. It was great discussing {media} for {company}. I will share the details and quotation shortly. Please reach out if you have any questions in the meantime.

Best regards,
{rep}
Untitled Adflux', 10, true),

  ('Thanks · post-call', 'post_call',
'Hello {name},

Thank you for your time on the call. As discussed, I will follow up with the details shortly. Looking forward to working with {company}.

Best regards,
{rep}
Untitled Adflux', 10, true)

ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- VERIFY
SELECT stage, count(*) FROM message_templates
  WHERE is_active AND stage IN ('post_meeting','post_call')
  GROUP BY stage;
