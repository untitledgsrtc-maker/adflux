-- =====================================================================
-- Phase 33B — message_templates master table + 6 stage seeds.
-- 11 May 2026
--
-- Owner directive (11 May): English WhatsApp templates, all stages
-- (intro / follow-up / quote-chase / nurture / won / lost). Admin
-- editable via Master → Message Templates. Reps tap "Send follow-up"
-- on lead detail; the right template is auto-selected by stage and
-- placeholders are filled at send time ({name}, {company}, {rep},
-- {city}).
-- =====================================================================

CREATE TABLE IF NOT EXISTS message_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,            -- 'Intro / new', 'Follow-up' etc.
  stage      text NOT NULL,            -- maps to leads.stage value
  body       text NOT NULL,            -- WhatsApp message body with {placeholders}
  is_active  boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT message_templates_stage_check
    CHECK (stage IN ('New','Working','QuoteSent','Nurture','Won','Lost'))
);

CREATE INDEX IF NOT EXISTS idx_message_templates_stage_active
  ON message_templates (stage, is_active) WHERE is_active = true;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_message_templates_touch ON message_templates;
CREATE TRIGGER trg_message_templates_touch
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS — admin/co_owner write, everyone authenticated read.
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_templates_read  ON message_templates;
DROP POLICY IF EXISTS message_templates_admin ON message_templates;

CREATE POLICY message_templates_read ON message_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY message_templates_admin ON message_templates
  FOR ALL USING (public.get_my_role() IN ('admin','co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

-- ─── Seed 6 stage templates (English) ────────────────────────────────
-- Placeholders resolve at send time in the client:
--   {name}     = lead.name (or 'Sir/Madam' fallback)
--   {company}  = lead.company (or lead.name fallback)
--   {rep}      = rep's name
--   {city}     = lead.city (or 'your city' fallback)

INSERT INTO message_templates (name, stage, body, display_order)
VALUES
  ('Intro · first contact', 'New',
'Hello {name},

I am {rep} from Untitled Adflux. We saw your interest in outdoor advertising. Do you have a few minutes to discuss our LED hoardings in {city}?

Best regards,
{rep}', 10),

  ('Follow-up after meeting', 'Working',
'Hello {name},

Following up on our recent conversation about outdoor advertising for {company}. I will send the proposal shortly. Please let me know if you have any questions in the meantime.

Best regards,
{rep}
Untitled Adflux', 10),

  ('Quote chase', 'QuoteSent',
'Hello {name},

Just checking in on the proposal I sent for {company}. Happy to walk you through the rates or adjust the locations if needed.

Best regards,
{rep}
Untitled Adflux', 10),

  ('Nurture revisit', 'Nurture',
'Hello {name},

Hope all is well. We spoke earlier about outdoor advertising for {company}. Would now be a better time to revisit? Our network has grown since.

Best regards,
{rep}
Untitled Adflux', 10),

  ('Thank you · post-won', 'Won',
'Hello {name},

Thank you for choosing Untitled Adflux. Your campaign is being set up — I will share mounting photos as soon as we go live.

Best regards,
{rep}
Untitled Adflux', 10),

  ('Door open · post-lost', 'Lost',
'Hello {name},

Thank you for taking the time to consider our proposal. If your plans change or you would like to explore other media options, we are always here.

Best regards,
{rep}
Untitled Adflux', 10)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- VERIFY
SELECT stage, count(*) FROM message_templates WHERE is_active GROUP BY stage ORDER BY stage;
