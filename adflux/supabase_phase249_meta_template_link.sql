-- supabase_phase249_meta_template_link.sql
--
-- P2 of the post-call business-number messaging plan
-- (docs/PLAN_post_call_business_number_messaging.md).
--
-- Links an app-side message_templates row to the Meta-APPROVED template that
-- must be used when the same message is sent from the BUSINESS number rather
-- than deep-linked into the rep's own WhatsApp.
--
-- WHY a link rather than reusing `body`: a post-call message is
-- business-initiated, so Meta requires an approved template — the free-text
-- `body` cannot be sent from the business number. `body` stays as-is and keeps
-- driving the existing WhatsApp/SMS deep-link path, which is untouched.
--
-- INERT until P3 ships. Nothing reads meta_template_name yet, so this file is
-- safe to run at any time — it cannot change current behaviour (§45).
--
-- ONE column only. Deliberately NOT adding a language column (api/wa/broadcast.js
-- already defaults 'en') or a variable-map column (broadcast.js already resolves
-- {{n}} from Meta's own template definition).

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS meta_template_name text;

COMMENT ON COLUMN public.message_templates.meta_template_name IS
  'Name of the Meta-approved template to use when sending this stage from the '
  'business number (business-initiated => template required). NULL = this stage '
  'cannot business-initiate; the UI must say so rather than failing silently.';

-- Point the post-call row at the Utility template submitted in P2.
-- Safe to run before Meta approves it: nothing sends from this column until P3,
-- and P3 must verify the template is APPROVED at send time regardless.
UPDATE public.message_templates
   SET meta_template_name = 'post_call_followup'
 WHERE stage = 'post_call'
   AND is_active
   AND meta_template_name IS DISTINCT FROM 'post_call_followup';

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect the post_call row to carry the template name, everything
-- else NULL:
--   SELECT stage, name, meta_template_name
--     FROM public.message_templates
--    WHERE is_active
--    ORDER BY stage;
