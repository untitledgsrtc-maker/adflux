-- supabase_phase47_2_call_scripts.sql
-- Phase 47.2 — call scripts master for TC + sales reps.
-- 18 May 2026
--
-- Owner directive: fresh TC doesn't know the pitch. Show category-
-- specific script on the Next Call hero while ringing so rep can
-- read along.
--
-- Schema:
--   call_scripts — master table (admin CRUD via Master → Scripts)
--     id, name, body, segment ('PRIVATE'/'GOVERNMENT'/NULL=any),
--     is_active, display_order, created_at
--
-- Matching logic (frontend):
--   1. First active script with segment matching lead.segment.
--   2. Fallback to first active script with segment=NULL.
--   3. None → no script panel rendered.
--
-- Placeholders same as whatsapp_templates: {name} {company}
-- {phone} {city} {rep_name} {company_name}.
--
-- RLS:
--   • Admin / co_owner — full CRUD
--   • All authenticated — SELECT
--
-- Idempotent.


-- ─── 1. Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_scripts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  body          text NOT NULL,
  segment       text CHECK (segment IS NULL OR segment IN ('PRIVATE', 'GOVERNMENT')),
  is_active     boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_scripts_active_segment
  ON public.call_scripts (is_active, segment, display_order)
  WHERE is_active = true;


-- ─── 2. RLS ──────────────────────────────────────────────────────
ALTER TABLE public.call_scripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scripts_read_all"    ON public.call_scripts;
DROP POLICY IF EXISTS "scripts_admin_write" ON public.call_scripts;

CREATE POLICY "scripts_read_all" ON public.call_scripts
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "scripts_admin_write" ON public.call_scripts
  FOR ALL TO authenticated
  USING      (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));


-- ─── 3. Seed defaults ────────────────────────────────────────────
-- 3 starter scripts: 1 Private, 1 Government, 1 generic fallback.
-- Admin tweaks via Master tab after deploy.

INSERT INTO public.call_scripts (name, body, segment, display_order)
SELECT * FROM (VALUES
  (
    'Private — intro pitch',
    E'Hi {name}, this is {rep_name} from {company_name}.\n\nWe help businesses like {company} get visibility through outdoor advertising — hoardings, auto rickshaw hoods, mall displays — across Gujarat.\n\nDo you have 2 minutes for me to share what we offer in {city}?\n\n[Pause for response]\n\nMay I send our portfolio on WhatsApp? Also happy to schedule a 15-min meeting at your office.',
    'PRIVATE',
    10
  ),
  (
    'Government — intro pitch',
    E'Hi {name}, this is {rep_name} from {company_name}, an empanelled vendor with the Gujarat government for outdoor advertising.\n\nWe handle GSRTC LED screens and auto rickshaw hood branding across Gujarat for various departments.\n\nMay I know which department you handle? I can share the relevant rate card and our DAVP empanelment certificate on WhatsApp.\n\n[Pause for response]\n\nWould Thursday or Friday work for a quick meeting?',
    'GOVERNMENT',
    20
  ),
  (
    'Generic fallback',
    E'Hi {name}, this is {rep_name} from {company_name}.\n\nWe specialize in outdoor advertising across Gujarat. May I have 2 minutes to understand if our services fit {company}?\n\n[Pause for response]\n\nI can send our portfolio on WhatsApp and schedule a meeting at your convenience.',
    NULL,
    30
  )
) AS v(name, body, segment, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.call_scripts WHERE name = v.name
);


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='call_scripts')        AS table_present,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='call_scripts')           AS rls_count,
  (SELECT count(*) FROM public.call_scripts)                          AS seed_count;

-- Expected:
--   table_present = 1
--   rls_count     = 2
--   seed_count    = 3
