-- supabase_phase47_1_whatsapp_templates.sql
-- Phase 47.1 — WhatsApp templates master + send tracking.
-- 18 May 2026
--
-- Owner directive: TC needs 1-click WhatsApp follow-up after every
-- no-answer call. Today they copy/paste manually = 90 sec × 30 calls
-- /day wasted. With templates: tap → wa.me link opens → send.
--
-- Schema:
--   whatsapp_templates — master table (admin CRUD via MasterV2)
--     id, name, body, is_active, display_order, created_at
--     body supports placeholders: {name} {company} {phone} {city}
--                                 {rep_name} {company_name}
--
-- RLS:
--   • Admin / co_owner — full CRUD
--   • All authenticated — SELECT (so rep apps see the dropdown)
--
-- Send tracking already lives in lead_activities (activity_type=
-- 'whatsapp' was added in Phase 12). This file does NOT add new
-- columns there — the existing notes column captures the rendered
-- body for audit.
--
-- Idempotent.


-- ─── 1. Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  body          text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_templates_active_order
  ON public.whatsapp_templates (is_active, display_order)
  WHERE is_active = true;


-- ─── 2. RLS ──────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_tmpl_read_all"     ON public.whatsapp_templates;
DROP POLICY IF EXISTS "wa_tmpl_admin_write"  ON public.whatsapp_templates;

CREATE POLICY "wa_tmpl_read_all" ON public.whatsapp_templates
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "wa_tmpl_admin_write" ON public.whatsapp_templates
  FOR ALL TO authenticated
  USING      (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));


-- ─── 3. Seed defaults ────────────────────────────────────────────
-- 5 starter templates. Admin edits / adds / disables via Master tab.
-- Placeholders are exact strings: {name} {company} {phone} {city}
-- {rep_name} {company_name}. Frontend renderer does string-replace.

INSERT INTO public.whatsapp_templates (name, body, display_order)
SELECT * FROM (VALUES
  (
    'No-answer follow-up',
    'Hi {name}, I tried calling you regarding outdoor advertising for {company}. Please share a good time to discuss. — {rep_name}, {company_name}',
    10
  ),
  (
    'Send brochure',
    'Hi {name}, here is our OOH portfolio: [link]. Let me know if any of these locations interest you. — {rep_name}, {company_name}',
    20
  ),
  (
    'Meeting confirmation',
    'Hi {name}, confirming our meeting tomorrow regarding {company} branding. See you then! — {rep_name}',
    30
  ),
  (
    'Quote sent — chase',
    'Hi {name}, did you get a chance to review the quote I sent for {company}? Happy to walk you through it. — {rep_name}, {company_name}',
    40
  ),
  (
    'Thank you',
    'Hi {name}, thank you for taking the call! I will share the proposal shortly. — {rep_name}, {company_name}',
    50
  )
) AS v(name, body, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_templates WHERE name = v.name
);


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='whatsapp_templates')   AS table_present,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='whatsapp_templates')      AS rls_count,
  (SELECT count(*) FROM public.whatsapp_templates)                     AS seed_count;

-- Expected:
--   table_present = 1
--   rls_count     = 2
--   seed_count    = 5
