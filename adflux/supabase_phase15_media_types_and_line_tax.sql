-- =====================================================================
-- Phase 15 — Private Media Types master + per-line tax detail
-- =====================================================================
-- Owner spec (Phase 12 rev3 audit):
--   "for private media we can use this raw data no particular media name
--    in master we can add media for private"
--
-- 1. NEW: media_types — admin-managed list of private media labels
--    that auto-suggest in the Other Media quote wizard. Reps can also
--    type free-text (autocomplete is a hint, not a constraint).
--
-- 2. quote_cities gains cgst_pct, sgst_pct, hsn_sac columns so the
--    Other Media PDF (matching ENIL Quotation #44 format) can render
--    per-line tax breakup. Existing govt + private LED quotes are
--    unaffected — these columns default NULL and the existing PDF
--    generators ignore them.
--
-- IDEMPOTENT.
-- =====================================================================

-- 1) media_types master
CREATE TABLE IF NOT EXISTS public.media_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  default_hsn_sac text,
  default_cgst_pct numeric DEFAULT 9,
  default_sgst_pct numeric DEFAULT 9,
  notes         text,
  is_active     boolean DEFAULT true,
  display_order int DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_types_active ON public.media_types (is_active, display_order);

ALTER TABLE public.media_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media_types_admin_all" ON public.media_types;
CREATE POLICY "media_types_admin_all" ON public.media_types FOR ALL
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "media_types_read_all" ON public.media_types;
CREATE POLICY "media_types_read_all" ON public.media_types FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Seed common types (matches ENIL Quotation #44 + a few obvious ones).
INSERT INTO public.media_types (name, default_hsn_sac, display_order) VALUES
  ('Newspaper',           '998397', 10),
  ('Hoarding (Outdoor)',  '998397', 20),
  ('Bicycle Branding',    '998397', 30),
  ('Cinema',              '998397', 40),
  ('Mall Activation',     '998397', 50),
  ('Digital Banner',      '998397', 60),
  ('Radio',               '998397', 70),
  ('Other',               '998397', 99)
ON CONFLICT (name) DO NOTHING;

-- 2) Per-line tax detail on quote_cities
ALTER TABLE public.quote_cities
  ADD COLUMN IF NOT EXISTS hsn_sac     text,
  ADD COLUMN IF NOT EXISTS cgst_pct    numeric,
  ADD COLUMN IF NOT EXISTS sgst_pct    numeric,
  ADD COLUMN IF NOT EXISTS cgst_amount numeric,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY:
--   SELECT count(*) FROM public.media_types;  -- expect: 8
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'quote_cities'
--      AND column_name IN ('hsn_sac','cgst_pct','sgst_pct','cgst_amount','sgst_amount');
--   -- expect 5 rows
-- =====================================================================
