-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 7
-- Per-row editable overrides + attachment checklist
-- =====================================================================
--
-- WHAT THIS DOES:
--   1. Adds per-line-item override columns to quote_cities for GSRTC
--      proposals — owner wants to edit Daily Spots / Spot Duration /
--      Days for each station in each proposal (not just constants).
--   2. Adds attachments_checklist (jsonb) to quotes — stores which
--      standard attachment items are checked + custom additions.
--      Standard checklists per segment+media seeded in
--      attachment_templates table.
--
-- DECISIONS:
--   - Overrides are NULLABLE — when null, fall back to defaults
--     (100/10/30). When set, override applies to that row.
--   - attachments_checklist stores a flexible jsonb instead of a
--     normalized table. Simple enough for v1; can normalize later.
--   - attachment_templates table seeded with standard 6-item
--     checklists for (GOVERNMENT, AUTO_HOOD) and (GOVERNMENT,
--     GSRTC_LED) per owner spec 1 May 2026.
--
-- IDEMPOTENT.
-- =====================================================================


-- 1) Per-row overrides on quote_cities ------------------------------
ALTER TABLE public.quote_cities
  ADD COLUMN IF NOT EXISTS daily_spots_override        integer,
  ADD COLUMN IF NOT EXISTS days_override               integer,
  ADD COLUMN IF NOT EXISTS spot_duration_sec_override  integer;


-- 2) Attachments checklist on quotes -------------------------------
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS attachments_checklist jsonb NOT NULL DEFAULT '[]'::jsonb;


-- 3) Attachment templates table — standard list per segment+media -
CREATE TABLE IF NOT EXISTS public.attachment_templates (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  segment         text NOT NULL CHECK (segment IN ('GOVERNMENT', 'PRIVATE')),
  media_type      text NOT NULL,
  display_order   integer NOT NULL,
  label           text NOT NULL,
  is_required     boolean NOT NULL DEFAULT true,
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (segment, media_type, display_order)
);

CREATE INDEX IF NOT EXISTS idx_attachment_templates_active
  ON public.attachment_templates (segment, media_type, is_active, display_order);


-- 4) Seed standard checklists ---------------------------------------
-- Owner spec 1 May 2026
INSERT INTO public.attachment_templates
  (segment, media_type, display_order, label, is_required)
VALUES
  -- AUTO HOOD
  ('GOVERNMENT', 'AUTO_HOOD',  1, 'Proposal letter (auto-generated)',          true),
  ('GOVERNMENT', 'AUTO_HOOD',  2, 'DAVP letter',                                true),
  ('GOVERNMENT', 'AUTO_HOOD',  3, 'Advisory',                                   true),
  ('GOVERNMENT', 'AUTO_HOOD',  4, '198-page Untitled Advertising list',         true),
  ('GOVERNMENT', 'AUTO_HOOD',  5, 'Latest auto-hood campaign',                  true),
  ('GOVERNMENT', 'AUTO_HOOD',  6, 'PO copy',                                    true),
  -- GSRTC LED
  ('GOVERNMENT', 'GSRTC_LED',  1, 'Proposal letter (auto-generated)',           true),
  ('GOVERNMENT', 'GSRTC_LED',  2, 'GSRTC rate data sheet',                      true),
  ('GOVERNMENT', 'GSRTC_LED',  3, 'Certificate for LED Screen Advertising at 20 GSRTC Bus Stations', true),
  ('GOVERNMENT', 'GSRTC_LED',  4, 'Work completion certificate by GSRTC',       true),
  ('GOVERNMENT', 'GSRTC_LED',  5, 'PO copy',                                    true),
  ('GOVERNMENT', 'GSRTC_LED',  6, 'Latest auto-hood campaign',                  true)
ON CONFLICT (segment, media_type, display_order) DO NOTHING;


-- 5) RLS — read-all-authenticated, admin-write ----------------------
ALTER TABLE public.attachment_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS at_read_all     ON public.attachment_templates;
CREATE POLICY at_read_all     ON public.attachment_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS at_admin_write  ON public.attachment_templates;
CREATE POLICY at_admin_write  ON public.attachment_templates
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));


-- =====================================================================
-- VERIFY:
--
--   SELECT segment, media_type, display_order, label
--     FROM public.attachment_templates
--    ORDER BY segment, media_type, display_order;
--
--   -- Expected: 12 rows (6 per segment+media combo)
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'quote_cities'
--      AND column_name IN ('daily_spots_override', 'days_override', 'spot_duration_sec_override');
--
--   -- Expected: 3 rows
--
-- =====================================================================
