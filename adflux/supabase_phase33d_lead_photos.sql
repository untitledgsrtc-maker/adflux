-- =====================================================================
-- Phase 33D — lead_photos + lead-photos storage bucket + OCR slots
-- 11 May 2026
--
-- Owner directive: photo capture on every lead. Snap shop / business
-- card / hoarding. OCR (via Claude Vision in the ocr-business-card
-- Edge Function) auto-fills name/phone/email when the photo is a
-- business card.
-- =====================================================================

CREATE TABLE IF NOT EXISTS lead_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  storage_path text NOT NULL,             -- bucket-relative path
  caption      text,                      -- optional rep label ("shopfront")
  ocr_text     text,                      -- raw OCR transcript
  ocr_fields   jsonb,                     -- {name, phone, email, company} extracted
  is_business_card boolean DEFAULT false,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_photos_lead ON lead_photos (lead_id, created_at DESC);

-- RLS
ALTER TABLE lead_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lp_read   ON lead_photos;
DROP POLICY IF EXISTS lp_insert ON lead_photos;
DROP POLICY IF EXISTS lp_admin  ON lead_photos;

-- Read: anyone who can see the parent lead can see photos.
CREATE POLICY lp_read ON lead_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM leads l WHERE l.id = lead_photos.lead_id
    )
  );

-- Insert: rep can attach photos to leads they own or are assigned to.
CREATE POLICY lp_insert ON lead_photos
  FOR INSERT WITH CHECK (
    created_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = lead_photos.lead_id
        AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid()
             OR public.get_my_role() IN ('admin','co_owner'))
    )
  );

-- Admin can also update/delete.
CREATE POLICY lp_admin ON lead_photos
  FOR ALL USING (public.get_my_role() IN ('admin','co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

-- ─── Storage bucket ─────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('lead-photos', 'lead-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated user can upload to lead-photos/{leadId}/*
-- if they own / are assigned to that lead. Same lead RLS applies.
DROP POLICY IF EXISTS lead_photos_storage_select ON storage.objects;
DROP POLICY IF EXISTS lead_photos_storage_insert ON storage.objects;
DROP POLICY IF EXISTS lead_photos_storage_admin  ON storage.objects;

CREATE POLICY lead_photos_storage_select ON storage.objects
  FOR SELECT USING (bucket_id = 'lead-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY lead_photos_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'lead-photos' AND
    auth.uid() IS NOT NULL
  );

CREATE POLICY lead_photos_storage_admin ON storage.objects
  FOR ALL USING (
    bucket_id = 'lead-photos' AND
    public.get_my_role() IN ('admin','co_owner')
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'lead_photos') AS table_exists,
  (SELECT count(*) FROM storage.buckets WHERE id = 'lead-photos') AS bucket_exists;
